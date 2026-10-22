// ============================================================
// src/services/payment/payout.service.js - RAW SQL
// Part 2 & 3: Orchestrates releasing held funds to a hotel,
// applying the commission split, recording a Transaction, and
// writing an AuditLog entry.
// ============================================================

import pool from '../config/database.js'; // pg Pool
import * as paymentService from './payment.service.js';
import { logAudit } from './audit.service.js';

async function payoutForBooking({ bookingId, actorId, actorType }) {
  const client = await pool.connect();
  try {
    // 1. Fetch booking + hotel with lock
    const bookingRes = await client.query(
      `SELECT b.*, 
              h."bankAccountVerified", h."bankAccountNumber", h."bankCode", 
              h."commissionRate", h."hotelId" as hotel_id, h.id as hotel_pk
       FROM "Booking" b
       JOIN "Hotel" h ON h.id = b."hotelId"
       WHERE b.id = $1
       FOR UPDATE OF b`,
      [bookingId]
    );

    const booking = bookingRes.rows[0];
    if (!booking) throw new Error('Booking not found');
    
    if (booking.paymentStatus !== 'HELD') {
      throw new Error(`Cannot payout — payment status is ${booking.paymentStatus}, expected HELD`);
    }
    if (!booking.bankAccountVerified) {
      throw new Error('Hotel bank account is not verified — cannot payout');
    }

    // Adjust field names to your schema
    const totalAmount = Number(booking.totalAmount);
    const commissionRate = Number(booking.commissionRate ?? 0.1);
    const commission = totalAmount * commissionRate;
    const hotelAmount = totalAmount - commission;

    // 2. Call external provider OUTSIDE transaction
    const transferResult = await paymentService.releaseFunds({
      hotelAccount: {
        accountNumber: booking.bankAccountNumber,
        bankCode: booking.bankCode,
      },
      amount: hotelAmount,
      reference: `payout-${booking.id}-${Date.now()}`,
      metadata: { narration: `Payout for booking ${booking.id}` },
    });

    // 3. Transaction: update booking + create transaction
    await client.query('BEGIN');

    await client.query(
      `UPDATE "Booking" SET "paymentStatus" = 'RELEASED', "updatedAt" = NOW() WHERE id = $1`,
      [bookingId]
    );

    await client.query(
      `INSERT INTO "Transaction" (
        id, "bookingId", type, status, provider, "providerReference", 
        amount, commission, "hotelId", "rawResponse", "createdAt"
      ) VALUES (
        gen_random_uuid(), $1, 'PAYOUT', $2, $3, $4, $5, $6, $7, $8::jsonb, NOW()
      )`,
      [
        bookingId,
        transferResult.status === 'SUCCESS' ? 'SUCCESS' : 'INITIATED',
        paymentService.getActiveProvider(),
        transferResult.providerReference,
        hotelAmount,
        commission,
        booking.hotelId,
        JSON.stringify(transferResult.raw || {})
      ]
    );

    await client.query('COMMIT');

    // 4. Audit log (outside, non-critical)
    await logAudit({
      actorId,
      actorType,
      action: 'PAYMENT_RELEASED',
      entityType: 'Booking',
      entityId: bookingId,
      newValue: { paymentStatus: 'RELEASED', hotelAmount, commission },
    });

    return transferResult;

  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  } finally {
    client.release();
  }
}

export { payoutForBooking };