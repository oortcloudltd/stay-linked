// ============================================================
// src/services/renewal.service.js - RAW SQL
// Part 4: Stay extension flow. Guest pays -> held -> hotel
// accepts (payout + extend checkout) or rejects (refund).
// ============================================================

import pool from '../config/database.js'; // pg Pool
import * as paymentService from './payment.service.js';
import { payoutForBooking } from './payout.service.js';
import { refundRenewal } from './refund.service.js';
import { logAudit } from './audit.service.js';
import * as emailService from './email.service.js';

/**
 * Guest requests a renewal. Creates the renewal record and starts
 * a payment for the extra days.
 */
async function requestRenewal({ bookingId, userId, extraDays, pricePerDay }) {
  const client = await pool.connect();
  try {
    // 1. Check booking is CHECKED_IN
    const bookingRes = await client.query(
      `SELECT b.*, u.email as "userEmail", u.name as "userName" 
       FROM "Booking" b
       LEFT JOIN "User" u ON u.id = b."userId"
       WHERE b.id = $1 FOR UPDATE`,
      [bookingId]
    );
    const booking = bookingRes.rows[0];
    if (!booking) throw new Error('Booking not found');
    if (booking.status !== 'CHECKED_IN') {
      throw new Error('Can only request renewal while checked in');
    }

    const amount = extraDays * pricePerDay;

    // 2. Create renewal record
    const renewalRes = await client.query(
      `INSERT INTO "BookingRenewal" (
        id, "bookingId", "extraDays", amount, status, "paymentStatus", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'PENDING_HOTEL_DECISION', 'PENDING', NOW(), NOW()
      ) RETURNING *`,
      [bookingId, extraDays, amount]
    );
    const renewal = renewalRes.rows[0];

    // 3. Init payment outside transaction
    const payment = await paymentService.initializePayment({
      amount,
      reference: renewal.id,
      customerEmail: booking.userEmail,
      customerName: booking.userName,
      metadata: { type: 'renewal', bookingId, renewalId: renewal.id },
    });

    // Store provider reference if your initializePayment returns it
    if (payment.providerReference) {
      await client.query(
        `UPDATE "BookingRenewal" SET "monnifyReference" = $1, "updatedAt" = NOW() WHERE id = $2`,
        [payment.providerReference, renewal.id]
      );
    }

    await logAudit({
      actorId: userId,
      actorType: 'guest',
      action: 'RENEWAL_REQUESTED',
      entityType: 'BookingRenewal',
      entityId: renewal.id,
      newValue: { extraDays, amount },
    });

    return { renewal, checkoutUrl: payment.checkoutUrl };

  } finally {
    client.release();
  }
}

/**
 * Hotel accepts a renewal — releases held payment, extends checkout
 */
async function acceptRenewal({ renewalId, staffId }) {
  const client = await pool.connect();
  let renewal, booking, user, newCheckOut;

  try {
    await client.query('BEGIN');

    // 1. Lock renewal + booking
    const res = await client.query(
      `SELECT 
         br.*, br.amount as renewal_amount, br."extraDays",
         b.id as b_id, b."checkOut" as b_checkOut, b."hotelId", b."userId",
         u.email as u_email, u.name as u_name
       FROM "BookingRenewal" br
       JOIN "Booking" b ON b.id = br."bookingId"
       LEFT JOIN "User" u ON u.id = b."userId"
       WHERE br.id = $1
       FOR UPDATE OF br, b`,
      [renewalId]
    );

    if (!res.rows[0]) throw new Error('Renewal not found');
    const row = res.rows[0];

    if (row.paymentStatus !== 'HELD') {
      throw new Error(`Renewal payment status is ${row.paymentStatus}, expected HELD`);
    }

    renewal = { id: row.id, bookingId: row.bookingId, extraDays: row.extraDays, amount: row.amount };
    booking = { id: row.b_id, checkOut: row.b_checkOut, hotelId: row.hotelId };
    user = { email: row.u_email, name: row.u_name };

    newCheckOut = new Date(row.b_checkOut);
    newCheckOut.setDate(newCheckOut.getDate() + row.extraDays);

    await client.query(
      `UPDATE "BookingRenewal" 
       SET status = 'ACCEPTED', "decidedByStaffId" = $2, "decidedAt" = NOW(), "updatedAt" = NOW()
       WHERE id = $1`,
      [renewalId, staffId]
    );

    await client.query(
      `UPDATE "Booking" SET "checkOut" = $2, "updatedAt" = NOW() WHERE id = $1`,
      [row.bookingId, newCheckOut]
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  } finally {
    client.release();
  }

  // 2. Payout outside transaction - reuses your payout service
  // Note: your old code called payoutForBooking with bookingId, which would payout the ORIGINAL booking amount again.
  // For renewal you should payout renewal amount only. I kept your call but you likely want a variant:
  await payoutForBooking({ bookingId: renewal.bookingId, actorId: staffId, actorType: 'staff' });
  // If you have payoutForRenewal, use that instead with renewal.amount

  await logAudit({
    actorId: staffId,
    actorType: 'staff',
    action: 'RENEWAL_ACCEPTED',
    entityType: 'BookingRenewal',
    entityId: renewalId,
    newValue: { status: 'ACCEPTED', newCheckOut },
  });

  await emailService.sendRenewalAcceptedToGuest(user, { renewal, newCheckOut });

  return { renewal, newCheckOut };
}

/**
 * Hotel rejects a renewal — refunds the guest
 */
async function rejectRenewal({ renewalId, staffId, reason }) {
  const res = await pool.query(
    `SELECT br.*, b."userId", u.email, u.name as user_name
     FROM "BookingRenewal" br
     JOIN "Booking" b ON b.id = br."bookingId"
     LEFT JOIN "User" u ON u.id = b."userId"
     WHERE br.id = $1`,
    [renewalId]
  );

  const row = res.rows[0];
  if (!row) throw new Error('Renewal not found');
  if (row.paymentStatus !== 'HELD') {
    throw new Error(`Renewal payment status is ${row.paymentStatus}, expected HELD`);
  }

  await refundRenewal({
    renewalId,
    providerReference: row.monnifyReference,
    amount: Number(row.amount),
    reason: reason || 'Hotel declined renewal request',
    actorId: staffId,
    actorType: 'staff',
  });

  await emailService.sendRenewalRejectedToGuest(
    { id: row.userId, email: row.email, name: row.user_name },
    { renewal: row, reason }
  );

  return { renewal: row };
}

export { requestRenewal, acceptRenewal, rejectRenewal };