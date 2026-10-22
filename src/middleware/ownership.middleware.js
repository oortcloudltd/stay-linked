import prisma from '../config/database.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** Owner routes: use AFTER protect + protectOwner. Ownership comes from hotel.ownerId in the DB. */
export const requireHotelOwnership = (param = 'hotelId') =>
  asyncHandler(async (req, res, next) => {
    if (!req.owner) throw ApiError.forbidden('Owner account required');
    const hotel = await prisma.hotel.findUnique({
      where: { id: String(req.params[param] ?? '') },
      select: { id: true, ownerId: true },
    });
    // Same answer for "missing" and "not yours": don't reveal which hotel IDs exist.
    if (!hotel || hotel.ownerId !== req.owner.id) throw ApiError.forbidden('You do not have access to this hotel');
    req.hotel = hotel;
    next();
  });

/** Checks optional hotelId query param for reports endpoint and verifies ownership */
export const requireOwnedHotelIfProvided = asyncHandler(async (req, _res, next) => {
  const id = req.query.hotelId;
  if (id) {
    const h = await prisma.hotel.findUnique({ where: { id: String(id) }, select: { ownerId: true } });
    if (!h || h.ownerId !== req.owner.id) throw ApiError.forbidden('You do not have access to this hotel');
  }
  next();
});

/** Staff routes: use AFTER protectStaff. Rejects any hotelId that isn't the staff member's own hotel. */
export function requireStaffHotelScope(req, res, next) {
  if (!req.staff) throw ApiError.forbidden('Staff account required');
  const supplied = [req.params?.hotelId, req.body?.hotelId, req.query?.hotelId]
    .filter((v) => v !== undefined && v !== '');
  if (supplied.some((v) => String(v) !== req.staff.hotelId)) {
    throw ApiError.forbidden('You do not have access to this hotel');
  }
  next();
}

// Scoped lookups: put the trusted scope INSIDE the query so cross-hotel IDs simply don't match.
export const findBookingForStaff = (req, bookingId) =>
  prisma.booking.findFirst({ where: { id: String(bookingId), hotelId: req.staff.hotelId } });

export const findBookingForOwner = (req, bookingId) =>
  prisma.booking.findFirst({ where: { id: String(bookingId), hotel: { ownerId: req.owner.id } } });