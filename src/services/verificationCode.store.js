import crypto from 'node:crypto';
import { ApiError } from '../utils/ApiError.js';

export const VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000;
export const VERIFICATION_CODE_MAX_ATTEMPTS = 5;

function hashCode(secret, { userId, purpose, targetEmail, code }) {
  const value = [userId, purpose, targetEmail ?? '', String(code)].join('\0');
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function codesMatch(secret, record, code) {
  const expected = Buffer.from(record.tokenHash, 'hex');
  const actual = Buffer.from(hashCode(secret, { ...record, code }), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function createVerificationCodeStore(pool, secret) {
  if (!secret) throw new Error('A verification-code hashing secret is required');

  async function store({ userId, code, purpose, targetEmail = null }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `DELETE FROM "verification_codes" WHERE "userId" = $1 AND purpose = $2`,
        [userId, purpose]
      );

      const tokenHash = hashCode(secret, { userId, purpose, targetEmail, code });
      const expiresAt = new Date(Date.now() + VERIFICATION_CODE_TTL_MS);

      const { rows } = await client.query(
        `INSERT INTO "verification_codes" (
          id, "userId", purpose, "targetEmail", "tokenHash", "expiresAt", attempts, "createdAt"
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, $4, $5, 0, NOW()
        ) RETURNING *`,
        [userId, purpose, targetEmail, tokenHash, expiresAt]
      );

      await client.query('COMMIT');
      return rows[0];
    } catch (e) {
      await client.query('ROLLBACK').catch(()=>{});
      throw e;
    } finally {
      client.release();
    }
  }

  async function verify({ userId, code, purpose, targetEmail = null }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const now = new Date();

      // Lock latest valid row
      const { rows } = await client.query(
        `SELECT * FROM "verification_codes"
         WHERE "userId" = $1
           AND purpose = $2
           AND ("targetEmail" = $3 OR ($3 IS NULL AND "targetEmail" IS NULL))
           AND "consumedAt" IS NULL
           AND "expiresAt" > $4
           AND attempts < $5
         ORDER BY "createdAt" DESC
         LIMIT 1
         FOR UPDATE`,
        [userId, purpose, targetEmail, now, VERIFICATION_CODE_MAX_ATTEMPTS]
      );

      const record = rows[0];
      if (!record) {
        await client.query('ROLLBACK');
        throw ApiError.badRequest('Invalid or expired verification code. Please request a new one.');
      }

      if (!codesMatch(secret, record, code)) {
        await client.query(
          `UPDATE "verification_codes"
           SET attempts = attempts + 1
           WHERE id = $1 AND "consumedAt" IS NULL AND "expiresAt" > $2 AND attempts < $3`,
          [record.id, now, VERIFICATION_CODE_MAX_ATTEMPTS]
        );
        await client.query('COMMIT');
        throw ApiError.badRequest('Invalid or expired verification code. Please request a new one.');
      }

      const consumedRes = await client.query(
        `UPDATE "verification_codes"
         SET "consumedAt" = $2
         WHERE id = $1 AND "consumedAt" IS NULL AND "expiresAt" > $2 AND attempts < $3`,
        [record.id, now, VERIFICATION_CODE_MAX_ATTEMPTS]
      );

      if (consumedRes.rowCount !== 1) {
        await client.query('ROLLBACK');
        throw ApiError.badRequest('Invalid or expired verification code. Please request a new one.');
      }

      await client.query('COMMIT');
      return true;

    } catch (e) {
      await client.query('ROLLBACK').catch(()=>{});
      throw e;
    } finally {
      client.release();
    }
  }

  return { store, verify };
}
