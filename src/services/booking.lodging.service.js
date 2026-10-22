// ============================================================
// src/services/booking.lodging.service.js
// Part 3: Check-in via QR scan (triggers payout release) and
// check-out (overdue calculation + notification only, no charge).
// ============================================================

import pool from '../config/database.js';
import { ApiError } from '../utils/ApiError.js';
import { payoutForBooking } from './payout.service.js';
import { logAudit } from './audit.service.js';
import * as emailService from './email.service.js';

const NOT_FOUND = 'Booking not found for this hotel';

async function getBookingFull(bookingIdOrToken, { byToken = false, hotelId = null } = {}) {
  const where = byToken 
    ? `b."qrCodeToken" = $1` 
    : `b.id = $1`;
  
  const params = byToken ? [String(bookingIdOrToken)] : [String(bookingIdOrToken)];
  let hotelFilter = '';
  if (hotelId) {
    hotelFilter = ` AND b."hotelId" = $${params.length + 1}`;
    params.push(hotelId);
  }

  const { rows } = await pool.query(
    `SELECT 
        b.*,
        to_jsonb(u) as user,
        to_jsonb(h) as hotel,
        to_jsonb(r) as room
     FROM "bookings" b
     LEFT JOIN "users" u ON u.id = b."userId"
     LEFT JOIN "hotels" h ON h.id = b."hotelId"
     LEFT JOIN "rooms" r ON r.id = b."roomId"
     WHERE ${where} ${hotelFilter}
     LIMIT 1`,
    params
  );
  return rows[0] || null;
}

/**
 * Called when hotel staff or owner scans a guest's QR code at check-in.
 */
async function checkInGuest({ qrCodeToken, actorId, actorType = 'staff', hotelId }) {
  const token = String(qrCodeToken);

  // Atomically transition booking status to prevent race conditions
  const { rowCount } = await pool.query(
    `UPDATE "bookings"
     SET status = 'CHECKED_IN',
         "checkedInAt" = NOW(),
         "updatedAt" = NOW()
     WHERE "qrCodeToken" = $1
       AND "hotelId" = $2
       AND status = 'CONFIRMED'
       AND "paymentStatus" = 'HELD'`,
    [token, hotelId]
  );

  if (rowCount !== 1) {
    throw ApiError.badRequest('Booking not found, not ready for check-in, or already checked in');
  }

  // Fetch full details required for emails, audit logging, and payout processing
  const booking = await getBookingFull(token, { byToken: true, hotelId });

  await logAudit({
    actorId,
    actorType,
    action: 'CHECK_IN_SCANNED',
    entityType: 'Booking',
    entityId: booking.id,
    newValue: { status: 'CHECKED_IN', checkedInAt: booking.checkedInAt },
  });

  // Release held funds to the hotel now that the guest has arrived
  await payoutForBooking({ bookingId: booking.id, actorId, actorType });

  await emailService.sendCheckInConfirmedToGuest(booking.user, booking);
  await emailService.sendFundsReleasedToHotel(booking.hotel, booking);

  return booking;
}

/**
 * Called when the guest checks out (staff-initiated or guest-initiated).
 * Calculates overdue for record-keeping and notification ONLY — does not charge.
 */
async function checkOutGuest({ bookingId, actorId, actorType = 'staff', hotelId }) {
  const booking = await getBookingFull(bookingId, { hotelId });

  if (!booking) throw ApiError.notFound(NOT_FOUND);

  if (booking.status !== 'CHECKED_IN') {
    throw ApiError.badRequest(`Booking is ${booking.status}, expected CHECKED_IN to check out`);
  }

  const now = new Date();
  const scheduledCheckOut = new Date(booking.checkOut);
  let overdueAmount = 0;

  if (now > scheduledCheckOut) {
    const overdueMs = now.getTime() - scheduledCheckOut.getTime();
    const overdueHours = Math.ceil(overdueMs / (1000 * 60 * 60));
    const hourlyRate = Number(booking.room?.price4hr || 0) / 4;
    overdueAmount = overdueHours * hourlyRate;
  }

  const totalLodgeFee = Number(booking.totalAmount) + overdueAmount;

  const { rows } = await pool.query(
    `UPDATE "bookings"
     SET status = 'CHECKED_OUT',
         "checkedOutAt" = $1,
         "overdueAmount" = $2,
         "totalLodgeFee" = $3,
         settled = $4,
         "updatedAt" = NOW()
     WHERE id = $5
     RETURNING *`,
    [now, overdueAmount, totalLodgeFee, overdueAmount === 0, booking.id]
  );

  const updated = rows[0];

  await logAudit({
    actorId,
    actorType,
    action: 'CHECK_OUT_COMPLETED',
    entityType: 'Booking',
    entityId: booking.id,
    newValue: { status: 'CHECKED_OUT', overdueAmount, totalLodgeFee },
  });

  // Notifications only — overdue amount is managed off-app
  await emailService.sendCheckoutSummaryToGuest(booking.user, {
    booking,
    overdueAmount,
    totalLodgeFee,
  });
  await emailService.sendCheckoutSummaryToHotel(booking.hotel, {
    booking,
    overdueAmount,
    totalLodgeFee,
  });

  return updated;
}

/**
 * Hotel marks an overdue balance as collected (cash/POS/etc, outside the app).
 */
async function markOverdueSettled({ bookingId, actorId, actorType = 'staff', hotelId }) {
  const { rowCount } = await pool.query(
    `UPDATE "bookings"
     SET settled = true, "updatedAt" = NOW()
     WHERE id = $1 AND "hotelId" = $2`,
    [String(bookingId), hotelId]
  );

  if (rowCount !== 1) throw ApiError.notFound(NOT_FOUND);

  await logAudit({
    actorId,
    actorType,
    action: 'OVERDUE_MARKED_SETTLED',
    entityType: 'Booking',
    entityId: String(bookingId),
    newValue: { settled: true },
  });

  return { success: true };
}

export { checkInGuest, checkOutGuest, markOverdueSettled };