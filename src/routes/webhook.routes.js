/**
 * src/routes/webhook.routes.js
 *
 * Paystack webhook endpoint.
 *
 * CRITICAL: This route must be mounted BEFORE express.json() in app.js.
 * Paystack HMAC verification requires the raw request body (Buffer).
 * express.json() consumes the stream and destroys the raw body.
 *
 * Mount in app.js like this:
 *
 *   import webhookRouter from './routes/webhook.routes.js';
 *   import { json, urlencoded } from 'express';
 *
 *   // ① Webhook FIRST — before any body parsers
 *   app.use('/api/v1/webhook', webhookRouter);
 *
 *   // ② Body parsers AFTER
 *   app.use(json());
 *   app.use(urlencoded({ extended: true }));
 *
 * This file uses express.raw() scoped only to this router so the rest of
 * the app can still use express.json() normally.
 */

import { Router, raw } from 'express';
import crypto from 'crypto';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import * as bookingService from '../services/booking.service.js';

const router = Router();

// ─────────────────────────────────────────────
// PAYSTACK WEBHOOK
// POST /api/v1/webhook/paystack
//
// Paystack signs each request with HMAC-SHA512 using your secret key.
// We verify the signature against the raw body before processing.
// ─────────────────────────────────────────────

router.post(
  '/paystack',

  // Parse as raw Buffer — ONLY for this route
  raw({ type: 'application/json' }),

  asyncHandler(async (req, res) => {
    const signature = req.headers['x-paystack-signature'];

    if (!signature) {
      throw ApiError.badRequest('Missing Paystack signature header.');
    }

    // Compute expected HMAC-SHA512 signature
    const hash = crypto
      .createHmac('sha512', env.PAYSTACK_SECRET_KEY)
      .update(req.body) // req.body is a Buffer here, thanks to express.raw()
      .digest('hex');

    if (hash !== signature) {
      // Always return 200 to Paystack even on rejection — prevents retries
      // for forged requests, but log it for monitoring.
      console.warn('[Webhook] Invalid Paystack signature — request rejected.');
      return res.sendStatus(200);
    }

    // Parse the verified raw body
    let event;
    try {
      event = JSON.parse(req.body.toString('utf8'));
    } catch {
      console.warn('[Webhook] Failed to parse Paystack payload as JSON.');
      return res.sendStatus(200);
    }

    // Acknowledge immediately — Paystack expects a fast 200
    // Processing happens asynchronously so a slow DB write doesn't cause retries
    res.sendStatus(200);

    // Get the Socket.IO instance attached to the app
    const io = req.app.get('io');

    // Process the event (non-blocking — errors are caught and logged)
    bookingService.handlePaystackWebhook(event, io).catch((err) => {
      console.error('[Webhook] Error processing Paystack event:', err.message, {
        eventType: event?.event,
        reference: event?.data?.reference,
      });
    });
  })
);

export default router;
