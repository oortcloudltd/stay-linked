-- Enable UUID gen
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- ─────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "UserRole" AS ENUM ('GUEST', 'OWNER', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "HotelStatus" AS ENUM ('PENDING', 'LIVE', 'SUSPENDED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "HotelCategory" AS ENUM ('LUXURY', 'EXECUTIVE', 'STANDARD', 'BUDGET', 'GUEST_HOUSE', 'BOUTIQUE', 'RESORT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "StaffRole" AS ENUM ('MANAGER', 'RECEPTIONIST', 'SUPERVISOR');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentStatus" AS ENUM ('WITHHELD', 'RELEASED', 'REFUNDED', 'PENDING', 'FAILED', 'UNPAID', 'HELD');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentChannel" AS ENUM ('PAYSTACK', 'CASH', 'POS', 'TRANSFER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "RoomType" AS ENUM ('SINGLE', 'DOUBLE', 'TWIN', 'SUITE', 'DELUXE', 'PRESIDENTIAL', 'FAMILY', 'STUDIO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "TransactionType" AS ENUM ('BOOKING_PAYMENT', 'RENEWAL_PAYMENT', 'PAYOUT', 'REFUND');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "TransactionStatus" AS ENUM ('INITIATED', 'SUCCESS', 'FAILED', 'REVERSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ChatChannelStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "MessageSenderType" AS ENUM ('GUEST', 'STAFF', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "MessagePriority" AS ENUM ('NORMAL', 'IMPORTANT', 'URGENT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "MessageReadStatus" AS ENUM ('SENT', 'DELIVERED', 'READ');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ServiceRequestType" AS ENUM ('TOWELS', 'WATER', 'CLEANING', 'LAUNDRY', 'MAINTENANCE', 'FOOD', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ServiceRequestStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "RenewalStatus" AS ENUM ('PENDING_HOTEL_DECISION', 'ACCEPTED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─────────────────────────────────────────────
-- TABLES
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "firstName" TEXT,
  "lastName" TEXT,
  "email" TEXT NOT NULL UNIQUE,
  "phone" TEXT,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'GUEST',
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  "refreshToken" TEXT,
  "profileImage" TEXT,
  "dob" TEXT,
  "addressLine1" TEXT,
  "city" TEXT,
  "residentialState" TEXT,
  "stateOfOrigin" TEXT,
  "localGovernmentOfOrigin" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "verification_codes" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "purpose" TEXT NOT NULL,
  "targetEmail" TEXT,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "hotel_owners" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "businessName" TEXT,
  "cac" TEXT,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "hotels" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "ownerId" TEXT NOT NULL REFERENCES "hotel_owners"("id") ON DELETE RESTRICT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "category" "HotelCategory" NOT NULL DEFAULT 'STANDARD',
  "status" "HotelStatus" NOT NULL DEFAULT 'PENDING',
  "isApproved" BOOLEAN NOT NULL DEFAULT false,
  "approvedAt" TIMESTAMPTZ,
  "approvedBy" TEXT,
  "address" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "lga" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "country" TEXT NOT NULL DEFAULT 'Nigeria',
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "googleMapsUrl" TEXT,
  "landmarks" TEXT[] NOT NULL DEFAULT '{}',
  "phone" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "website" TEXT,
  "images" TEXT[] NOT NULL DEFAULT '{}',
  "amenities" TEXT[] NOT NULL DEFAULT '{}',
  "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
  "bankAccountName" TEXT,
  "bankAccountNumber" TEXT,
  "bankName" TEXT,
  "bankCode" TEXT,
  "cacNumber" TEXT,
  "paystackRecipientCode" TEXT,
  "checkInTime" TEXT,
  "checkOutTime" TEXT,
  "averageRating" DOUBLE PRECISION DEFAULT 0,
  "totalReviews" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "bankAccountVerified" BOOLEAN NOT NULL DEFAULT false,
  "monnifyReservedAccountRef" TEXT
);

CREATE TABLE IF NOT EXISTS "rooms" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "hotelId" TEXT NOT NULL REFERENCES "hotels"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "roomNumber" TEXT,
  "type" "RoomType" NOT NULL DEFAULT 'SINGLE',
  "description" TEXT,
  "pricePerNight" DOUBLE PRECISION NOT NULL,
  "price4hr" DOUBLE PRECISION,
  "price8hr" DOUBLE PRECISION,
  "maxGuests" INTEGER NOT NULL DEFAULT 2,
  "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  "images" TEXT[] NOT NULL DEFAULT '{}',
  "amenities" TEXT[] NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "hotel_staff" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "hotelId" TEXT NOT NULL REFERENCES "hotels"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "pinHash" TEXT,
  "role" "StaffRole" NOT NULL DEFAULT 'RECEPTIONIST',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "refreshToken" TEXT,
  "lastLogin" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "bookings" (
  "id" TEXT PRIMARY KEY, -- STL-YYYYMMDD-XXXX format, generated in app
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "hotelId" TEXT NOT NULL REFERENCES "hotels"("id") ON DELETE RESTRICT,
  "roomId" TEXT NOT NULL REFERENCES "rooms"("id") ON DELETE RESTRICT,
  "checkIn" TIMESTAMPTZ NOT NULL,
  "checkOut" TIMESTAMPTZ NOT NULL,
  "nights" INTEGER NOT NULL,
  "baseAmount" DOUBLE PRECISION NOT NULL,
  "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "serviceFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalAmount" DOUBLE PRECISION NOT NULL,
  "overdueCharges" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "finalAmount" DOUBLE PRECISION,
  "guestName" TEXT NOT NULL,
  "guestPhone" TEXT NOT NULL,
  "guestEmail" TEXT NOT NULL,
  "guestCount" INTEGER NOT NULL DEFAULT 1,
  "specialRequests" TEXT,
  "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
  "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "paymentChannel" "PaymentChannel" NOT NULL DEFAULT 'PAYSTACK',
  "paystackRef" TEXT UNIQUE,
  "paystackAuthUrl" TEXT,
  "qrCodeToken" TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  "qrCodeUrl" TEXT,
  "qrCodeUsedAt" TIMESTAMPTZ,
  "assignedRoom" TEXT,
  "checkedInBy" TEXT,
  "checkInTime" TIMESTAMPTZ,
  "checkOutTime" TIMESTAMPTZ,
  "paymentReleasedAt" TIMESTAMPTZ,
  "paymentReleasedBy" TEXT,
  "holdExpiresAt" TIMESTAMPTZ,
  "checkedInAt" TIMESTAMPTZ,
  "checkedOutAt" TIMESTAMPTZ,
  "overdueAmount" DECIMAL DEFAULT 0,
  "totalLodgeFee" DECIMAL,
  "settled" BOOLEAN NOT NULL DEFAULT false,
  "cancellationReason" TEXT,
  "cancelledAt" TIMESTAMPTZ,
  "cancelReason" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "roomTypeKey" TEXT,
  "idempotencyKey" TEXT,
  CONSTRAINT "bookings_userId_idempotencyKey_key" UNIQUE ("userId", "idempotencyKey")
);

CREATE TABLE IF NOT EXISTS "booking_room_assignments" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "bookingId" TEXT NOT NULL REFERENCES "bookings"("id") ON DELETE RESTRICT,
  "roomId" TEXT NOT NULL REFERENCES "rooms"("id") ON DELETE RESTRICT,
  "assignedById" TEXT NOT NULL,
  "assignedByType" TEXT NOT NULL, -- 'staff' | 'owner'
  "assignedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "releasedAt" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "payments" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "bookingId" TEXT NOT NULL UNIQUE REFERENCES "bookings"("id") ON DELETE RESTRICT,
  "amount" DOUBLE PRECISION NOT NULL,
  "channel" "PaymentChannel" NOT NULL,
  "status" "PaymentStatus" NOT NULL,
  "paystackRef" TEXT,
  "paystackStatus" TEXT,
  "paystackData" JSONB,
  "transferRef" TEXT,
  "releasedAt" TIMESTAMPTZ,
  "releasedBy" TEXT,
  "refundRef" TEXT,
  "refundedAt" TIMESTAMPTZ,
  "refundedBy" TEXT,
  "refundReason" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "walk_ins" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "hotelId" TEXT NOT NULL REFERENCES "hotels"("id") ON DELETE RESTRICT,
  "roomNumber" TEXT NOT NULL,
  "guestName" TEXT NOT NULL,
  "guestPhone" TEXT NOT NULL,
  "guestEmail" TEXT,
  "checkInTime" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "checkOutTime" TIMESTAMPTZ NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "paymentMode" "PaymentChannel" NOT NULL,
  "staffId" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "BookingRenewal" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "bookingId" TEXT NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "extraDays" INTEGER NOT NULL,
  "amount" DECIMAL NOT NULL,
  "status" "RenewalStatus" NOT NULL DEFAULT 'PENDING_HOTEL_DECISION',
  "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "monnifyReference" TEXT UNIQUE,
  "decidedByStaffId" TEXT,
  "decidedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Transaction" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "bookingId" TEXT REFERENCES "bookings"("id") ON DELETE SET NULL,
  "renewalId" TEXT,
  "type" "TransactionType" NOT NULL,
  "status" "TransactionStatus" NOT NULL DEFAULT 'INITIATED',
  "provider" TEXT NOT NULL,
  "providerReference" TEXT NOT NULL UNIQUE,
  "amount" DECIMAL NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "commission" DECIMAL,
  "payoutStatus" TEXT,
  "userId" TEXT,
  "hotelId" TEXT,
  "rawResponse" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "hotelId" TEXT NOT NULL REFERENCES "hotels"("id") ON DELETE CASCADE,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "bookingId" TEXT,
  "metadata" JSONB,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "readAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "staffId" TEXT,
  "hotelId" TEXT REFERENCES "hotels"("id") ON DELETE SET NULL,
  "bookingId" TEXT REFERENCES "bookings"("id") ON DELETE SET NULL,
  "actorId" TEXT,
  "actorType" TEXT,
  "action" TEXT NOT NULL,
  "entity" TEXT,
  "entityId" TEXT,
  "prevValue" JSONB,
  "newValue" JSONB,
  "ip" TEXT,
  "userAgent" TEXT,
  "requestId" TEXT,
  "notes" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "chat_channels" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "bookingId" TEXT NOT NULL UNIQUE REFERENCES "bookings"("id") ON DELETE CASCADE,
  "status" "ChatChannelStatus" NOT NULL DEFAULT 'INACTIVE',
  "unreadByGuest" INTEGER NOT NULL DEFAULT 0,
  "unreadByStaff" INTEGER NOT NULL DEFAULT 0,
  "activatedAt" TIMESTAMPTZ,
  "archivedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "channelId" TEXT NOT NULL REFERENCES "chat_channels"("id") ON DELETE CASCADE,
  "senderId" TEXT,
  "senderType" "MessageSenderType" NOT NULL,
  "content" TEXT NOT NULL,
  "priority" "MessagePriority" NOT NULL DEFAULT 'NORMAL',
  "readStatus" "MessageReadStatus" NOT NULL DEFAULT 'SENT',
  "isSystemMsg" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "service_requests" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "bookingId" TEXT NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "requestType" "ServiceRequestType" NOT NULL,
  "status" "ServiceRequestStatus" NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "acknowledgedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "room_notes" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "channelId" TEXT NOT NULL REFERENCES "chat_channels"("id") ON DELETE CASCADE,
  "authorId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_room_assignments_roomId_active_unique"
ON "booking_room_assignments" ("roomId") WHERE "releasedAt" IS NULL;

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users"("email");
CREATE INDEX IF NOT EXISTS "verification_codes_userId_purpose_createdAt_idx" ON "verification_codes"("userId", "purpose", "createdAt");
CREATE INDEX IF NOT EXISTS "verification_codes_expiresAt_idx" ON "verification_codes"("expiresAt");
CREATE INDEX IF NOT EXISTS "hotels_state_lga_idx" ON "hotels"("state", "lga");
CREATE INDEX IF NOT EXISTS "hotels_status_isApproved_idx" ON "hotels"("status", "isApproved");
CREATE INDEX IF NOT EXISTS "hotels_category_idx" ON "hotels"("category");
CREATE INDEX IF NOT EXISTS "rooms_hotelId_isAvailable_idx" ON "rooms"("hotelId", "isAvailable");
CREATE INDEX IF NOT EXISTS "rooms_pricePerNight_idx" ON "rooms"("pricePerNight");
CREATE INDEX IF NOT EXISTS "hotel_staff_hotelId_idx" ON "hotel_staff"("hotelId");
CREATE INDEX IF NOT EXISTS "hotel_staff_email_idx" ON "hotel_staff"("email");
CREATE INDEX IF NOT EXISTS "bookings_hotelId_roomTypeKey_checkIn_checkOut_idx" ON "bookings"("hotelId", "roomTypeKey", "checkIn", "checkOut");
CREATE INDEX IF NOT EXISTS "bookings_userId_idx" ON "bookings"("userId");
CREATE INDEX IF NOT EXISTS "bookings_hotelId_idx" ON "bookings"("hotelId");
CREATE INDEX IF NOT EXISTS "bookings_status_idx" ON "bookings"("status");
CREATE INDEX IF NOT EXISTS "bookings_paystackRef_idx" ON "bookings"("paystackRef");
CREATE INDEX IF NOT EXISTS "bookings_qrCodeToken_idx" ON "bookings"("qrCodeToken");
CREATE INDEX IF NOT EXISTS "bookings_checkIn_checkOut_idx" ON "bookings"("checkIn", "checkOut");
CREATE INDEX IF NOT EXISTS "booking_room_assignments_bookingId_idx" ON "booking_room_assignments"("bookingId");
CREATE INDEX IF NOT EXISTS "booking_room_assignments_roomId_idx" ON "booking_room_assignments"("roomId");
CREATE INDEX IF NOT EXISTS "payments_bookingId_idx" ON "payments"("bookingId");
CREATE INDEX IF NOT EXISTS "payments_paystackRef_idx" ON "payments"("paystackRef");
CREATE INDEX IF NOT EXISTS "walk_ins_hotelId_idx" ON "walk_ins"("hotelId");
CREATE INDEX IF NOT EXISTS "BookingRenewal_bookingId_idx" ON "BookingRenewal"("bookingId");
CREATE INDEX IF NOT EXISTS "BookingRenewal_status_idx" ON "BookingRenewal"("status");
CREATE INDEX IF NOT EXISTS "Transaction_bookingId_idx" ON "Transaction"("bookingId");
CREATE INDEX IF NOT EXISTS "Transaction_providerReference_idx" ON "Transaction"("providerReference");
CREATE INDEX IF NOT EXISTS "Transaction_status_idx" ON "Transaction"("status");
CREATE INDEX IF NOT EXISTS "notifications_hotelId_read_idx" ON "notifications"("hotelId", "read");
CREATE INDEX IF NOT EXISTS "notifications_hotelId_createdAt_idx" ON "notifications"("hotelId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX IF NOT EXISTS "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX IF NOT EXISTS "AuditLog_hotelId_idx" ON "AuditLog"("hotelId");
CREATE INDEX IF NOT EXISTS "AuditLog_bookingId_idx" ON "AuditLog"("bookingId");
CREATE INDEX IF NOT EXISTS "AuditLog_actorId_idx" ON "AuditLog"("actorId");
CREATE INDEX IF NOT EXISTS "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "chat_messages_channelId_createdAt_idx" ON "chat_messages"("channelId", "createdAt");
CREATE INDEX IF NOT EXISTS "service_requests_bookingId_idx" ON "service_requests"("bookingId");
CREATE INDEX IF NOT EXISTS "room_notes_channelId_idx" ON "room_notes"("channelId");