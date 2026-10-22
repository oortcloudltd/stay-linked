/**
 * src/controllers/auth.controller.js
 *
 * This file was referenced in your router (authController.guestRegister etc.)
 * but never shown in your codebase. If it doesn't exist, every auth route
 * returns 500. This is the complete implementation.
 *
 * PATTERN: Every handler calls a service function, then sends a consistent
 * response envelope: { success: true, data: { ... } }
 * This is what apiClient/useAuth unwrap with: response?.data?.data
 */

import * as authService from '../services/auth.service.js';
import { asyncHandler }  from '../utils/asyncHandler.js';
import { ApiError }      from '../utils/ApiError.js';
import { verifyAccessTokenIgnoringExpiry } from '../utils/jwt.js'; // add to imports
import { toSafeStaffSession } from '../utils/safeStaffSession.js';


// ─── Consistent response envelope ─────────────────────────────────────────────
function ok(res, data, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data });
}

// ─── Guest ────────────────────────────────────────────────────────────────────

export const guestRegister = asyncHandler(async (req, res) =>
  ok(res, await authService.registerGuest(req.body), 201));   // { user, requiresVerification: true }, no tokens


export const guestLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { user, accessToken, refreshToken } = await authService.loginGuest({ email, password });
  return ok(res, { user, accessToken, refreshToken });
});

// ─── Owner ────────────────────────────────────────────────────────────────────
export const ownerRegister = asyncHandler(async (req, res) =>
  ok(res, await authService.registerOwner(req.body), 201));

export const ownerLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { user, accessToken, refreshToken } = await authService.loginOwner({ email, password });
  return ok(res, { user, accessToken, refreshToken });
});

// ─── Staff ────────────────────────────────────────────────────────────────────

export const staffLogin = asyncHandler(async (req, res) => {
  const { email, password, hotelId } = req.body;
  const { staff, accessToken, refreshToken } = await authService.loginStaff({ email, password, hotelId });
  return ok(res, { user: toSafeStaffSession(staff), accessToken, refreshToken });
  // NOTE: we send staff as 'user' so useAuth can treat it uniformly.
  // staff object must include role: 'hotel_staff' — see STAFF_ROLE_ALIGNMENT.md
});

// ─── Admin ────────────────────────────────────────────────────────────────────

export const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { user, accessToken, refreshToken } = await authService.loginAdmin({ email, password });
  return ok(res, { user, accessToken, refreshToken });
});

// ─── Refresh ──────────────────────────────────────────────────────────────────

export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw ApiError.badRequest('Refresh token is required');
  const tokens = await authService.refreshAccessToken(refreshToken);
  return ok(res, tokens);
});

// ─── Verification ───────────────────────────────────────────────────────────────────
export const verifyEmail = asyncHandler(async (req, res) =>
  ok(res, await authService.verifyEmail(req.body)));

export const resendVerification = asyncHandler(async (req, res) => {
  await authService.resendVerification(req.body);
  return ok(res, { message: 'If an account is awaiting verification, a new code has been sent.' });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

export const logout = asyncHandler(async (req, res) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    let decoded;
    try {
      decoded = verifyAccessTokenIgnoringExpiry(header.split(' ')[1]);
    } catch {
      return ok(res, { message: 'Logged out successfully' });
    }
    if (decoded.type === 'staff') await authService.logoutStaff(decoded.staffId);
    else if (decoded.type === 'user') await authService.logoutUser(decoded.userId);
  }
  return ok(res, { message: 'Logged out successfully' });
});

// ─── Session check (GET /auth/me) ─────────────────────────────────────────────

export const getMe = asyncHandler(async (req, res) => {
  // req.user set by protect middleware, req.staff set by protectStaff
  const entity = req.user ?? req.staff;
  if (!entity) throw ApiError.unauthorized();
  return ok(res, { user: entity });
});
