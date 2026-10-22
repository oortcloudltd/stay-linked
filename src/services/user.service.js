import bcrypt from 'bcryptjs';
import pool from '../config/database.js'; // pg Pool
import { ApiError } from '../utils/ApiError.js';
import { sendMail, welcomeEmailHtml } from '../utils/mailer.js';
import { issueOtp, verifyOtp, deliverOtp, OTP_PURPOSE } from './otp.service.js';
import { normaliseEmail, emailInUse } from './auth.service.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const USER_SELECT = `
  id, name, "firstName", "lastName",
  email, phone, role,
  "emailVerified", "profileImage",
  dob, "addressLine1", city,
  "residentialState", "stateOfOrigin",
  "localGovernmentOfOrigin", "createdAt"
`;

const USER_SELECT_PUBLIC = `
  id, name, "firstName", "lastName",
  email, phone, role,
  "emailVerified", "profileImage"
`;

// ─── Get profile ──────────────────────────────────────────────────────────────
export async function getProfile(userId) {
  const { rows } = await pool.query(
    `SELECT ${USER_SELECT} FROM "User" WHERE id = $1`,
    [userId]
  );
  if (!rows[0]) throw ApiError.notFound('User not found');
  return rows[0];
}

// ─── Update profile ───────────────────────────────────────────────────────────
export async function updateProfile(userId, updates) {
  const { rows: existingRows } = await pool.query(
    `SELECT phone, dob FROM "User" WHERE id = $1`,
    [userId]
  );
  if (!existingRows[0]) throw ApiError.notFound('User not found');
  const user = existingRows[0];

  if (updates.phone && user.phone) {
    throw ApiError.badRequest('Phone number cannot be changed after it has been saved.');
  }
  if (updates.dob && user.dob) {
    throw ApiError.badRequest('Date of birth cannot be changed after it has been saved.');
  }

  // Build dynamic SET
  const fields = [];
  const values = [];
  let idx = 1;

  const set = (col, val) => {
    fields.push(`"${col}" = $${idx}`);
    values.push(val);
    idx++;
  };

  if (updates.firstName) set('firstName', updates.firstName.trim());
  if (updates.lastName) set('lastName', updates.lastName.trim());
  if (updates.name) set('name', updates.name.trim());
  if (updates.phone && !user.phone) set('phone', updates.phone.trim());
  if (updates.dob && !user.dob) set('dob', updates.dob);
  if (updates.addressLine1 !== undefined) set('addressLine1', updates.addressLine1.trim());
  if (updates.city !== undefined) set('city', updates.city.trim());
  if (updates.residentialState !== undefined) set('residentialState', updates.residentialState);
  if (updates.stateOfOrigin !== undefined) set('stateOfOrigin', updates.stateOfOrigin);
  if (updates.localGovernmentOfOrigin !== undefined) set('localGovernmentOfOrigin', updates.localGovernmentOfOrigin);

  if (!fields.length) {
    return getProfile(userId);
  }

  values.push(userId);
  const { rows } = await pool.query(
    `UPDATE "User" SET ${fields.join(', ')}, "updatedAt" = NOW()
     WHERE id = $${idx}
     RETURNING ${USER_SELECT}`,
    values
  );
  return rows[0];
}

// ─── Update profile photo ─────────────────────────────────────────────────────
export async function updateProfilePhoto(userId, imageUrl) {
  const { rows } = await pool.query(
    `UPDATE "User" SET "profileImage" = $1, "updatedAt" = NOW()
     WHERE id = $2
     RETURNING ${USER_SELECT_PUBLIC}`,
    [imageUrl, userId]
  );
  return rows[0];
}

// ─── Change password ──────────────────────────────────────────────────────────
export async function changePassword(userId, { currentPassword, newPassword }) {
  const { rows } = await pool.query(
    `SELECT "passwordHash" FROM "User" WHERE id = $1`,
    [userId]
  );
  if (!rows[0]) throw ApiError.notFound('User not found');

  if (!(await bcrypt.compare(currentPassword, rows[0].passwordHash))) {
    throw ApiError.unauthorized('Current password is incorrect');
  }
  if (currentPassword === newPassword) {
    throw ApiError.badRequest('New password must be different from your current password');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.query(
    `UPDATE "User" SET "passwordHash" = $1, "refreshToken" = NULL, "updatedAt" = NOW() WHERE id = $2`,
    [passwordHash, userId]
  );
}

// ─── Request email change ─────────────────────────────────────────────────────
export async function requestEmailChange(userId, { currentPassword, newEmail }) {
  const { rows } = await pool.query(`SELECT * FROM "User" WHERE id = $1`, [userId]);
  if (!rows[0]) throw ApiError.notFound('User not found');
  const user = rows[0];

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw ApiError.unauthorized('Current password is incorrect');
  }

  const target = normaliseEmail(newEmail);
  if (await emailInUse(target)) throw ApiError.conflict('An account with this email already exists');

  const code = await issueOtp({ userId, purpose: OTP_PURPOSE.EMAIL_CHANGE, targetEmail: target });
  if (!code) throw new ApiError(429, 'Please wait a minute before requesting another code');

  await deliverOtp({ to: target, name: user.name, code, action: 'Verify your new email address' });
}

// ─── Confirm email change ─────────────────────────────────────────────────────
export async function confirmEmailChange(userId, { code, newEmail }) {
  const target = normaliseEmail(newEmail);

  const ok = await verifyOtp({ userId, purpose: OTP_PURPOSE.EMAIL_CHANGE, code, targetEmail: target });
  if (!ok) throw ApiError.badRequest('Invalid or expired verification code');

  try {
    const { rows } = await pool.query(
      `UPDATE "User" SET email = $1, "emailVerified" = true, "updatedAt" = NOW()
       WHERE id = $2
       RETURNING ${USER_SELECT_PUBLIC}`,
      [target, userId]
    );
    return rows[0];
  } catch (e) {
    if (e.code === '23505') { // Postgres unique_violation instead of P2002
      throw ApiError.conflict('An account with this email already exists');
    }
    throw e;
  }
}

// ─── Forgot password ──────────────────────────────────────────────────────────
export async function requestPasswordReset(email) {
  const normalized = normaliseEmail(email);
  const { rows } = await pool.query(
    `SELECT id, email, name FROM "User" WHERE email ILIKE $1 LIMIT 1`,
    [normalized]
  );
  const user = rows[0];
  if (!user) return;

  const code = await issueOtp({ userId: user.id, purpose: OTP_PURPOSE.PASSWORD_RESET });
  if (!code) return;

  deliverOtp({ to: user.email, name: user.name, code, action: 'Reset your password' })
    .catch((e) => console.error('[reset] mail failed:', e.message));
}

export async function resetPassword({ email, code, newPassword }) {
  const normalized = normaliseEmail(email);
  const { rows } = await pool.query(
    `SELECT id FROM "User" WHERE email ILIKE $1 LIMIT 1`,
    [normalized]
  );
  const user = rows[0];
  const ok = user && (await verifyOtp({ userId: user.id, purpose: OTP_PURPOSE.PASSWORD_RESET, code }));
  if (!ok) throw ApiError.badRequest('Invalid or expired code');

  await pool.query(
    `UPDATE "User" 
     SET "passwordHash" = $1, "refreshToken" = NULL, "emailVerified" = true, "updatedAt" = NOW()
     WHERE id = $2`,
    [await bcrypt.hash(newPassword, 12), user.id]
  );
}

// ─── Welcome email ────────────────────────────────────────────────────────────
export async function sendWelcomeEmail({ name, email }) {
  await sendMail({
    to: email,
    subject: 'Welcome to StayLink 🎉',
    html: welcomeEmailHtml({ name }),
  });
}