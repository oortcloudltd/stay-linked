/**
 * src/routes/owner.routes.js
 *
 * All owner dashboard API routes.
 */

import { Router } from 'express';
import { protect, protectOwner } from '../middleware/auth.middleware.js';

// Owner-specific controllers
import { getOwnerEarnings } from '../controllers/ownerEarnings.controller.js';
import { getOwnerReports } from '../controllers/ownerReports.controller.js';
import { getOwnerPayouts, updateBankDetails } from '../controllers/ownerPayouts.controller.js';

// Import sub-router and ownership middleware
import { ownerHotelRouter } from './hotel.routes.js';
import { requireHotelOwnership, requireOwnedHotelIfProvided } from '../middleware/ownership.middleware.js';

const router = Router();

// Apply protect + requireOwner to all routes in this router
router.use(protect, protectOwner);

// ─────────────────────────────────────────────
// HOTELS, ROOMS & STAFF
// Handled by sub-router ownerHotelRouter
// ─────────────────────────────────────────────

router.use('/hotels', ownerHotelRouter);

// ─────────────────────────────────────────────
// EARNINGS
// GET /api/v1/owner/earnings
// ─────────────────────────────────────────────

router.get('/earnings', getOwnerEarnings);

// ─────────────────────────────────────────────
// REPORTS
// GET /api/v1/owner/reports?hotelId=&from=&to=
// ─────────────────────────────────────────────

router.get('/reports', requireOwnedHotelIfProvided, getOwnerReports);

// ─────────────────────────────────────────────
// PAYOUTS
// GET /api/v1/owner/payouts
// PUT /api/v1/owner/payouts/bank-details/:hotelId
// ─────────────────────────────────────────────

router.get('/payouts', getOwnerPayouts);

// bank details and reports take a client hotelId: verify ownership
router.put('/payouts/bank-details/:hotelId', requireHotelOwnership('hotelId'), updateBankDetails);

export default router;