import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import { ApiError } from '../utils/ApiError.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import { issueOtp, verifyOtp, deliverOtp, OTP_PURPOSE } from './otp.service.js';

export const normaliseEmail = (email) => (email ? email.trim().toLowerCase() : '');

export async function emailInUse(email) {
  const normalizedEmail = normaliseEmail(email);
  const [userRes, staffRes] = await Promise.all([
    pool.query(
      `SELECT id FROM "users" WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalizedEmail]
    ),
    pool.query(
      `SELECT id FROM "hotel_staff" WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalizedEmail]
    ),
  ]);
  return userRes.rowCount > 0 || staffRes.rowCount > 0;
}

export async function sendVerificationCode(user) {
  const code = await issueOtp({
    userId: user.id,
    purpose: OTP_PURPOSE.EMAIL_VERIFY,
  });

  if (!code) {
    throw new ApiError(429, 'Please wait a minute before requesting another code');
  }

  try {
    await deliverOtp({
      to: user.email,
      name: user.name,
      code,
      action: 'Verify your email',
    });
  } catch (error) {
    console.error('[auth] Verification email delivery failed:', error.message);
    throw new ApiError(503, 'Your account is saved, but the verification email could not be sent. Check SMTP settings, then request another code.');
  }
}

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  phone: user.phone,
  role: user.role,
  emailVerified: user.emailVerified,
  profileImage: user.profileImage,
});

function resolveUserDisplayName({ name, firstName, lastName, email }) {
  const fullName = [firstName, lastName].map((part) => String(part ?? '').trim()).filter(Boolean).join(' ');
  const safeName = String(name ?? '').trim() || fullName || (email ? email.split('@')[0] : 'Guest');
  if (!safeName) throw ApiError.badRequest('Name is required');
  return safeName;
}

export async function buildGuestUserData({ name, firstName, lastName, email, phone, password }) {
  const normalizedEmail = normaliseEmail(email);
  if (!normalizedEmail) throw ApiError.badRequest('Email is required');
  if (!password) throw ApiError.badRequest('Password is required');

  return {
    name: resolveUserDisplayName({ name, firstName, lastName, email: normalizedEmail }),
    firstName: firstName?.trim() || null,
    lastName: lastName?.trim() || null,
    email: normalizedEmail,
    phone: phone?.trim() || null,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'GUEST',
    emailVerified: false,
  };
}

export async function registerGuest({ name, firstName, lastName, email, phone, password }) {
  console.log("Auth service reached");

  const normalizedEmail = normaliseEmail(email);
  const { rows: existingRows } = await pool.query(
    `SELECT * FROM "users" WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [normalizedEmail]
  );
  const existingUser = existingRows[0];

  if (existingUser) {
    // A previous signup can leave an unverified account if mail delivery fails.
    // Let its owner retry verification without creating another user row.
    const isSameGuest = existingUser.role === 'GUEST'
      && !existingUser.emailVerified
      && await bcrypt.compare(password, existingUser.passwordHash);

    if (!isSameGuest) {
      throw ApiError.conflict('An account with this email already exists');
    }

    await sendVerificationCode(existingUser);
    return { user: publicUser(existingUser), requiresVerification: true };
  }

  const { rowCount: staffCount } = await pool.query(
    `SELECT 1 FROM "hotel_staff" WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [normalizedEmail]
  );
  if (staffCount > 0) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const data = await buildGuestUserData({ name, firstName, lastName, email: normalizedEmail, phone, password });

  const { rows } = await pool.query(
    `INSERT INTO "users" (name, "firstName", "lastName", email, phone, "passwordHash", role, "emailVerified")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [data.name, data.firstName, data.lastName, data.email, data.phone, data.passwordHash, data.role, data.emailVerified]
  );

  const user = rows[0];
  await sendVerificationCode(user);
  return { user: publicUser(user), requiresVerification: true };
}

export async function registerOwner({ name, email, phone, password, businessName }) {
  const normalizedEmail = normaliseEmail(email);
  if (await emailInUse(normalizedEmail)) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const displayName = resolveUserDisplayName({ name, email: normalizedEmail });
    const passwordHash = await bcrypt.hash(password, 12);

    const { rows } = await client.query(
      `INSERT INTO "users" (name, email, phone, "passwordHash", role)
       VALUES ($1,$2,$3,$4,'OWNER')
       RETURNING *`,
      [displayName, normalizedEmail, phone?.trim() || null, passwordHash]
    );
    const user = rows[0];

    await client.query(
      `INSERT INTO "hotel_owners" ("userId", "businessName") VALUES ($1,$2)`,
      [user.id, businessName?.trim() || null]
    );

    await client.query('COMMIT');

    await sendVerificationCode(user);
    return { user: publicUser(user), requiresVerification: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function verifyEmail({ email, code }) {
  const { rows } = await pool.query(
    `SELECT * FROM "users" WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [normaliseEmail(email)]
  );
  const user = rows[0];

  if (!user || user.emailVerified) {
    throw ApiError.badRequest('Invalid or expired verification code');
  }

  const verified = await verifyOtp({
    userId: user.id,
    purpose: OTP_PURPOSE.EMAIL_VERIFY,
    code,
  });
  if (!verified) throw ApiError.badRequest('Invalid or expired verification code');

  const { rows: updatedRows } = await pool.query(
    `UPDATE "users" SET "emailVerified" = true, "updatedAt" = NOW() WHERE id = $1 RETURNING *`,
    [user.id]
  );

  return { user: publicUser(updatedRows[0]), verified: true };
}

