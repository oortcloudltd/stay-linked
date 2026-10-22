/**
 * controllers/ownerReports.controller.js
 *
 * Reporting data for the owner dashboard.
 *
 * NAMING AUDIT:
 * ─────────────────────────────────────────────────
 * - protect (not authenticate) from auth.middleware.js
 * - HotelOwner model, userId field links to User
 * - No Review model in schema — rating fields are averageRating/totalReviews on Hotel
 * - BookingStatus: PENDING | CONFIRMED | CHECKED_IN | CHECKED_OUT | CANCELLED | NO_SHOW
 * - PaymentChannel: PAYSTACK | CASH | POS | TRANSFER
 * - WalkIn model exists for offline guests
 * - asyncHandler and ApiError are named exports
 */

import prisma from '../config/database.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';

// ─────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────

async function resolveOwner(userId) {
  const owner = await prisma.hotelOwner.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!owner) throw ApiError.forbidden('No owner profile found for this account.');
  return owner;
}

// ─────────────────────────────────────────────
// GET /owner/reports
//
// Query params:
//   hotelId  — filter to a single hotel (optional, defaults to all owner hotels)
//   from     — ISO date string (default: 30 days ago)
//   to       — ISO date string (default: now)
//   period   — 'day' | 'week' | 'month' (used for grouping — currently returns
//              raw data; charting granularity handled by the frontend)
//
// Returns:
//   - occupancyRate        — % of nights booked vs. available over the period
//   - bookingsByStatus     — counts per BookingStatus value
//   - bookingsByChannel    — PAYSTACK / CASH / POS / TRANSFER counts + revenue
//   - revenueByDay         — array of { date, revenue, bookings } for the range
//   - topRooms             — top 5 rooms by revenue in the period
//   - walkInSummary        — total walk-ins + revenue for the period
//   - cancellationRate     — (cancelled / total) × 100
// ─────────────────────────────────────────────

