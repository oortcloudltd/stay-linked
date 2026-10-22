import crypto from 'node:crypto';
import pool from '../config/database.js'; // pg Pool
import { sendMail, codeEmailHtml } from '../utils/mailer.js';

export const OTP_PURPOSE = {
  EMAIL_VERIFY: 'email_verify',
  PASSWORD_RESET: 'password_reset',
  EMAIL_CHANGE: 'email_change',
};

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 60 * 1000;
const MAX_PER_HOUR = 5;
const secret = () => process.env.OTP_SECRET || process.env.JWT_ACCESS_SECRET;

const hashCode = ({ userId, purpose, targetEmail, code }) =>
  crypto.createHmac('sha256', secret())
    .update([userId, purpose, targetEmail ?? '', String(code)].join('\0'))
    .digest('hex');

/**
 * Plaintext code, or null if throttled.
 * Old live codes are invalidated; rows are kept so hourly cap works.
 */
export async function issueOtp({ userId, purpose, targetEmail = null }) {
  const client = await pool.connect();
  try {
    const now = Date.now();
    
    // 1. Check hourly limit + cooldown
    const recentRes = await client.query(
      `SELECT "createdAt" FROM "verification_codes"
       WHERE "userId" = $1 AND purpose = $2 AND "createdAt" > NOW() - INTERVAL '1 hour'
       ORDER BY "createdAt" DESC`,
      [userId, purpose]
    );

    if (recentRes.rows.length >= MAX_PER_HOUR) return null;
    if (recentRes.rows[0] && (now - new Date(recentRes.rows[0].createdAt).getTime() < COOLDOWN_MS)) {
      return null;
    }

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const tokenHash = hashCode({ userId, purpose, targetEmail, code });
    const expiresAt = new Date(now + TTL_MS);

    // 2. Transaction: invalidate old + create new
    await client.query('BEGIN');

    await client.query(
      `UPDATE "verification_codes"
       SET "consumedAt" = NOW()
       WHERE "userId" = $1 AND purpose = $2 AND "consumedAt" IS NULL`,
      [userId, purpose]
    );

    await client.query(
      `INSERT INTO "verification_codes" (id, "userId", purpose, "targetEmail", "tokenHash", "expiresAt", attempts, "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, 0, NOW())`,
      [userId, purpose, targetEmail, tokenHash, expiresAt]
    );

    await client.query('COMMIT');
    return code;

  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Increment first (atomic), then compare, so parallel guesses can't exceed MAX_ATTEMPTS.
 */
export async function verifyOtp({ userId, purpose, code, targetEmail = null }) {
  if (!/^\d{6}$/.test(String(code))) return false;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock latest valid row
    const recRes = await client.query(
      `SELECT * FROM "verification_codes"
       WHERE "userId" = $1 
         AND purpose = $2
         AND ("targetEmail" = $3 OR ($3 IS NULL AND "targetEmail" IS NULL))
         AND "consumedAt" IS NULL 
         AND "expiresAt" > NOW()
       ORDER BY "createdAt" DESC
       LIMIT 1
       FOR UPDATE`,
      [userId, purpose, targetEmail]
    );

    const rec = recRes.rows[0];
    if (!rec) {
      await client.query('ROLLBACK');
      return false;
    }

    // 2. Atomic increment attempts
    const incRes = await client.query(
      `UPDATE "verification_codes"
       SET attempts = attempts + 1
       WHERE id = $1
       RETURNING attempts, "tokenHash"`,
      [rec.id]
    );

    const { attempts, tokenHash } = incRes.rows[0];

    if (attempts > MAX_ATTEMPTS) {
      await client.query('COMMIT');
      return false;
    }

    // 3. timingSafeEqual compare
    const a = Buffer.from(tokenHash, 'hex');
    const b = Buffer.from(hashCode({ userId, purpose, targetEmail, code }), 'hex');

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      await client.query('COMMIT');
      return false;
    }

    // 4. Consume - prevent replay
    const usedRes = await client.query(
      `UPDATE "verification_codes"
       SET "consumedAt" = NOW()
       WHERE id = $1 AND "consumedAt" IS NULL`,
      [rec.id]
    );

    await client.query('COMMIT');
    return usedRes.rowCount === 1;

  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function deliverOtp({ to, name, code, action }) {
  await sendMail({
    to,
    subject: `StayLink: ${action}`,
    html: codeEmailHtml({ name, code, action, expiresMinutes: 10 }),
  });
}
