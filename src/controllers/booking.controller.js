import * as bookingService from '../services/booking.service.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import prisma from '../config/database.js';
import { ApiError } from '../utils/ApiError.js';

// ─── Guest ────────────────────────────────────

export const createBooking = asyncHandler(async (req, res) => {
  const result = await bookingService.createBooking(req.user.id, req.body);
  ApiResponse.created(res, result, 'Booking initiated. Proceed to payment.');
});

export const getMyBookings = asyncHandler(async (req, res) => {
  const result = await bookingService.getGuestBookings(req.user.id, req.query);
  ApiResponse.paginated(res, result.bookings, result.pagination);
});

export const getMyBookingById = asyncHandler(async (req, res) => {
  const booking = await bookingService.getBookingById(req.params.id, req.user.id);
  ApiResponse.ok(res, booking);
});

// ─── Guest- location ────────────────────────────────────
export const getBookingNavigation = asyncHandler(async (req, res) => {
  const b = await prisma.booking.findFirst({
    where: { id: req.params.id, userId: req.user.id },          // ownership from the token, never the client
    select: { status: true, hotel: { select: { name: true, address: true, city: true, state: true, latitude: true, longitude: true, googleMapsUrl: true, landmarks: true, phone: true } } },
  });
  if (!b) throw ApiError.notFound('Booking not found');
  if (!['CONFIRMED', 'CHECKED_IN'].includes(b.status)) throw ApiError.forbidden('Directions unlock once your booking is confirmed');
  ApiResponse.ok(res, { canNavigate: b.status === 'CONFIRMED', hotel: b.hotel });
});

export const verifyPayment = asyncHandler(async (req, res) => {
  const result = await bookingService.verifyBookingPayment(req.params.reference, req.user.id);
  ApiResponse.ok(res, result, 'Payment verification complete');
});

export const cancelBooking = asyncHandler(async (req, res) => {
  const result = await bookingService.cancelBooking({
    bookingId: req.params.id,
    userId: req.user.id,
    reason: req.body.reason,
  });
  ApiResponse.ok(res, result, 'Booking cancelled');
});

// ─── Staff & Owner (Hotel Dashboard) ──────────

export const getHotelBookings = asyncHandler(async (req, res) => {
  const result = await bookingService.getHotelBookings(req.hotelId, req.query);
  ApiResponse.paginated(res, result.bookings, result.pagination);
});

export const checkInGuest = asyncHandler(async (req, res) => {
  const io = req.app.get('io');
  const result = await bookingService.checkInGuest({
    ...req.body,
    staffId: req.actor.id,
    hotelId: req.hotelId,
    io,
  });
  ApiResponse.ok(res, result, 'Guest checked in successfully');
});

export const checkOutGuest = asyncHandler(async (req, res) => {
  const io = req.app.get('io');
  const result = await bookingService.checkOutGuest({
    bookingId: req.params.id,
    pin: req.body.pin,
    staffId: req.actor.id,
    hotelId: req.hotelId,
    io,
  });
  ApiResponse.ok(res, result, 'Guest checked out successfully');
});

export const createWalkIn = asyncHandler(async (req, res) => {
  const io = req.app.get('io');
  const walkIn = await bookingService.createWalkIn({
    staffId: req.actor.id,
    hotelId: req.hotelId,
    data: req.body,
    io,
  });
  ApiResponse.created(res, walkIn, 'Walk-in recorded successfully');
});

export const getActiveRooms = asyncHandler(async (req, res) => {
  const rooms = await bookingService.getActiveHotelRooms(req.hotelId);
  ApiResponse.ok(res, rooms);
});

// ─── Webhook ──────────────────────────────────

export const paystackWebhook = asyncHandler(async (req, res) => {
  // Respond 200 immediately — Paystack expects fast acknowledgment
  res.status(200).json({ received: true });

  const io = req.app.get('io');
  await bookingService.handlePaystackWebhook(req.body, io);
});
