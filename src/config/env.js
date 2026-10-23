import 'dotenv/config';

/**
 * src/config/env.js
 *
 * Validates all required environment variables at startup.
 * If any are missing the server exits immediately with a clear message
 * instead of failing silently mid-request.
 *
 * SMTP_* names match nodemailer convention and email.service.js usage.
 * PAYSTACK_SECRET_KEY is warned (not hard-failed) so the server can still
 * boot in environments where Paystack is not configured yet.
 */

const REQUIRED = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
];

const missing = REQUIRED.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(
    `[StayLink] FATAL: Missing required environment variables:\n  ${missing.join('\n  ')}\n` +
    'Add them to your .env file and restart.',
  );
  process.exit(1);
}

if (!process.env.PAYSTACK_SECRET_KEY) {
  console.warn('[StayLink] WARNING: PAYSTACK_SECRET_KEY is not set — payment features will not work.');
}

const smtpHost = process.env.SMTP_HOST || process.env.MAIL_HOST;
const smtpPort = Number(process.env.SMTP_PORT || process.env.MAIL_PORT) || 587;
const smtpUser = process.env.SMTP_USER || process.env.MAIL_USER;
const smtpPass = process.env.SMTP_PASS || process.env.MAIL_PASS;
const emailFrom = process.env.EMAIL_FROM || process.env.MAIL_FROM;

if (!smtpHost) {
  console.warn('[StayLink] WARNING: SMTP_HOST is not set — email sending will be disabled.');
}

export const env = {
  NODE_ENV:               process.env.NODE_ENV               ?? 'development',
  PORT:                   Number(process.env.PORT)            || 5000,
  DATABASE_URL:           process.env.DATABASE_URL,
  FRONTEND_URL:           process.env.FRONTEND_URL            ?? '',
  JWT_ACCESS_SECRET:      process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET:     process.env.JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES_IN:  process.env.JWT_ACCESS_EXPIRES_IN  ?? '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  ALLOWED_ORIGINS:        process.env.ALLOWED_ORIGINS         ?? '',

  // ── Paystack ──────────────────────────────────────────────────────────────
  PAYSTACK_SECRET_KEY:    process.env.PAYSTACK_SECRET_KEY     ?? '',

  // ── Email (SMTP) ──────────────────────────────────────────────────────────
  // These match nodemailer field names and must align with email.service.js
  SMTP_HOST:              smtpHost,
  SMTP_PORT:              smtpPort,
  SMTP_USER:              smtpUser,
  SMTP_PASS:              smtpPass,
  EMAIL_FROM:             emailFrom || smtpUser || 'noreply@staylink.ng',

  // ── Cloudinary ────────────────────────────────────────────────────────────
  CLOUDINARY_CLOUD_NAME:  process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY:     process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET:  process.env.CLOUDINARY_API_SECRET,
};
