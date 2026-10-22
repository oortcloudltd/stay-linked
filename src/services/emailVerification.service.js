/**
 * src/services/emailVerification.service.js
 * Postgres raw version
 */

import crypto from 'node:crypto';
import pool from '../config/database.js';
import { createVerificationCodeStore } from './verificationCode.store.js';
import * as emailService from './email.service.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';

const OTP_LENGTH = 6;
const OTP_SECRET = env.OTP_SECRET || 'default-otp-secret-change-in-env';

const verificationCodeStore = createVerificationCodeStore(pool, OTP_SECRET);

function generateOTP() {
  return crypto.randomInt(0, 1000000).toString().padStart(OTP_LENGTH, '0');
}

export async function issueEmailVerificationOTP(userId, email) {
  try {
    const otp = generateOTP();

    await verificationCodeStore.store({
      userId,
      code: otp,
      purpose: 'email_verification',
      targetEmail: email,
    });

    await emailService.sendOTPEmail({ to: email, otp });

    return { success: true };
  } catch (err) {
    console.error('Failed to issue email verification OTP:', err.message);
    return { success: false, error: 'Failed to send verification email. Please try again.' };
  }
}

export async function verifyEmailOTP(userId, code) {
  try {
    const verified = await verificationCodeStore.verify({
      userId,
      code,
      purpose: 'email_verification',
    });

    if (!verified) {
      throw ApiError.badRequest('Invalid or expired verification code');
    }

    // Mark user as emailVerified
    await pool.query(
      `UPDATE "users" SET "emailVerified" = true, "updatedAt" = NOW() WHERE id = $1`,
      [userId]
    );

    return true;
  } catch (err) {
    if (err.statusCode) throw err;
    throw ApiError.badRequest(err.message || 'Verification failed');
  }
}

export async function resendEmailVerificationOTP(userId, email) {
  try {
    const otp = generateOTP();

    await verificationCodeStore.store({
      userId,
      code: otp,
      purpose: 'email_verification',
      targetEmail: email,
    });

    await emailService.sendOTPEmail({ to: email, otp });

    return { success: true };
  } catch (err) {
    console.error('Failed to resend email verification OTP:', err.message);
    return { success: false, error: 'Failed to send verification email. Please try again.' };
  }
}