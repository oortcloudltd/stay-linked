import { Router } from 'express';
import * as bookingController from '../controllers/booking.controller.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { protectHotelActor } from '../middleware/hotelActor.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { bookingLimiter } from '../middleware/rateLimiter.middleware.js';
import {
  createBookingSchema,
  walkInSchema,
  checkInSchema,
  checkOutSchema,
  cancelBookingSchema,
} from '../validators/booking.validators.js';

const router = Router();

// ─────────────────────────────────────────────
// GUEST BOOKING ROUTES
// ─────────────────────────────────────────────
router.post('/', protect, restrictTo('GUEST'), bookingLimiter, validate(createBookingSchema), bookingController.createBooking);
router.get('/my', protect, restrictTo('GUEST'), bookingController.getMyBookings);
router.get('/verify/:reference', protect, restrictTo('GUEST'), bookingController.verifyPayment);
router.get('/:id/navigation', protect, restrictTo('GUEST'), bookingController.getBookingNavigation);
router.get('/:id', protect, restrictTo('GUEST'), bookingController.getMyBookingById);
router.patch('/:id/cancel', protect, restrictTo('GUEST'), validate(cancelBookingSchema), bookingController.cancelBooking);

// ─────────────────────────────────────────────
// STAFF & OWNER (HOTEL DASHBOARD) ROUTES
// ─────────────────────────────────────────────
router.get('/hotel/all', protectHotelActor, bookingController.getHotelBookings);
router.post('/hotel/checkin', protectHotelActor, validate(checkInSchema), bookingController.checkInGuest);
router.patch('/hotel/:id/checkout', protectHotelActor, validate(checkOutSchema), bookingController.checkOutGuest);
router.post('/hotel/walkin', protectHotelActor, validate(walkInSchema), bookingController.createWalkIn);
router.get('/hotel/active', protectHotelActor, bookingController.getActiveRooms);

export default router;