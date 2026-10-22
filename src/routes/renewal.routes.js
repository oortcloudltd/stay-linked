// ============================================================
// src/routes/renewal.routes.js (new file)
// ============================================================

import express from 'express';
import * as renewalController from '../controllers/renewal.controller.js';
import { protect, protectStaff } from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/:bookingId/request', protect, renewalController.requestRenewal);
router.post('/:renewalId/accept', protectStaff, renewalController.acceptRenewal);
router.post('/:renewalId/reject', protectStaff, renewalController.rejectRenewal);

export default router;

// Mount in routes.index.js:
//   router.use('/renewals', require('./renewal.routes'));
