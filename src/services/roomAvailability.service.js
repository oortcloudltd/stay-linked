import { ApiError } from '../utils/ApiError.js';

const HOLD = ['PENDING'];                 // unpaid; counts only while the hold is live
const LIVE_STATES = ['CONFIRMED'];        // paid, awaiting arrival
export const roomTypeKey = (r) => `${r.type}|${String(r.name).trim().toLowerCase()}`;
export const parseDay = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00.000Z`);

/** Map<typeKey, { rooms, total, committed, available }> for [checkIn, checkOut). Half-open: a guest leaving on the 5th doesn't block one arriving on the 5th. */
export async function getAvailability(db, { hotelId, checkIn, checkOut, now = new Date() }) {
  // db = pg Pool or Client (pool.query or client.query)
  const query = db.query ? db.query.bind(db) : db; // support both pool and client

  // 1. Get all active rooms for hotel
  const roomsRes = await query(
    `SELECT * FROM "rooms" WHERE "hotelId" = $1 AND "isAvailable" = true`,
    [hotelId]
  );
  const rooms = roomsRes.rows;

  const byKey = new Map();
  const keyOfRoom = new Map();
  for (const r of rooms) {
    const k = roomTypeKey(r);
    keyOfRoom.set(r.id, k);
    if (!byKey.has(k)) byKey.set(k, { key: k, rooms: [], total: 0, committed: 0, available: 0 });
    const e = byKey.get(k); e.rooms.push(r); e.total += 1;
  }

  if (!checkIn || !checkOut) {
    byKey.forEach((e) => { e.available = null; });
    return byKey;
  }

  // 2. Get overlapping bookings [checkIn, checkOut) half-open
  // HOLD + LIVE_STATES that overlap, plus all CHECKED_IN (filtered in JS)
  const bookingsRes = await query(
    `SELECT "roomId", "roomTypeKey", quantity, status, "checkOut", "holdExpiresAt"
     FROM "bookings"
     WHERE "hotelId" = $1
       AND "checkIn" < $2
       AND (
         (status = ANY($3) AND "checkOut" > $4)
         OR status = 'CHECKED_IN'
       )`,
    [hotelId, checkOut, [...HOLD, ...LIVE_STATES], checkIn]
  );

  for (const b of bookingsRes.rows) {
    if (HOLD.includes(b.status) && b.holdExpiresAt && new Date(b.holdExpiresAt) <= now) continue; // expired hold frees stock instantly
    if (b.status === 'CHECKED_IN' && Math.max(new Date(b.checkOut).getTime(), now.getTime()) <= checkIn.getTime()) continue; // overdue guests still occupy until now
    
    const k = b.roomTypeKey ?? keyOfRoom.get(b.roomId);
    if (k && byKey.has(k)) byKey.get(k).committed += b.quantity ?? 1;
  }

  byKey.forEach((e) => { e.available = Math.max(e.total - e.committed, 0); });
  return byKey;
}

/**
 * Serialises concurrent bookings for one hotel+type with a Postgres advisory lock held for the transaction.
 * createFn(client, entry, existingBooking) must create the booking row using client.
 * Final-room race: second caller waits, recounts, gets 409.
 */
export async function withRoomTypeLock(pool, {
  hotelId, key, quantity, checkIn, checkOut, idempotencyKey, userId,
}, createFn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (idempotencyKey) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`idempotency:${idempotencyKey}`]);
      const existingRes = await client.query(
        `SELECT * FROM "bookings" WHERE "userId" = $1 AND "idempotencyKey" = $2 LIMIT 1`,
        [userId, idempotencyKey]
      );
      if (existingRes.rows[0]) {
        const result = await createFn(client, null, existingRes.rows[0]);
        await client.query('COMMIT');
        return result;
      }
    }

    // Lock per hotel+roomType
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${hotelId}|${key}`]);

    const entry = (await getAvailability(client, { hotelId, checkIn, checkOut })).get(key);
    if (!entry) throw ApiError.notFound('Room type not found');
    if (entry.available < quantity) {
      throw ApiError.conflict(entry.available ? `Only ${entry.available} of this room type left for those dates` : 'This room type is sold out for those dates');
    }

    const result = await createFn(client, entry, null);
    await client.query('COMMIT');
    return result;

  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  } finally {
    client.release();
  }
}

/** Call before initiating payment ("check booking payment status before init"). */
export function assertPayable(b, now = new Date()) {
  if (b.status !== 'PENDING') throw ApiError.conflict(`Booking is ${b.status} and cannot be paid`);
  if (['HELD', 'PAID', 'SUCCESS'].includes(b.paymentStatus)) throw ApiError.conflict('This booking is already paid');
  if (b.holdExpiresAt && new Date(b.holdExpiresAt) <= now) throw ApiError.conflict('Your reservation expired. Please book again.');
}