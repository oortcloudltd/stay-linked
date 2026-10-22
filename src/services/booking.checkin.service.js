import prisma from '../config/database.js';
import { ApiError } from '../utils/ApiError.js';
import { roomTypeKey } from './roomAvailability.service.js';

const lock = (tx, hotelId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`assign|${hotelId}`}))`;

export async function getAssignableRooms({ identifier, hotelId }) {
  const booking = await prisma.booking.findFirst({
    where: { hotelId, status: 'CONFIRMED', OR: [{ id: String(identifier) }, { qrCodeToken: String(identifier) }] },
  });
  if (!booking) throw ApiError.import pool from '../config/database.js';
import { ApiError } from '../utils/ApiError.js';
import { roomTypeKey } from './roomAvailability.service.js';

const lock = async (client, hotelId) => {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`assign|${hotelId}`]);
};

export async function getAssignableRooms({ identifier, hotelId }) {
  const idStr = String(identifier);

  // booking
  const { rows: bookingRows } = await pool.query(
    `SELECT * FROM "bookings" 
     WHERE "hotelId" = $1 
     AND status = 'CONFIRMED' 
     AND (id = $2 OR "qrCodeToken" = $2)
     LIMIT 1`,
    [hotelId, idStr]
  );
  const booking = bookingRows[0];
  if (!booking) throw ApiError.notFound('Booking not found for this hotel');

  // all available rooms in hotel
  const { rows: rooms } = await pool.query(
    `SELECT * FROM "rooms" WHERE "hotelId" = $1 AND "isAvailable" = true`,
    [hotelId]
  );

  if (!rooms.length) {
    return { bookingId: booking.id, mustAssign: booking.quantity ?? 1, rooms: [] };
  }

  const roomIds = rooms.map(r => r.id);

  // busy rooms
  const { rows: busyRows } = await pool.query(
    `SELECT "roomId" FROM "booking_room_assignments" 
     WHERE "releasedAt" IS NULL AND "roomId" = ANY($1)`,
    [roomIds]
  );
  const busy = new Set(busyRows.map(a => a.roomId));

  const refRoom = rooms.find(r => r.id === booking.roomId);
  const key = booking.roomTypeKey ?? roomTypeKey(refRoom ?? {});

  return {
    bookingId: booking.id,
    mustAssign: booking.quantity ?? 1,
    rooms: rooms
      .filter(r => roomTypeKey(r) === key && !busy.has(r.id))
      .map(r => ({ id: r.id, roomNumber: r.roomNumber })),
  };
}

export async function checkInWithRooms({ identifier, hotelId, actor, roomIds }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lock(client, hotelId);

    const idStr = String(identifier);

    const { rows: bookingRows } = await client.query(
      `SELECT * FROM "bookings" 
       WHERE "hotelId" = $1 AND (id = $2 OR "qrCodeToken" = $2)
       LIMIT 1 FOR UPDATE`,
      [hotelId, idStr]
    );

    const booking = bookingRows[0];
    if (!booking) throw ApiError.notFound('Booking not found for this hotel');
    if (booking.status !== 'CONFIRMED') throw ApiError.badRequest(`Booking is ${booking.status}`);
    if (booking.paymentStatus !== 'HELD') throw ApiError.badRequest('Payment is not in a state that allows check-in');

    const ids = [...new Set((roomIds ?? []).map(String))];
    const qty = booking.quantity ?? 1;
    if (ids.length !== qty) throw ApiError.badRequest(`Assign exactly ${qty} room(s)`);

    const { rows: selectedRooms } = await client.query(
      `SELECT * FROM "rooms" WHERE id = ANY($1) AND "hotelId" = $2 AND "isAvailable" = true`,
      [ids, hotelId]
    );

    if (selectedRooms.length !== ids.length) {
      throw ApiError.badRequest('A selected room is unavailable or not in this hotel');
    }

    let key = booking.roomTypeKey;
    if (!key) {
      const { rows: refRows } = await client.query(`SELECT * FROM "rooms" WHERE id = $1 LIMIT 1`, [booking.roomId]);
      key = roomTypeKey(refRows[0] ?? {});
    }

    if (selectedRooms.some(r => roomTypeKey(r) !== key)) {
      throw ApiError.badRequest('A selected room is the wrong type');
    }

    const { rows: occupied } = await client.query(
      `SELECT COUNT(*)::int as cnt FROM "booking_room_assignments" WHERE "roomId" = ANY($1) AND "releasedAt" IS NULL`,
      [ids]
    );

    if (occupied[0].cnt > 0) {
      throw ApiError.conflict('A selected room is already occupied');
    }

    // create assignments
    for (const roomId of ids) {
      await client.query(
        `INSERT INTO "booking_room_assignments" ("bookingId", "roomId", "assignedById", "assignedByType")
         VALUES ($1,$2,$3,$4)`,
        [booking.id, roomId, actor.id, actor.type]
      );
    }

    const assignedRoomStr = selectedRooms.map(r => r.roomNumber).filter(Boolean).join(', ');

    const { rowCount } = await client.query(
      `UPDATE "bookings" 
       SET status = 'CHECKED_IN', "checkedInAt" = NOW(), "assignedRoom" = $2, "updatedAt" = NOW()
       WHERE id = $1 AND status = 'CONFIRMED'`,
      [booking.id, assignedRoomStr]
    );

    if (rowCount !== 1) throw ApiError.conflict('Already checked in');

    await client.query('COMMIT');

    return { bookingId: booking.id, rooms: selectedRooms.map(r => r.roomNumber) };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  // After commit, in the caller: logAudit, payoutForBooking, emails (as the old flow did).
}

export const releaseAssignments = async (clientOrPool, bookingId) => {
  const db = clientOrPool?.query ? clientOrPool : pool;
  const { rowCount } = await db.query(
    `UPDATE "booking_room_assignments" 
     SET "releasedAt" = NOW() 
     WHERE "bookingId" = $1 AND "releasedAt" IS NULL`,
    [bookingId]
  );
  return { count: rowCount };
};

// If you need it to work inside same transaction as caller:
// usage: await releaseAssignments(client, bookingId) where client is from pool.connect() + BEGINnotFound('Booking not found for this hotel');
  const rooms = await prisma.room.findMany({ where: { hotelId, isAvailable: true } });
  const busy = new Set((await prisma.bookingRoomAssignment.findMany({
    where: { releasedAt: null, roomId: { in: rooms.map((r) => r.id) } }, select: { roomId: true },
  })).map((a) => a.roomId));
  const key = booking.roomTypeKey ?? roomTypeKey(rooms.find((r) => r.id === booking.roomId) ?? {});
  return {
    bookingId: booking.id, mustAssign: booking.quantity ?? 1,
    rooms: rooms.filter((r) => roomTypeKey(r) === key && !busy.has(r.id)).map((r) => ({ id: r.id, roomNumber: r.roomNumber })),
  };
}

export async function checkInWithRooms({ identifier, hotelId, actor, roomIds }) {
  return prisma.$transaction(async (tx) => {
    await lock(tx, hotelId);
    const booking = await tx.booking.findFirst({
      where: { hotelId, OR: [{ id: String(identifier) }, { qrCodeToken: String(identifier) }] },
    });
    if (!booking) throw ApiError.notFound('Booking not found for this hotel');       // other hotel's booking looks identical
    if (booking.status !== 'CONFIRMED') throw ApiError.badRequest(`Booking is ${booking.status}`);
    if (booking.paymentStatus !== 'HELD') throw ApiError.badRequest('Payment is not in a state that allows check-in');

    const ids = [...new Set((roomIds ?? []).map(String))];
    const qty = booking.quantity ?? 1;
    if (ids.length !== qty) throw ApiError.badRequest(`Assign exactly ${qty} room(s)`);   // backend is the authority on the count

    const rooms = await tx.room.findMany({ where: { id: { in: ids }, hotelId, isAvailable: true } });
    if (rooms.length !== ids.length) throw ApiError.badRequest('A selected room is unavailable or not in this hotel');
    const refRoom = booking.roomTypeKey ? null : await tx.room.findUnique({ where: { id: booking.roomId } });
    const key = booking.roomTypeKey ?? roomTypeKey(refRoom);
    if (rooms.some((r) => roomTypeKey(r) !== key)) throw ApiError.badRequest('A selected room is the wrong type');
    if (await tx.bookingRoomAssignment.count({ where: { roomId: { in: ids }, releasedAt: null } })) {
      throw ApiError.conflict('A selected room is already occupied');                   // DB partial unique index is the backstop
    }

    await tx.bookingRoomAssignment.createMany({
      data: ids.map((roomId) => ({ bookingId: booking.id, roomId, assignedById: actor.id, assignedByType: actor.type })),
    });
    const moved = await tx.booking.updateMany({
      where: { id: booking.id, status: 'CONFIRMED' },
      data: { status: 'CHECKED_IN', checkedInAt: new Date(), assignedRoom: rooms.map((r) => r.roomNumber).join(', ') },
    });
    if (moved.count !== 1) throw ApiError.conflict('Already checked in');
    return { bookingId: booking.id, rooms: rooms.map((r) => r.roomNumber) };
  });
  // After commit, in the caller: logAudit, payoutForBooking, emails (as the old flow did).
}

export const releaseAssignments = (tx, bookingId) =>
  tx.bookingRoomAssignment.updateMany({ where: { bookingId, releasedAt: null }, data: { releasedAt: new Date() } });