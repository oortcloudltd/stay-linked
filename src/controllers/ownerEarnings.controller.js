/**
 * controllers/ownerEarnings.controller.js
 *
 * Earnings data for the owner dashboard.
 *
 * NAMING AUDIT (schema.prisma + hotel.service.js):
 * ─────────────────────────────────────────────────
 * - Auth middleware exports: protect (not authenticate/verifyToken)
 * - Owner model: HotelOwner (not Owner)
 * - Owner ID on Hotel: ownerId → references HotelOwner.id
 * - Hotel → HotelOwner link: hotel.owner.userId === req.user.id
 * - No dedicated Payout/Earnings table — derived from Booking + Payment
 * - asyncHandler: named export { asyncHandler }
 * - ApiError: named export { ApiError }
 * - PaymentStatus enum: WITHHELD | RELEASED | REFUNDED | PENDING | FAILED
 * - BookingStatus enum: PENDING | CONFIRMED | CHECKED_IN | CHECKED_OUT | CANCELLED | NO_SHOW
 */

import prisma from '../config/database.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';

// ─────────────────────────────────────────────
// HELPER — resolve HotelOwner.id from req.user.id
// req.user is the User record (role: OWNER).
// We need the HotelOwner record that has userId === req.user.id.
// ─────────────────────────────────────────────

async function resolveOwner(userId) {
  const owner = await prisma.hotelOwner.findUnique({
    where: { userId },
    select: { id: true, verified: true },
  });
  if (!owner) throw ApiError.forbidden('No owner profile found for this account.');
  return owner;
}

// ─────────────────────────────────────────────
// GET /owner/earnings
//
// Returns:
//  - totalEarnings     — sum of RELEASED payments across all owner hotels
//  - pendingEarnings   — sum of WITHHELD payments (confirmed, not yet checked in)
//  - thisMonth         — RELEASED this calendar month
//  - lastMonth         — RELEASED last calendar month
//  - monthlyBreakdown  — array of { month, gross, net, commission, bookings }
//                        for the last 12 months
//  - byHotel           — per-hotel earnings summary
// ─────────────────────────────────────────────

export const getOwnerEarnings = asyncHandler(async (req, res) => {
  const owner = await resolveOwner(req.user.id);

  // All hotel IDs owned by this owner
  const hotels = await prisma.hotel.findMany({
    where: { ownerId: owner.id },
    select: { id: true, name: true, commissionRate: true },
  });

  if (hotels.length === 0) {
    return res.json(
      new ApiResponse(200, {
        totalEarnings: 0,
        pendingEarnings: 0,
        thisMonth: 0,
        lastMonth: 0,
        monthlyBreakdown: [],
        byHotel: [],
      })
    );
  }

  const hotelIds = hotels.map((h) => h.id);
  const hotelMap = Object.fromEntries(hotels.map((h) => [h.id, h]));

  // ── Date windows ────────────────────────────────
  const now = new Date();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const twelveMonthsAgo  = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  // ── Released payments (actual earnings) ─────────
  const releasedPayments = await prisma.payment.findMany({
    where: {
      status: 'RELEASED',
      booking: { hotelId: { in: hotelIds } },
    },
    select: {
      amount: true,
      releasedAt: true,
      booking: {
        select: {
          hotelId: true,
          totalAmount: true,
          baseAmount: true,
        },
      },
    },
  });

  // ── Withheld payments (confirmed but not yet checked in) ──
  const withheldPayments = await prisma.payment.findMany({
    where: {
      status: 'WITHHELD',
      booking: { hotelId: { in: hotelIds } },
    },
    select: {
      amount: true,
      booking: { select: { hotelId: true } },
    },
  });

  // ── Aggregate totals ────────────────────────────
  let totalEarnings    = 0;
  let pendingEarnings  = 0;
  let thisMonthTotal   = 0;
  let lastMonthTotal   = 0;

  // Per-month map: key = "YYYY-MM"
  const monthMap = {};
  // Per-hotel map
  const hotelEarnings = {};

  for (const p of releasedPayments) {
    const hotel        = hotelMap[p.booking.hotelId];
    const commission   = p.booking.baseAmount * (hotel?.commissionRate ?? 0.05);
    const netToOwner   = p.amount - commission;

    totalEarnings += netToOwner;

    // This month / last month
    if (p.releasedAt >= startOfThisMonth) {
      thisMonthTotal += netToOwner;
    } else if (p.releasedAt >= startOfLastMonth && p.releasedAt <= endOfLastMonth) {
      lastMonthTotal += netToOwner;
    }

    // Monthly breakdown (last 12 months)
    if (p.releasedAt >= twelveMonthsAgo) {
      const key = `${p.releasedAt.getFullYear()}-${String(p.releasedAt.getMonth() + 1).padStart(2, '0')}`;
      if (!monthMap[key]) {
        monthMap[key] = { month: key, gross: 0, net: 0, commission: 0, bookings: 0 };
      }
      monthMap[key].gross      += p.amount;
      monthMap[key].net        += netToOwner;
      monthMap[key].commission += commission;
      monthMap[key].bookings   += 1;
    }

    // Per-hotel
    const hid = p.booking.hotelId;
    if (!hotelEarnings[hid]) {
      hotelEarnings[hid] = { hotelId: hid, hotelName: hotel?.name ?? 'Unknown', earnings: 0, bookings: 0 };
    }
    hotelEarnings[hid].earnings  += netToOwner;
    hotelEarnings[hid].bookings  += 1;
  }

  for (const p of withheldPayments) {
    const hotel      = hotelMap[p.booking.hotelId];
    const commission = p.amount * (hotel?.commissionRate ?? 0.05);
    pendingEarnings += p.amount - commission;
  }

  // Sort monthly breakdown chronologically
  const monthlyBreakdown = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));

  // Fill in any missing months with zeros (for a complete 12-month chart)
  const filledMonths = [];
  for (let i = 11; i >= 0; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    filledMonths.push(
      monthMap[key] ?? { month: key, gross: 0, net: 0, commission: 0, bookings: 0 }
    );
  }

  return res.json(
    new ApiResponse(200, {
      totalEarnings:    parseFloat(totalEarnings.toFixed(2)),
      pendingEarnings:  parseFloat(pendingEarnings.toFixed(2)),
      thisMonth:        parseFloat(thisMonthTotal.toFixed(2)),
      lastMonth:        parseFloat(lastMonthTotal.toFixed(2)),
      monthlyBreakdown: filledMonths,
      byHotel:          Object.values(hotelEarnings),
    })
  );
});
