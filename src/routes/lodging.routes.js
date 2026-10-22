// ============================================================
// src/routes/lodging.routes.js
// ============================================================

import express from 'express';
import * as lodgingController from '../controllers/lodging.controller.js';
import { protectStaff, requireLiveHotel } from '../middleware/auth.middleware.js';

const router = express.Router();

// Enforce authentication & live status across all lodging routes
router.use(protectStaff, requireLiveHotel);

// Note: /check-in is retired here in favor of POST /api/v1/bookings/hotel/checkin
router.post('/check-out/:bookingId', lodgingController.checkOut);
router.patch('/overdue/:bookingId/settle', lodgingController.markSettled);

export default router;