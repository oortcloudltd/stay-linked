import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import * as adminService from '../services/admin.service.js';
import { adminHotelRouter } from './hotel.routes.js';

const router = Router();

// All admin routes require ADMIN role
router.use(protect, restrictTo('ADMIN'));

// ─── Dashboard ────────────────────────────────
router.get('/dashboard', asyncHandler(async (req, res) => {
  const stats = await adminService.getDashboardStats();
  ApiResponse.ok(res, stats);
}));

router.get('/revenue-chart', asyncHandler(async (req, res) => {
  const data = await adminService.getRevenueChart();
  ApiResponse.ok(res, data);
}));

// ─── Hotels ───────────────────────────────────
router.use('/hotels', adminHotelRouter);

// ─── Users ────────────────────────────────────
router.get('/users', asyncHandler(async (req, res) => {
  const result = await adminService.getAllUsers(req.query);
  ApiResponse.paginated(res, result.users, result.pagination);
}));

// ─── Bookings ─────────────────────────────────
router.get('/bookings', asyncHandler(async (req, res) => {
  const result = await adminService.getAllBookings(req.query);
  ApiResponse.paginated(res, result.bookings, result.pagination);
}));

// ─── Manual Payment Override ──────────────────
router.patch('/bookings/:id/payment', asyncHandler(async (req, res) => {
  const result = await adminService.manualPaymentOverride({
    bookingId: req.params.id,
    action: req.body.action,
    adminId: req.user.id,
    reason: req.body.reason,
  });
  ApiResponse.ok(res, result);
}));

// ─── Banking ─────────────────────────────────
router.get('/banks', asyncHandler(async (req, res) => {
  const banks = await adminService.listBanks();
  ApiResponse.ok(res, banks);
}));

router.post('/verify-account', asyncHandler(async (req, res) => {
  const { accountNumber, bankCode } = req.body;
  const result = await adminService.verifyBankAccount(accountNumber, bankCode);
  ApiResponse.ok(res, result);
}));

export default router;
