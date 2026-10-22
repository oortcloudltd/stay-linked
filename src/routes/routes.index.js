/**
 * src/routes/index.js
 *
 * Central route registry for the /api/v1 prefix.
 *
 * AUDIT NOTE:
 * The original index.js only mounted /auth.
 * The following routes were present in the codebase but NOT mounted
 * (confirmed critical bug from the handoff audit):
 *   - hotel routes
 *   - booking routes
 *   - admin routes
 *   - notification routes
 *   - owner routes (new)
 *
 * All are mounted here. Webhook is intentionally NOT mounted here —
 * it is mounted directly in app.js BEFORE express.json() so that
 * express.raw() can capture the raw body for HMAC verification.
 */

import { Router } from 'express';
import authRouter         from './auth.routes.js';
import hotelRouter        from './hotel.routes.js';
import bookingRouter      from './booking.routes.js';
import adminRouter        from './admin.routes.js';
import notificationRouter from './notification.routes.js';
import ownerRouter        from './owner.routes.js';
import chatRouter         from './chat.routes.js';
import webhookRouter      from './webhook.routes.js';

const router = Router();

// ─── Auth ─────────────────────────────────────────────────────────────────────
router.use('/auth', authRouter);

// ─── Hotels (public search + owner management) ────────────────────────────────
router.use('/hotels', hotelRouter);

// ─── Bookings (guest create, verify, cancel + staff check-in/out) ─────────────
router.use('/bookings', bookingRouter);

// ─── Chat_System ──────────────────────── 
router.use('/chat', chatRouter)

// ─── Owner Dashboard ──────────────────────────────────────────────────────────
router.use('/owner', ownerRouter);

// ─── Admin ────────────────────────────────────────────────────────────────────
router.use('/admin', adminRouter);

// ─── Notifications ────────────────────────────────────────────────────────────
router.use('/notifications', notificationRouter);

// ─── Webhooks ─────────────────────────────────────────────────────────────────
router.use('/webhooks', webhookRouter);

export default router;
