import { z } from 'zod';

const NIGERIAN_STATES = [
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno',
  'Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo',
  'Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa',
  'Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba',
  'Yobe','Zamfara',
];

const empty = (v) => (v === '' || v == null ? undefined : v);
const coord = (min, max) => z.preprocess(empty, z.coerce.number().min(min).max(max).optional());
const list = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v.split(',').map((s) => s.trim()).filter(Boolean); }
}, z.array(z.string().max(100)).max(50));

const MAPS_HOSTS = ['google.com', 'www.google.com', 'maps.google.com', 'maps.app.goo.gl', 'goo.gl'];
const mapsUrl = z.preprocess(empty, z.string().url().max(500).refine((u) => {
  try {
    const { protocol, hostname } = new URL(u);
    return protocol === 'https:' && MAPS_HOSTS.includes(hostname);
  } catch {
    return false;
  }
}, 'Use a Google Maps link').optional());

const locationCheck = (d, ctx) => {
  const hasLat = d.latitude !== undefined, hasLng = d.longitude !== undefined;
  if (hasLat !== hasLng) {
    ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'Provide both latitude and longitude' });
  }
  if (hasLat && hasLng && !(d.latitude >= 4 && d.latitude <= 14 && d.longitude >= 2.5 && d.longitude <= 15)) {
    ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'Coordinates are outside Nigeria. Check the pin.' });
  }
};

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Use a valid date in YYYY-MM-DD format');

export const hotelAvailabilitySchema = z.object({
  checkIn: dateOnly.optional(),
  checkOut: dateOnly.optional(),
}).superRefine((value, ctx) => {
  if (Boolean(value.checkIn) !== Boolean(value.checkOut)) {
    ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'Provide both check-in and check-out dates' });
  } else if (value.checkIn && value.checkOut && value.checkOut <= value.checkIn) {
    ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'Check-out must be after check-in' });
  }
});

const hotelBase = z.object({
  name: z.string().min(2, 'Hotel name is required').max(200),
  description: z.string().max(2000).optional(),
  category: z.enum(['LUXURY','EXECUTIVE','STANDARD','BUDGET','GUEST_HOUSE','BOUTIQUE','RESORT']),
  address: z.string().min(5, 'Address is required').max(500),
  city: z.string().min(2, 'City is required').max(100),
  lga: z.string().min(2, 'LGA is required').max(100),
  state: z.enum(NIGERIAN_STATES, { errorMap: () => ({ message: 'Select a valid Nigerian state' }) }),
  latitude: coord(-90, 90),
  longitude: coord(-180, 180),
  googleMapsUrl: mapsUrl,
  phone: z.string().regex(/^\+?234[0-9]{10}$|^0[7-9][0-1][0-9]{8}$/, 'Enter a valid Nigerian phone number'),
  email: z.preprocess(empty, z.string().email().toLowerCase().optional()),
  website: z.string().url().optional().or(z.literal('')),
  amenities: list.default([]),
  landmarks: list.default([]),
  checkInTime: z.string().max(20).optional(),
  checkOutTime: z.string().max(20).optional(),
  bankCode: z.string().max(10).optional(),
  bankAccountName: z.string().max(200).optional(),
  bankAccountNumber: z.string().regex(/^\d{10}$/, 'Enter a valid 10-digit account number').optional(),
  bankName: z.string().max(100).optional(),
  cacNumber: z.string().max(50).optional(),
});

export const createHotelSchema = hotelBase.superRefine(locationCheck);
export const updateHotelSchema = hotelBase.partial().superRefine(locationCheck);

export const commissionSchema = z.object({
  commissionRate: z.coerce.number()
    .refine((v) => [10, 12, 15].includes(v), 'Commission must be 10, 12 or 15')
    .transform((v) => v / 100),
});

export const rejectHotelSchema = z.object({
  reason: z.string().trim().min(5, 'Please provide a reason').max(500),
});

export const createRoomSchema = z.object({
  name: z.string().min(2, 'Room name is required').max(200),
  roomNumber: z.string().max(20).optional(),
  type: z.enum(['SINGLE','DOUBLE','TWIN','SUITE','DELUXE','PRESIDENTIAL','FAMILY','STUDIO']),
  description: z.string().max(1000).optional(),
  pricePerNight: z.number().positive('Price must be greater than 0').max(10_000_000),
  maxGuests: z.number().int().min(1).max(20).default(2),
  amenities: z.array(z.string()).max(30).default([]),
});

export const updateRoomSchema = createRoomSchema.partial();

export const createStaffSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  role: z.enum(['MANAGER','RECEPTIONIST','SUPERVISOR']).default('RECEPTIONIST'),
  pin: z.string().length(4).regex(/^\d{4}$/, 'PIN must be 4 digits').optional(),
});

export const hotelSearchSchema = z.object({
  search: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  lga: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  category: z.enum(['LUXURY','EXECUTIVE','STANDARD','BUDGET','GUEST_HOUSE','BOUTIQUE','RESORT']).optional(),
  minPrice: z.coerce.number().finite().min(0).optional(),
  maxPrice: z.coerce.number().finite().min(0).optional(),
  guests: z.coerce.number().int().min(1).max(20).default(1),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['price','rating','name','newest']).default('rating'),
}).refine((d) => d.minPrice === undefined || d.maxPrice === undefined || d.minPrice <= d.maxPrice, {
  message: 'Minimum price must not exceed maximum price',
  path: ['minPrice'],
});
