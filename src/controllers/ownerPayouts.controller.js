/**
 * controllers/ownerPayouts.controller.js
 *
 * Payout management for the owner dashboard.
 *
 * CRITICAL SCHEMA NOTE:
 * ─────────────────────────────────────────────────
 * There is NO Payout model in schema.prisma.
 * Payout history is the Payment table filtered to status: RELEASED.
 * "Requesting a payout" in the Nigerian hotel context means:
 *   1. Owner sees their WITHHELD balance (confirmed bookings not yet checked in)
 *   2. The real payout happens automatically at check-in (payment released to hotel)
 *   3. What we expose here is a payout history (RELEASED payments) + bank details management.
 *
 * If you later add manual bank transfers (owner requests early release), that
 * can be added as a PayoutRequest model — but don't invent it now.
 *
 * NAMING AUDIT:
 * - protect (not authenticate) from auth.middleware.js
 * - HotelOwner model (not Owner), field: userId
 * - Hotel.bankAccountName / bankAccountNumber / bankName — the payout bank details
 * - Payment model: status RELEASED = paid out, WITHHELD = pending
 * - asyncHandler + ApiError = named exports
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
// GET /owner/payouts
//
// Returns:
//   - availableBalance  — WITHHELD payments (confirmed, not yet checked in)
//                         This is what will auto-release at guest check-in.
//   - totalPaidOut      — sum of all RELEASED payments to date
//   - payoutHistory     — paginated list of RELEASED payments with booking details
// ─────────────────────────────────────────────

export const getOwnerPayouts = asyncHandler(async (req, res) => {
  const owner = await resolveOwner(req.user.id);

  const hotels = await prisma.hotel.findMany({
    where: { ownerId: owner.id },
    select: {
      id: true,
      name: true,
      commissionRate: true,
      bankAccountName: true,
      bankAccountNumber: true,
      bankName: true,
    },
  });

  if (hotels.length === 0) {
    return res.json(
      new ApiResponse(200, {
        availableBalance: 0,
        totalPaidOut: 0,
        payoutHistory: [],
        pagination: { page: 1, limit: 20, total: 0, pages: 0 },
        bankDetails: [],
      })
    );
  }

  const hotelIds = hotels.map((h) => h.id);
  const hotelMap = Object.fromEntries(hotels.map((h) => [h.id, h]));

  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const skip  = (page - 1) * limit;

  // ── WITHHELD balance ─────────────────────────
  const withheldPayments = await prisma.payment.findMany({
    where: {
      status: 'WITHHELD',
      booking: { hotelId: { in: hotelIds } },
    },
    select: {
      amount: true,
      booking: { select: { hotelId: true, baseAmount: true } },
    },
  });

  let availableBalance = 0;
  for (const p of withheldPayments) {
    const hotel      = hotelMap[p.booking.hotelId];
    const commission = p.booking.baseAmount * (hotel?.commissionRate ?? 0.05);
    availableBalance += p.amount - commission;
  }

  // ── RELEASED total ───────────────────────────
  const releasedAggregate = await prisma.payment.aggregate({
    where: {
      status: 'RELEASED',
      booking: { hotelId: { in: hotelIds } },
    },
    _sum: { amount: true },
  });

  // Subtract commission from released total
  const releasedPaymentsForCommission = await prisma.payment.findMany({
    where: {
      status: 'RELEASED',
      booking: { hotelId: { in: hotelIds } },
    },
    select: {
      amount: true,
      booking: { select: { hotelId: true, baseAmount: true } },
    },
  });

  let totalCommissionOnReleased = 0;
  for (const p of releasedPaymentsForCommission) {
    const hotel       = hotelMap[p.booking.hotelId];
    totalCommissionOnReleased += p.booking.baseAmount * (hotel?.commissionRate ?? 0.05);
  }

  const grossReleased = releasedAggregate._sum.amount ?? 0;
  const totalPaidOut  = grossReleased - totalCommissionOnReleased;

  // ── Payout history (paginated RELEASED payments) ──
  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where: {
        status: 'RELEASED',
        booking: { hotelId: { in: hotelIds } },
      },
      skip,
      take: limit,
      orderBy: { releasedAt: 'desc' },
      select: {
        id: true,
        amount: true,
        channel: true,
        releasedAt: true,
        transferRef: true,
        booking: {
          select: {
            id: true,
            hotelId: true,
            guestName: true,
            checkIn: true,
            checkOut: true,
            nights: true,
            baseAmount: true,
            totalAmount: true,
            room: { select: { name: true, type: true } },
          },
        },
      },
    }),
    prisma.payment.count({
      where: {
        status: 'RELEASED',
        booking: { hotelId: { in: hotelIds } },
      },
    }),
  ]);

  // Attach net amount per payout entry
  const payoutHistory = payments.map((p) => {
    const hotel      = hotelMap[p.booking.hotelId];
    const commission = p.booking.baseAmount * (hotel?.commissionRate ?? 0.05);
    return {
      id:           p.id,
      gross:        parseFloat(p.amount.toFixed(2)),
      commission:   parseFloat(commission.toFixed(2)),
      net:          parseFloat((p.amount - commission).toFixed(2)),
      channel:      p.channel,
      transferRef:  p.transferRef,
      releasedAt:   p.releasedAt,
      hotelName:    hotel?.name ?? 'Unknown',
      booking: {
        id:        p.booking.id,
        guestName: p.booking.guestName,
        checkIn:   p.booking.checkIn,
        checkOut:  p.booking.checkOut,
        nights:    p.booking.nights,
        room:      p.booking.room,
      },
    };
  });

  // ── Bank details per hotel ───────────────────
  const bankDetails = hotels.map((h) => ({
    hotelId:          h.id,
    hotelName:        h.name,
    bankAccountName:  h.bankAccountName,
    bankAccountNumber: h.bankAccountNumber,
    bankName:         h.bankName,
    hasBankDetails:   !!(h.bankAccountName && h.bankAccountNumber && h.bankName),
  }));

  return res.json(
    new ApiResponse(200, {
      availableBalance: parseFloat(availableBalance.toFixed(2)),
      totalPaidOut:     parseFloat(totalPaidOut.toFixed(2)),
      payoutHistory,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
      bankDetails,
    })
  );
});

// ─────────────────────────────────────────────
// PUT /owner/payouts/bank-details/:hotelId
//
// Update bank account details for a hotel.
// These are used when the platform manually transfers payouts.
// ─────────────────────────────────────────────

export const updateBankDetails = asyncHandler(async (req, res) => {
  const owner = await resolveOwner(req.user.id);
  const { hotelId } = req.params;
  const { bankAccountName, bankAccountNumber, bankName } = req.body;

  // Verify hotel belongs to owner
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, ownerId: owner.id },
    select: { id: true },
  });
  if (!hotel) throw ApiError.notFound('Hotel not found or you do not have access.');

  if (!bankAccountName?.trim() || !bankAccountNumber?.trim() || !bankName?.trim()) {
    throw ApiError.badRequest('bankAccountName, bankAccountNumber, and bankName are all required.');
  }

  // Basic Nigerian account number validation (10 digits)
  if (!/^\d{10}$/.test(bankAccountNumber.trim())) {
    throw ApiError.badRequest('Account number must be exactly 10 digits.');
  }

  const updated = await prisma.hotel.update({
    where: { id: hotelId },
    data: {
      bankAccountName:   bankAccountName.trim(),
      bankAccountNumber: bankAccountNumber.trim(),
      bankName:          bankName.trim(),
    },
    select: {
      id: true,
      name: true,
      bankAccountName: true,
      bankAccountNumber: true,
      bankName: true,
    },
  });

  return res.json(new ApiResponse(200, updated, 'Bank details updated successfully.'));
});
