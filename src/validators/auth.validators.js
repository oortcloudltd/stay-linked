import { maxLength, z } from 'zod';

const nigerianPhone = z
  .string()
  .regex(/^\+?234[0-9]{10}$|^0[7-9][0-1][0-9]{8}$/, 'Enter a valid Nigerian phone number');
const email = z.string().trim().email('Enter a valid email address').toLowerCase();

const strongPassword = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters') // bcrypt ignores bytes past 72
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

// ─── Guest ────────────────────────────────────
export const guestRegisterSchema = z.object({
  name: z.string().trim().min(2).max(100),
  firstName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
  email: z.string().trim().max(200),
  phone: nigerianPhone.optional(),
  password: strongPassword,
});
export const guestLoginSchema = z.object({
  email, password: z.string().min(1, 'Password is required')
});


// ─── Owner ────────────────────────────────────
export const ownerRegisterSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email,
  phone: nigerianPhone.optional(),
  password: strongPassword,
  businessName: z.string().trim().min(2).max(200).optional(),
});
export const ownerLoginSchema = guestLoginSchema;

// ─── Verification ────────────────────────────────────
export const verifyEmailSchema = z.object({ email, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const resendVerificationSchema = z.object({ email });

// ─── Staff ────────────────────────────────────
export const staffLoginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1, 'Password is required'),
  hotelId: z.string().min(1, 'Hotel ID is required'),
});

// ─── Refresh / Logout ─────────────────────────
export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// ─── PIN Verify (for check-in actions) ────────
export const verifyPinSchema = z.object({
  pin: z.string().length(4, 'PIN must be exactly 4 digits').regex(/^\d{4}$/, 'PIN must be digits only'),
});
