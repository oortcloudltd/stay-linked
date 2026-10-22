// ============================================================
// src/services/payment/refund.service.js - RAW SQL
// Part 2 & 4: Orchestrates refunding a guest — used for booking
// cancellation and renewal rejection.
// ============================================================

import pool from '../config/database.js'; // pg Pool
import * as paymentService from './payment.service.js';
import { logAudit } from './audit.service.js';

/**
 * Refunds a booking's held payment (e.g. on cancellation).
 */
async function refundBooking({ bookingId, providerReference, amount, reason, actorId, actorType }) {
  // 1. External refund FIRST (don't lock DB while calling provider)
  const refundResult = await paymentService.refund({ providerReference, amount, reason });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock booking to prevent double refund
    const bookingCheck = await client.query(
      `SELECT id, "paymentStatus" FROM "Booking" WHERE id = $1 FOR UPDATE`,
      [bookingId]
    );
    if (!bookingCheck.rows[0]) throw new Error('Booking not found');
    if (bookingCheck.rows[0].paymentStatus === 'REFUNDED') {
      await client.query('ROLLBACK');
      return refundResult; // idempotent
    }

    await client.query(
      `UPDATE "Booking" SET "paymentStatus" = 'REFUNDED', "updatedAt" = NOW() WHERE id = $1`,
      [bookingId]
    );

    await client.query(
      `INSERT INTO "Transaction" (
        id, "bookingId", type, status, provider, "providerReference", amount, "rawResponse", "createdAt"
      ) VALUES (
        gen_random_uuid(), $1, 'REFUND', $2, $3, $4, $5, $6::jsonb, NOW()
      )`,
      [
        bookingId,
        refundResult.status === 'SUCCESS' ? 'SUCCESS' : 'INITIATED',
        paymentService.getActiveProvider(),
        refundResult.providerReference,
        amount,
        JSON.stringify(refundResult.raw || {})
      ]
    );

    await client.query('COMMIT');

  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  } finally {
    client.release();
  }

  await logAudit({
    actorId,
    actorType,
    action: 'PAYMENT_REFUNDED',
    entityType: 'Booking',
    entityId: bookingId,
    reason,
    newValue: { paymentStatus: 'REFUNDED' },
  });

  return refundResult;
}

/**
 * Refunds a renewal request that the hotel rejected.
 */
async function refundRenewal({ renewalId, providerReference, amount, reason, actorId, actorType }) {
  const refundResult = await paymentService.refund({ providerReference, amount, reason });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const renewalCheck = await client.query(
      `SELECT id, "paymentStatus" FROM "BookingRenewal" WHERE id = $1 FOR UPDATE`,
      [renewalId]
    );
    if (!renewalCheck.rows[0]) throw new Error('Renewal not found');
    if (renewalCheck.rows[0].paymentStatus === 'REFUNDED') {
      await client.query('ROLLBACK');
      return refundResult;
    }

    await client.query(
      `UPDATE "BookingRenewal" 
       SET status = 'REJECTED', "paymentStatus" = 'REFUNDED', "decidedAt" = NOW(), "updatedAt" = NOW()
       WHERE id = $1`,
      [renewalId]
    );

    await client.query(
      `INSERT INTO "Transaction" (
        id, "renewalId", type, status, provider, "providerReference", amount, "rawResponse", "createdAt"
      ) VALUES (
        gen_random_uuid(), $1, 'REFUND', $2, $3, $4, $5, $6::jsonb, NOW()
      )`,
      [
        renewalId,
        refundResult.status === 'SUCCESS' ? 'SUCCESS' : 'INITIATED',
        paymentService.getActiveProvider(),
        refundResult.providerReference,
        amount,
        JSON.stringify(refundResult.raw || {})
      ]
    );

    await client.query('COMMIT');

  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  } finally {
    client.release();
  }

  await logAudit({
    actorId,
    actorType,
    action: 'RENEWAL_REJECTED_REFUNDED',
    entityType: 'BookingRenewal',
    entityId: renewalId,
    reason,
    newValue: { status: 'REJECTED', paymentStatus: 'REFUNDED' },
  });

  return refundResult;
}

export { refundBooking, refundRenewal };