export async function resendVerification({ email }) {
  const { rows } = await pool.query(
    `SELECT * FROM "users" WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [normaliseEmail(email)]
  );
  const user = rows[0];
  if (!user || user.emailVerified) return;
  await sendVerificationCode(user);
}

async function loginUser({ email, password }, role) {
  const { rows } = await pool.query(
    `SELECT * FROM "users" WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [normaliseEmail(email)]
  );
  const user = rows[0];

  if (!user || user.role !== role || !(await bcrypt.compare(password, user.passwordHash))) {
    throw ApiError.unauthorized('Invalid credentials');
  }
  if (!user.emailVerified && role !== 'ADMIN') {
    throw ApiError.forbidden('Please verify your email before signing in');
  }

  const accessToken = generateAccessToken({ userId: user.id, type: 'user', role: user.role });
  const refreshToken = generateRefreshToken({ userId: user.id, type: 'user', role: user.role });

  await pool.query(`UPDATE "users" SET "refreshToken" = $2, "updatedAt" = NOW() WHERE id = $1`, [user.id, refreshToken]);

  return { user: publicUser(user), accessToken, refreshToken };
}

export const loginGuest = (credentials) => loginUser(credentials, 'GUEST');
export const loginOwner = (credentials) => loginUser(credentials, 'OWNER');
export const loginAdmin = (credentials) => loginUser(credentials, 'ADMIN');

export async function loginStaff({ email, password }) {
  const normalizedEmail = normaliseEmail(email);

  const { rows } = await pool.query(
    `SELECT s.*, to_jsonb(h) as hotel
     FROM "hotel_staff" s
     LEFT JOIN "hotels" h ON h.id = s."hotelId"
     WHERE LOWER(s.email) = LOWER($1) LIMIT 1`,
    [normalizedEmail]
  );

  const staff = rows[0];

  if (!staff || !staff.isActive) {
    throw ApiError.unauthorized('Invalid credentials or inactive account');
  }

  const isValidPassword = await bcrypt.compare(password, staff.passwordHash);
  if (!isValidPassword) {
    throw ApiError.unauthorized('Invalid credentials');
  }

  const accessToken = generateAccessToken({ staffId: staff.id, type: 'staff', role: staff.role });
  const refreshToken = generateRefreshToken({ staffId: staff.id, type: 'staff' });

  await pool.query(
    `UPDATE "hotel_staff" SET "refreshToken" = $1, "lastLogin" = NOW(), "updatedAt" = NOW() WHERE id = $2`,
    [refreshToken, staff.id]
  );

  return { staff, accessToken, refreshToken };
}

export async function refreshAccessToken(refreshToken) {
  const decoded = verifyRefreshToken(refreshToken);

  if (decoded.type === 'staff' && typeof decoded.staffId === 'string') {
    const { rows } = await pool.query(`SELECT * FROM "hotel_staff" WHERE id = $1 LIMIT 1`, [decoded.staffId]);
    const staff = rows[0];
    if (!staff || !staff.isActive || staff.refreshToken !== refreshToken) {
      throw ApiError.unauthorized('Invalid refresh token');
    }
    const accessToken = generateAccessToken({ staffId: staff.id, type: 'staff', role: staff.role });
    const nextRefreshToken = generateRefreshToken({ staffId: staff.id, type: 'staff' });

    await pool.query(`UPDATE "hotel_staff" SET "refreshToken" = $1, "updatedAt" = NOW() WHERE id = $2`, [nextRefreshToken, staff.id]);

    return { accessToken, refreshToken: nextRefreshToken };
  }

  if (decoded.type === 'user' && typeof decoded.userId === 'string') {
    const { rows } = await pool.query(`SELECT * FROM "users" WHERE id = $1 LIMIT 1`, [decoded.userId]);
    const user = rows[0];
    if (!user || user.refreshToken !== refreshToken || (!user.emailVerified && user.role !== 'ADMIN')) {
      throw ApiError.unauthorized('Invalid refresh token');
    }
    const accessToken = generateAccessToken({ userId: user.id, type: 'user', role: user.role });
    const nextRefreshToken = generateRefreshToken({ userId: user.id, type: 'user', role: user.role });

    await pool.query(`UPDATE "users" SET "refreshToken" = $1, "updatedAt" = NOW() WHERE id = $2`, [nextRefreshToken, user.id]);

    return { accessToken, refreshToken: nextRefreshToken };
  }

  throw ApiError.unauthorized('Invalid refresh token');
}

export async function logoutUser(userId) {
  await pool.query(`UPDATE "users" SET "refreshToken" = NULL, "updatedAt" = NOW() WHERE id = $1`, [userId]);
}

export async function logoutStaff(staffId) {
  await pool.query(`UPDATE "hotel_staff" SET "refreshToken" = NULL, "updatedAt" = NOW() WHERE id = $1`, [staffId]);
}
