import { z } from 'zod';

const MAX_NIGHTS = 30;
const DAY_MS = 86_400_000;

export const createBookingSchema = z.object({
  hotelId: z.string().min(1, 'Hotel ID is required'),
  roomTypeKey: z.string().min(3, 'Room type is required').max(200),
  quantity: z.coerce.number().int().min(1).max(10).default(1),
  checkIn: z.string()
    .refine((d) => !isNaN(Date.parse(d)), 'Invalid check-in date')
    .refine((d) => new Date(d) >= new Date(new Date().setHours(0, 0, 0, 0)), 'Check-in cannot be in the past'),
  checkOut: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid check-out date'),
  guestCount: z.coerce.number().int().min(1).max(20).default(1),
  specialRequests: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
}).refine(
  (d) => new Date(d.checkOut) > new Date(d.checkIn),
  { message: 'Check-out must be after check-in', path: ['checkOut'] }
).refine(
  (d) => (new Date(d.checkOut) - new Date(d.checkIn)) / DAY_MS <= MAX_NIGHTS,
  { message: `Maximum stay is ${MAX_NIGHTS} nights`, path: ['checkOut'] }
);

export const walkInSchema = z.object({
  roomNumber: z.string().min(1, 'Room number is required'),
  guestName: z.string().min(2, 'Guest name is required'),
   guestPhone: z.string().regex(/^\+?234[0-9]{10}$|^0[7-9][0-1][0-9]{8}$/, 'Valid Nigerian phone required'),
  guestEmail: z.string().email().optional(),
  checkOutTime: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid checkout time'),
  amount: z.number().positive('Amount must be greater than 0'),
  paymentMode: z.enum(['CASH', 'POS', 'TRANSFER']),
  notes: z.string().max(500).optional(),
});

export const checkInSchema = z.object({
  identifier: z.string().min(1, 'Booking ID or QR token is required'),
  pin: z.string().length(4, 'PIN must be 4 digits').regex(/^\d{4}$/).optional(),
  roomIds: z.array(z.string().min(1)).min(1, 'Select the room(s) to assign').max(10),
});

export const checkOutSchema = z.object({
  bookingId: z.string().min(1).optional(),
  pin: z.string().length(4).regex(/^\d{4}$/).optional(),
});

export const cancelBookingSchema = z.object({
  reason: z.string().trim().min(5, 'Please provide a cancellation reason').max(500),
});