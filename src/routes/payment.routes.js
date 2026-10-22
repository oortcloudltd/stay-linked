// ============================================================
// src/routes/payment.routes.js (new file)
// Part 2: mount this in your central router. CRITICAL — the
// webhook route must use express.raw(), not express.json(),
// same as your existing Paystack webhook did.
// ============================================================

import express from 'express';
import * as paymentController from '../controllers/payment.controller.js';
import { protect } from '../middleware/auth.middleware.js';


const router = express.Router();

// Webhook — raw body required for signature verification.
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  paymentController.handleWebhook
);

export default router;

// In your routes.index.js (or wherever you mount route groups):
//   router.use('/payments', require('./payment.routes'));
//
// Make sure this is registered BEFORE your global express.json()
// middleware applies to this path, or that your json() middleware
// explicitly skips /payments/webhook — otherwise the raw body
// needed for signature verification will already be parsed/consumed.