export const getOwnerReports = asyncHandler(async (req, res) => {
  const owner = await resolveOwner(req.user.id);

  const hotels = await prisma.hotel.findMany({
    where: { ownerId: owner.id },
    select: { id: true, name: true },
  });

  if (hotels.length === 0) {
    return res.json(new ApiResponse(200, buildEmptyReport()));
  }

  const allHotelIds = hotels.map((h) => h.id);

  // ── Parse query params ──────────────────────
  const { hotelId, from, to } = req.query;

  // Validate hotelId belongs to owner if provided
  if (hotelId && !allHotelIds.includes(hotelId)) {
    throw ApiError.forbidden('You do not have access to this hotel.');
  }

  const hotelIds = hotelId ? [hotelId] : allHotelIds;

  const now    = new Date();
  const fromDt = from ? new Date(from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const toDt   = to   ? new Date(to)   : now;

  if (isNaN(fromDt.getTime()) || isNaN(toDt.getTime())) {
    throw ApiError.badRequest('Invalid date range. Use ISO 8601 format.');
  }
  if (fromDt >= toDt) {
    throw ApiError.badRequest('"from" must be before "to".');
  }

  // ── Fetch bookings in range ──────────────────
  const bookings = await prisma.booking.findMany({
    where: {
      hotelId: { in: hotelIds },
      createdAt: { gte: fromDt, lte: toDt },
    },
    select: {
      id: true,
      hotelId: true,
      roomId: true,
      status: true,
      paymentChannel: true,
      totalAmount: true,
      baseAmount: true,
      nights: true,
      checkIn: true,
      checkOut: true,
      createdAt: true,
      room: { select: { id: true, name: true, type: true } },
    },
  });

  // ── Walk-ins in range ────────────────────────
  const walkIns = await prisma.walkIn.findMany({
    where: {
      hotelId: { in: hotelIds },
      checkInTime: { gte: fromDt, lte: toDt },
    },
    select: {
      id: true,
      amount: true,
      paymentMode: true,
      checkInTime: true,
    },
  });

  // ── Room count (for occupancy calculation) ───
  const roomCount = await prisma.room.count({
    where: { hotelId: { in: hotelIds } },
  });

  // ── Bookings by status ───────────────────────
  const statusOrder = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'];
  const bookingsByStatus = Object.fromEntries(statusOrder.map((s) => [s, 0]));
  for (const b of bookings) {
    bookingsByStatus[b.status] = (bookingsByStatus[b.status] ?? 0) + 1;
  }

  // ── Bookings by channel ──────────────────────
  const channelMap = {};
  for (const b of bookings) {
    const ch = b.paymentChannel;
    if (!channelMap[ch]) channelMap[ch] = { channel: ch, count: 0, revenue: 0 };
    channelMap[ch].count   += 1;
    channelMap[ch].revenue += b.totalAmount;
  }
  // Also add walk-in channels
  for (const w of walkIns) {
    const ch = w.paymentMode;
    if (!channelMap[ch]) channelMap[ch] = { channel: ch, count: 0, revenue: 0 };
    channelMap[ch].count   += 1;
    channelMap[ch].revenue += w.amount;
  }
  const bookingsByChannel = Object.values(channelMap);

  // ── Revenue by day ───────────────────────────
  const dayRevMap = {};
  for (const b of bookings) {
    if (!['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'].includes(b.status)) continue;
    const key = b.createdAt.toISOString().slice(0, 10);
    if (!dayRevMap[key]) dayRevMap[key] = { date: key, revenue: 0, bookings: 0 };
    dayRevMap[key].revenue  += b.totalAmount;
    dayRevMap[key].bookings += 1;
  }
  // Fill every day in range with zeros so charts render correctly
  const revenueByDay = [];
  const cursor = new Date(fromDt);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= toDt) {
    const key = cursor.toISOString().slice(0, 10);
    revenueByDay.push(dayRevMap[key] ?? { date: key, revenue: 0, bookings: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  // ── Top rooms by revenue ─────────────────────
  const roomRevMap = {};
  for (const b of bookings) {
    if (!['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'].includes(b.status)) continue;
    const rid = b.roomId;
    if (!roomRevMap[rid]) {
      roomRevMap[rid] = {
        roomId:   rid,
        roomName: b.room?.name ?? 'Unknown',
        roomType: b.room?.type ?? 'SINGLE',
        revenue:  0,
        bookings: 0,
        nights:   0,
      };
    }
    roomRevMap[rid].revenue  += b.baseAmount;
    roomRevMap[rid].bookings += 1;
    roomRevMap[rid].nights   += b.nights;
  }
  const topRooms = Object.values(roomRevMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // ── Walk-in summary ──────────────────────────
  const walkInSummary = {
    count:   walkIns.length,
    revenue: walkIns.reduce((sum, w) => sum + w.amount, 0),
  };

  // ── Occupancy rate ───────────────────────────
  // Occupied nights = sum of nights for CHECKED_IN / CHECKED_OUT bookings
  const occupiedNights = bookings
    .filter((b) => ['CHECKED_IN', 'CHECKED_OUT'].includes(b.status))
    .reduce((sum, b) => sum + b.nights, 0);

  const dayCount        = Math.max(1, Math.ceil((toDt - fromDt) / (1000 * 60 * 60 * 24)));
  const availableNights = roomCount * dayCount;
  const occupancyRate   = availableNights > 0
    ? parseFloat(((occupiedNights / availableNights) * 100).toFixed(1))
    : 0;

  // ── Cancellation rate ────────────────────────
  const total             = bookings.length;
  const cancelled         = bookings.filter((b) => b.status === 'CANCELLED').length;
  const cancellationRate  = total > 0 ? parseFloat(((cancelled / total) * 100).toFixed(1)) : 0;

  return res.json(
    new ApiResponse(200, {
      period:           { from: fromDt.toISOString(), to: toDt.toISOString() },
      occupancyRate,
      cancellationRate,
      bookingsByStatus,
      bookingsByChannel,
      revenueByDay,
      topRooms,
      walkInSummary,
    })
  );
});

function buildEmptyReport() {
  return {
    occupancyRate: 0,
    cancellationRate: 0,
    bookingsByStatus: {},
    bookingsByChannel: [],
    revenueByDay: [],
    topRooms: [],
    walkInSummary: { count: 0, revenue: 0 },
  };
}
