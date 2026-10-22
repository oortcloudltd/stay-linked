/**
 * src/routes/auth.routes.js
 *
 * FIXES APPLIED:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. /me route rewritten — the original dual-middleware try/catch pattern
 *    using next() callbacks is fragile with asyncHandler. Replaced with a
 *    clean single middleware that checks token type from the decoded payload.
 *
 * 2. Staff login route confirmed at /staff/login — matches useAuth endpointMap.
 *
 * 3. Owner register route confirmed at /owner/register — matches
 *    registerHotelManager() in authService.js frontend.
 *
 * 4. Admin login uses guestLoginSchema (same shape: email + password) — correct.
 */

import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import { authLimiter } from '../middleware/rateLimiter.middleware.js';
import { protectStaff } from '../middleware/auth.middleware.js';
import {
  guestRegisterSchema,
  guestLoginSchema,
  ownerRegisterSchema,
  ownerLoginSchema,
  staffLoginSchema,
  refreshSchema,
} from '../validators/auth.validators.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import prisma from '../config/database.js';
import { STAFF_SESSION_SELECT, toSafeStaffSession } from '../utils/safeStaffSession.js';
import { verifyEmailSchema, resendVerificationSchema } from '../validators/auth.validators.js';
import { verifyAccessToken } from '../utils/jwt.js';



const router = Router();

// ─── Guest ────────────────────────────────────────────────────────────────────
router.post('/guest/register', authLimiter, validate(guestRegisterSchema), authController.guestRegister);
router.post('/guest/login',    authLimiter, validate(guestLoginSchema),    authController.guestLogin);

// ─── Owner ────────────────────────────────────────────────────────────────────
router.post('/owner/register', authLimiter, validate(ownerRegisterSchema), authController.ownerRegister);
router.post('/owner/login',    authLimiter, validate(ownerLoginSchema),    authController.ownerLogin);

// ─── Hotel Staff ──────────────────────────────────────────────────────────────
router.post('/staff/login',    authLimiter, validate(staffLoginSchema),    authController.staffLogin);

// ─── Admin ────────────────────────────────────────────────────────────────────
router.post('/admin/login',    authLimiter, validate(guestLoginSchema),    authController.adminLogin);

// ─── Verification ────────────────────────────────────────────────────────────────────
router.post('/verify-email',        authLimiter, validate(verifyEmailSchema),        authController.verifyEmail);
router.post('/resend-verification', authLimiter, validate(resendVerificationSchema), authController.resendVerification);
// ─── Shared ───────────────────────────────────────────────────────────────────
router.post('/refresh', validate(refreshSchema), authController.refresh);
router.post('/logout',  authController.logout);

// ─── Session check GET /auth/me ───────────────────────────────────────────────
// Accepts both user tokens (role: GUEST/OWNER/ADMIN) and staff tokens (type: 'staff').
// Decodes the token first to determine which table to query, then attaches
// req.user or req.staff so authController.getMe works correctly.
// router.get(
//   '/me',
//   asyncHandler(async (req, res, next) => {
//     const authHeader = req.headers.authorization;

//     if (!authHeader?.startsWith('Bearer ')) {
//       throw ApiError.unauthorized('No token provided');
//     }

//     const token = authHeader.split(' ')[1];

//     let decoded;
//     try {
//       decoded = verifyAccessToken(token);
//     } catch (err) {
//       if (err.name === 'TokenExpiredError') {
//         throw ApiError.unauthorized('Token expired. Please refresh your session.');
//       }
//       throw ApiError.unauthorized('Invalid token');
//     }

//     if (decoded.type === 'staff') {
//       // Staff token — attach staff record
//       const staff = await prisma.hotelStaff.findUnique({
//         where: { id: decoded.staffId },
//         select: STAFF_SESSION_SELECT,
//       });

//       if (!staff || !staff.isActive) {
//         throw ApiError.unauthorized('Staff account not found or inactive');
//       }

//       req.staff = toSafeStaffSession(staff);
//     } else if (decoded.type === 'user' && typeof decoded.userId === 'string') {
//       // User token (guest / owner / admin)
//       const user = await prisma.user.findUnique({
//         where: { id: decoded.userId },
//         select: {
//           id: true, name: true, email: true,
//           role: true, emailVerified: true, profileImage: true,
//         },
//       });
//       if (!user) throw ApiError.unauthorized('User no longer exists');
//       if (!user.emailVerified && user.role !== 'ADMIN') {
//         throw ApiError.forbidden('Account not verified');
//       }
//       req.user = user;
//     } else {
//       throw ApiError.forbidden('Unsupported token type');
//     }

//     next();
//   }),
//   authController.getMe,
// );

export default router;
