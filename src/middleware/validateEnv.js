import crypto from 'node:crypto';

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'OTP_SECRET',
    // Optional/Conditional based on your setup:
  // 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
  // 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'FRONTEND_URL',
];

const SECRET_KEYS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'OTP_SECRET'];

export function assertAuthSecrets() {
  if (process.env.NODE_ENV !== 'production') return;

  const bad = SECRET_KEYS.filter((n) => {
    const v = process.env[n];
    return (
      !v ||
      v.length < 32 ||
      /change|secret|example|placeholder|password/i.test(v)
    );
  });

  const vals = SECRET_KEYS.map((n) => process.env[n]).filter(Boolean);
  if (new Set(vals).size !== vals.length) {
    bad.push('(secrets must all differ)');
  }

  if (bad.length > 0) {
    throw new Error(
      `[security] ROTATION REQUIRED — weak, duplicate, or missing secrets: ${bad.join(', ')}`
    );
  }
}

export function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(
      `[env] CRITICAL: Missing required environment variables:\n  - ${missing.join('\n  - ')}`
    );
    process.exit(1);
  }

  try {
    assertAuthSecrets();
  } catch (err) {
    console.error(`[env] ${err.message}`);
    process.exit(1);
  }

  console.log('[env] All required environment variables and secrets verified.');
}