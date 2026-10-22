import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import { ApiError } from '../utils/ApiError.js';
import { generateBookingId } from '../utils/generateBookingId.js';
import * as paystackService from './paystack.service.js';
import * as emailService from './email.service.js';
import { logAudit } from './audit.service.js';
import { env } from '../config/env.js';
import { withRoomTypeLock } from './roomAvailability.service.js';
import { roomTypeKey } from './roomAvailability.service.js';

// CREATE BOOKING
export async function createBooking(userId, {
  hotelId, roomTypeKey: rtKey, quantity = 1, checkIn, checkOut, guestCount = 1,
  specialRequests, idempotencyKey,
}) {
  const checkInDate = new Date(`${checkIn}T00:00:00.000Z`);
  const checkOutDate = new Date(`${checkOut}T00:00:00.000Z`);
  const nights = Math.round((checkOutDate - checkInDate) / 86_400_000);
  if (!Number.isInteger(nights) || nights < 1) throw ApiError.badRequest('Minimum stay is 1 night');

  const [{ rows: hotelRows }, { rows: userRows }] = await Promise.all([
    pool.query(`SELECT * FROM "hotels" WHERE id=$1 AND "isApproved"=true AND status='LIVE' LIMIT 1`, [hotelId]),
    pool.query(`SELECT * FROM "users" WHERE id=$1 LIMIT 1`, [userId]),
  ]);
  const hotel = hotelRows[0];
  const user = userRows[0];
  if (!hotel) throw ApiError.notFound('Hotel not found or not available');
  if (!user) throw ApiError.notFound('User not found');

  const reservation = await withRoomTypeLock(
    pool,
    { hotelId, key: rtKey, quantity, checkIn: checkInDate, checkOut: checkOutDate, idempotencyKey, userId },
    async (tx, entry, existing) => {
      if (existing) {
        if (existing.status === 'PENDING' && existing.paystackAuthUrl) {
          return { booking: existing, totalAmount: existing.totalAmount, paystackRef: existing.paystackRef, reused: true };
        }
        throw ApiError.conflict('This booking request has already been processed');
      }
      if (!entry.rooms.length) throw ApiError.notFound('Room type not found');
      const price = entry.rooms[0].pricePerNight;
      if (entry.rooms.some((room) => room.pricePerNight !== price)) {
        throw ApiError.conflict('Rooms in this type have inconsistent prices. Please contact the hotel.');
      }
      const maxGuestsPerRoom = Math.min(...entry.rooms.map((room) => room.maxGuests));
      if (guestCount > maxGuestsPerRoom * quantity) {
        throw ApiError.badRequest('The selected room quantity does not accommodate this many guests');
      }
      if (entry.available < quantity) throw ApiError.badRequest('Not enough rooms available for those dates');

      const baseAmount = Number((price * quantity * nights).toFixed(2));
      const serviceFee = Number((baseAmount * 0.02).toFixed(2));
      const totalAmount = Number((baseAmount + serviceFee).toFixed(2));
      const bookingId = await generateBookingId();
      const paystackRef = `STL-PAY-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

      const booking = await tx.booking.create({
        data: {
          id: bookingId, userId, hotelId, roomId: entry.rooms[0].id,
          roomTypeKey: rtKey, quantity, idempotencyKey,
          checkIn: checkInDate, checkOut: checkOutDate, nights,
          baseAmount, serviceFee, totalAmount,
          guestName: user.name, guestPhone: user.phone || '', guestEmail: user.email,
          guestCount, specialRequests,
          paystackRef, holdExpiresAt: new Date(Date.now() + 15 * 60_000),
        },
      });
      return { booking, totalAmount, paystackRef, reused: false };
    },
  );

  if (reservation.reused) {
    return {
      bookingId: reservation.booking.id,
      authorizationUrl: reservation.booking.paystackAuthUrl,
      reference: reservation.paystackRef,
      totalAmount: reservation.totalAmount,
      nights: reservation.booking.nights,
    };
  }

  let paymentData;
  try {
    paymentData = await paystackService.initializeTransaction({
      email: user.email,
      amount: reservation.totalAmount,
      reference: reservation.paystackRef,
      callbackUrl: `${env.FRONTEND_URL}/booking/verify?ref=${reservation.paystackRef}`,
      metadata: { bookingId: reservation.booking.id, hotelId, roomTypeKey: rtKey, quantity, guestName: user.name, checkIn, checkOut, nights },
    });
  } catch (error) {
    await pool.query(`UPDATE "bookings" SET status='CANCELLED', "holdExpiresAt"=NOW(), "updatedAt"=NOW() WHERE id=$1 AND status='PENDING'`, [reservation.booking.id]);
    throw error;
  }

  await pool.query(`UPDATE "bookings" SET "paystackAuthUrl"=$1, "updatedAt"=NOW() WHERE id=$2`, [paymentData.authorization_url, reservation.booking.id]);
  
  logAudit({
    action: 'BOOKING_CREATED', entity: 'Booking', userId, hotelId, bookingId: reservation.booking.id,
    newValue: { status: 'PENDING', totalAmount: reservation.totalAmount, paystackRef: reservation.paystackRef },
  });

  return {
    bookingId: reservation.booking.id,
    authorizationUrl: paymentData.authorization_url,
    reference: reservation.paystackRef,
    totalAmount: reservation.totalAmount,
    nights,
  };
}

// HANDLE PAYSTACK WEBHOOK
export async function handlePaystackWebhook(event, io) {
  const { event: eventType, data } = event;

  if (eventType === 'charge.success') {
    const { rows } = await pool.query(
      `SELECT b.*, to_jsonb(h) as hotel, to_jsonb(r) as room
       FROM "bookings" b LEFT JOIN "hotels" h ON h.id=b."hotelId" LEFT JOIN "rooms" r ON r.id=b."roomId"
       WHERE b."paystackRef"=$1 LIMIT 1`, [data.reference]
    );
    const booking = rows[0];
    if (!booking) { console.error(`Webhook: Booking not found for ref ${data.reference}`); return; }
    if (booking.status !== 'PENDING') return;

    const qrPayload = JSON.stringify({ bookingId: booking.id, token: booking.qrCodeToken });
    const qrCodeDataUrl = await QRCode.toDataURL(qrPayload, { width: 300, margin: 2 });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE "bookings" SET status='CONFIRMED', "paymentStatus"='WITHHELD', "qrCodeUrl"=$1, "updatedAt"=NOW() WHERE id=$2`, [qrCodeDataUrl, booking.id]);
      await client.query(`INSERT INTO "payments" ("bookingId", amount, channel, status, "paystackRef", "paystackStatus", "paystackData") VALUES ($1,$2,'PAYSTACK','WITHHELD',$3,$4,$5)`,
        [booking.id, booking.totalAmount, data.reference, data.status, JSON.stringify(data)]);
      await client.query(`INSERT INTO "notifications" ("hotelId", type, title, message, "bookingId") VALUES ($1,'booking_new','New Booking Received',$2,$3)`,
        [booking.hotelId, `${booking.guestName} booked ${booking.room?.name || 'a room'} for ${booking.nights} night(s). Check-in: ${new Date(booking.checkIn).toLocaleDateString('en-NG')}`, booking.id]);
      await client.query('COMMIT');
    } catch(e){ await client.query('ROLLBACK'); throw e; } finally { client.release(); }

    logAudit({ action:'PAYMENT_CONFIRMED', entity:'Booking', bookingId: booking.id, hotelId: booking.hotelId, userId: booking.userId, prevValue:{status:'PENDING'}, newValue:{status:'CONFIRMED', paystackRef: data.reference} });

    if (io) io.to(`hotel:${booking.hotelId}`).emit('booking:new', { bookingId: booking.id, guestName: booking.guestName, roomName: booking.room?.name, checkIn: booking.checkIn, checkOut: booking.checkOut, nights: booking.nights, totalAmount: booking.totalAmount });
    await emailService.sendBookingConfirmation({ booking, hotel: booking.hotel, room: booking.room, qrCodeDataUrl });
  }

  if (eventType === 'transfer.success') {
    await pool.query(`UPDATE "payments" SET status='RELEASED', "releasedAt"=NOW(), "updatedAt"=NOW() WHERE "bookingId"=$1`, [data.reason]);
  }
}

// CHECK-IN GUEST
export async function checkInGuest({ identifier, pin, assignedRoom, staffId, hotelId, io }) {
  const { rows } = await pool.query(
    `SELECT b.*, to_jsonb(h) as hotel, to_jsonb(r) as room, to_jsonb(p) as payment, to_jsonb(cc) as "chatChannel"
     FROM "bookings" b LEFT JOIN "hotels" h ON h.id=b."hotelId" LEFT JOIN "rooms" r ON r.id=b."roomId" LEFT JOIN "payments" p ON p."bookingId"=b.id LEFT JOIN "chat_channels" cc ON cc."bookingId"=b.id
     WHERE b."hotelId"=$1 AND (b.id=$2 OR b."qrCodeToken"=$2) LIMIT 1`, [hotelId, String(identifier)]
  );
  const booking = rows[0];
  if (!booking) throw ApiError.notFound('Booking not found. Check the ID or QR code and try again.');
  if (booking.status === 'CHECKED_IN') throw ApiError.badRequest('Guest has already checked in.');
  if (booking.status === 'CANCELLED') throw ApiError.badRequest('This booking was cancelled.');
  if (booking.status === 'NO_SHOW') throw ApiError.badRequest('This booking was marked as no-show.');
  if (booking.status !== 'CONFIRMED') throw ApiError.badRequest(`Booking is in an invalid state: ${booking.status}`);
  if (booking.paymentStatus !== 'WITHHELD') throw ApiError.badRequest('Payment not confirmed for this booking. Cannot check in.');

  if (assignedRoom) {
    const { rows: clash } = await pool.query(`SELECT * FROM "bookings" WHERE "hotelId"=$1 AND "assignedRoom"=$2 AND status='CHECKED_IN' AND id != $3 LIMIT 1`, [hotelId, assignedRoom, booking.id]);
    if (clash[0]) throw ApiError.conflict(`Room ${assignedRoom} is currently occupied by ${clash[0].guestName}. Check them out first or assign a different room.`);
  }

  const { rows: staffRows } = await pool.query(`SELECT * FROM "hotel_staff" WHERE id=$1 LIMIT 1`, [staffId]);
  const staff = staffRows[0];
  if (!staff?.pinHash) throw ApiError.badRequest('You have not set a PIN. Please set your PIN before performing check-ins.');
  if (!(await bcrypt.compare(pin, staff.pinHash))) throw ApiError.unauthorized('Incorrect PIN. Please try again.');

  logAudit({ action:'QR_SCANNED', entity:'Booking', bookingId: booking.id, hotelId, staffId, newValue:{ identifier, assignedRoom } });

  let transferRef = null;
  if (booking.hotel.paystackRecipientCode) {
    try {
      const transfer = await paystackService.initiateTransfer({ amount: booking.totalAmount, recipientCode: booking.hotel.paystackRecipientCode, reason: `StayLink payout — booking ${booking.id}`, reference: `TRF-${booking.id}-${Date.now()}` });
      transferRef = transfer.transfer_code;
    } catch (err) { transferRef = `FAILED-AUTO-${booking.id}`; }
  } else { transferRef = `MANUAL-PENDING-${booking.id}`; }

  const checkInTime = new Date();
  const client = await pool.connect();
  let updatedBooking;
  try {
    await client.query('BEGIN');
    const { rows: ub } = await client.query(`UPDATE "bookings" SET status='CHECKED_IN', "paymentStatus"='RELEASED', "checkInTime"=$1, "checkedInBy"=$2, "assignedRoom"=$3, "paymentReleasedAt"=$1, "paymentReleasedBy"=$2, "qrCodeUsedAt"=$1, "updatedAt"=NOW() WHERE id=$4 RETURNING *, to_jsonb(h) as hotel, to_jsonb(r) as room FROM "bookings" b LEFT JOIN "hotels" h ON h.id=b."hotelId" LEFT JOIN "rooms" r ON r.id=b."roomId" WHERE b.id=$4`.replace(/.*RETURNING.*/,'RETURNING *'), [checkInTime, staffId, assignedRoom||null, booking.id]);
    // need hotel+room for return
    const { rows: full } = await client.query(`SELECT b.*, to_jsonb(h) as hotel, to_jsonb(r) as room FROM "bookings" b LEFT JOIN "hotels" h ON h.id=b."hotelId" LEFT JOIN "rooms" r ON r.id=b."roomId" WHERE b.id=$1`, [booking.id]);
    updatedBooking = full[0];
    await client.query(`UPDATE "payments" SET status='RELEASED', "releasedAt"=$1, "releasedBy"=$2, "transferRef"=$3, "updatedAt"=NOW() WHERE "bookingId"=$4`, [checkInTime, staffId, transferRef, booking.id]);
    await client.query(`INSERT INTO "notifications" ("hotelId", type, title, message, "bookingId") VALUES ($1,'booking_checkin','Guest Checked In',$2,$3)`, [hotelId, `${booking.guestName} has checked into Room ${assignedRoom || booking.room?.name}. Payment released.`, booking.id]);
    await client.query(`UPDATE "chat_channels" SET status='ACTIVE', "activatedAt"=$1, "updatedAt"=NOW() WHERE "bookingId"=$2`, [checkInTime, booking.id]);
    await client.query('COMMIT');
  } catch(e){ await client.query('ROLLBACK'); throw e; } finally { client.release(); }

  logAudit({ action:'CHECKIN', entity:'Booking', bookingId: booking.id, hotelId, staffId, prevValue:{status:'CONFIRMED'}, newValue:{status:'CHECKED_IN', assignedRoom, transferRef} });

  if (booking.chatChannel) {
    await pool.query(`INSERT INTO "chat_messages" ("channelId","senderType","isSystemMsg",content) VALUES ($1,'SYSTEM',true,$2)`, [booking.chatChannel.id, `Welcome${assignedRoom ? ` to Room ${assignedRoom}` : ''}! Chat with the front desk here any time during your stay.`]);
  }

  if (io) {
    io.to(`hotel:${hotelId}`).emit('booking:checkin', { bookingId: booking.id, guestName: booking.guestName, roomName: booking.room?.name, assignedRoom, checkInTime });
    if (booking.chatChannel) io.to(`channel:${booking.chatChannel.id}`).emit('chat:activated', { channelId: booking.chatChannel.id });
  }

  await Promise.all([
    emailService.sendCheckInReceipt({ booking: updatedBooking, hotel: updatedBooking.hotel, room: updatedBooking.room, staffName: staff.name }),
    emailService.sendSettlementNotification({ booking: updatedBooking, hotel: updatedBooking.hotel, room: updatedBooking.room, transferRef }),
  ]);

  return { bookingId: booking.id, guestName: booking.guestName, room: booking.room, assignedRoom, checkInTime, message: 'Check-in successful. Payment released to hotel.' };
}

// CHECK-OUT, WALK-IN, CANCEL, etc. same pattern - use pool.query
export async function checkOutGuest({ bookingId, pin, staffId, hotelId, io }) {
  const { rows } = await pool.query(`SELECT b.*, to_jsonb(h) as hotel, to_jsonb(r) as room, to_jsonb(cc) as "chatChannel" FROM "bookings" b LEFT JOIN "hotels" h ON h.id=b."hotelId" LEFT JOIN "rooms" r ON r.id=b."roomId" LEFT JOIN "chat_channels" cc ON cc."bookingId"=b.id WHERE b.id=$1 AND b."hotelId"=$2 LIMIT 1`, [bookingId, hotelId]);
  const booking = rows[0];
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.status !== 'CHECKED_IN') throw ApiError.badRequest('Guest is not currently checked in');
  if (staffId) {
    const { rows: s } = await pool.query(`SELECT * FROM "hotel_staff" WHERE id=$1`, [staffId]);
    if (s[0]?.pinHash) { if (!(await bcrypt.compare(pin, s[0].pinHash))) throw ApiError.unauthorized('Incorrect PIN'); }
  }
  const checkOutTime = new Date();
  const bookedCheckOut = new Date(booking.checkOut);
  let overdueCharges = 0;
  if (checkOutTime > bookedCheckOut) {
    const overdueHours = (checkOutTime - bookedCheckOut) / (1000*60*60);
    const overdueNights = Math.ceil(overdueHours/24);
    overdueCharges = parseFloat((booking.room.pricePerNight * overdueNights).toFixed(2));
  }
  const finalAmount = parseFloat((booking.totalAmount + overdueCharges).toFixed(2));
  await pool.query(`UPDATE "bookings" SET status='CHECKED_OUT', "checkOutTime"=$1, "overdueCharges"=$2, "finalAmount"=$3, "updatedAt"=NOW() WHERE id=$4`, [checkOutTime, overdueCharges, finalAmount, bookingId]);
  if (booking.chatChannel) {
    await pool.query(`UPDATE "chat_channels" SET status='ARCHIVED', "archivedAt"=$1, "updatedAt"=NOW() WHERE id=$2`, [checkOutTime, booking.chatChannel.id]);
    await pool.query(`INSERT INTO "chat_messages" ("channelId","senderType","isSystemMsg",content) VALUES ($1,'SYSTEM',true,$2)`, [booking.chatChannel.id, 'You have been checked out. Thank you for staying with us — this chat is now archived.']);
  }
  await pool.query(`INSERT INTO "notifications" ("hotelId",type,title,message,"bookingId") VALUES ($1,'booking_checkout','Guest Checked Out',$2,$3)`, [hotelId, `${booking.guestName} has checked out of ${booking.room?.name || 'a room'}.${overdueCharges>0?` Extended stay fee: ₦${overdueCharges.toLocaleString('en-NG')}.`:''}`, bookingId]);
  logAudit({ action:'CHECKOUT', entity:'Booking', bookingId, hotelId, staffId, prevValue:{status:'CHECKED_IN'}, newValue:{status:'CHECKED_OUT', checkOutTime, overdueCharges, finalAmount} });
  if (io) {
    io.to(`hotel:${hotelId}`).emit('booking:checkout', { bookingId, guestName: booking.guestName });
    if (booking.chatChannel) io.to(`channel:${booking.chatChannel.id}`).emit('chat:archived', { channelId: booking.chatChannel.id });
  }
  await emailService.sendCheckoutInvoice({ booking: { ...booking, status:'CHECKED_OUT', checkOutTime, overdueCharges, finalAmount }, hotel: booking.hotel, room: booking.room, overdueCharges, finalAmount });
  return { ...booking, status:'CHECKED_OUT', checkOutTime, overdueCharges, finalAmount };
}

// Other functions remain same pattern - just replace prisma with pool.query
export async function createWalkIn({ staffId, hotelId, data, io }) {
  const { roomNumber, guestName, guestPhone, guestEmail, checkOutTime, amount, paymentMode, notes } = data;
  const { rows } = await pool.query(`INSERT INTO "walk_ins" ("hotelId","roomNumber","guestName","guestPhone","guestEmail","checkInTime","checkOutTime",amount,"paymentMode","staffId",notes) VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7,$8,$9,$10) RETURNING *`, [hotelId, roomNumber, guestName, guestPhone, guestEmail, new Date(checkOutTime), amount, paymentMode, staffId, notes]);
  const walkIn = rows[0];
  await pool.query(`INSERT INTO "notifications" ("hotelId",type,title,message,metadata) VALUES ($1,'walkin_new','Walk-in Guest',$2,$3)`, [hotelId, `${guestName} checked in to Room ${roomNumber}. ₦${amount.toLocaleString('en-NG')} collected via ${paymentMode}.`, JSON.stringify({ walkInId: walkIn.id })]);
  logAudit({ action:'WALKIN_CREATED', entity:'WalkIn', hotelId, staffId, newValue:{ walkInId: walkIn.id, guestName, roomNumber, amount, paymentMode } });
  if (io) io.to(`hotel:${hotelId}`).emit('walkin:new', { guestName, roomNumber, amount, paymentMode, checkInTime: new Date() });
  return walkIn;
}

export async function cancelBooking({ bookingId, userId, reason, isAdmin = false }) {
  const { rows } = await pool.query(`SELECT b.*, to_jsonb(h) as hotel, to_jsonb(p) as payment FROM "bookings" b LEFT JOIN "hotels" h ON h.id=b."hotelId" LEFT JOIN "payments" p ON p."bookingId"=b.id WHERE b.id=$1 ${isAdmin?'':`AND b."userId"=$2`} LIMIT 1`, isAdmin ? [bookingId] : [bookingId, userId]);
  const booking = rows[0];
  if (!booking) throw ApiError.notFound('Booking not found');
  if (['CHECKED_IN','CHECKED_OUT','CANCELLED'].includes(booking.status)) throw ApiError.badRequest(`Cannot cancel a booking with status: ${booking.status}`);
  let refundAmount = null;
  if (booking.paymentStatus === 'WITHHELD' && booking.paystackRef) {
    try { await paystackService.refundTransaction({ transactionId: booking.paystackRef }); refundAmount = booking.totalAmount; } catch(e){ console.error(e.message); }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE "bookings" SET status='CANCELLED', "paymentStatus"=$1, "cancelledAt"=NOW(), "cancelReason"=$2, "updatedAt"=NOW() WHERE id=$3`, [refundAmount ? 'REFUNDED' : booking.paymentStatus, reason, bookingId]);
    if (refundAmount) await client.query(`UPDATE "payments" SET status='REFUNDED', "refundedAt"=NOW(), "refundReason"=$1, "updatedAt"=NOW() WHERE "bookingId"=$2`, [reason, bookingId]);
    await client.query('COMMIT');
  } catch(e){ await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  logAudit({ action:'BOOKING_CANCELLED', entity:'Booking', bookingId, userId: isAdmin?null:userId, hotelId: booking.hotelId, prevValue:{status: booking.status}, newValue:{status:'CANCELLED', refundAmount, reason} });
  await emailService.sendCancellationEmail({ booking, hotel: booking.hotel, refundAmount });
  return { bookingId, cancelled: true, refundAmount };
}

export async function getGuestBookings(userId, { page=1, limit=10 }) {
  const offset = (page-1)*limit;
  const [{ rows }, { rows: c }] = await Promise.all([
    pool.query(`SELECT b.*, jsonb_build_object('id',h.id,'name',h.name,'city',h.city,'state',h.state,'images',h.images,'googleMapsUrl',h."googleMapsUrl") as hotel, jsonb_build_object('id',r.id,'name',r.name,'type',r.type) as room, jsonb_build_object('status',p.status,'channel',p.channel,'releasedAt',p."releasedAt") as payment, jsonb_build_object('id',cc.id,'status',cc.status,'unreadByGuest',cc."unreadByGuest",'activatedAt',cc."activatedAt") as "chatChannel" FROM "bookings" b LEFT JOIN "hotels" h ON h.id=b."hotelId" LEFT JOIN "rooms" r ON r.id=b."roomId" LEFT JOIN "payments" p ON p."bookingId"=b.id LEFT JOIN "chat_channels" cc ON cc."bookingId"=b.id WHERE b."userId"=$1 ORDER BY b."createdAt" DESC LIMIT $2 OFFSET $3`, [userId, limit, offset]),
    pool.query(`SELECT COUNT(*)::int as total FROM "bookings" WHERE "userId"=$1`, [userId])
  ]);
  return { bookings: rows, pagination:{ page, limit, total: c[0].total, pages: Math.ceil(c[0].total/limit) } };
}

export async function getHotelBookings(hotelId, { status, page=1, limit=20, date }) {
  const offset = (page-1)*limit;
  const conditions = [`b."hotelId"=$1`]; const values=[hotelId]; let idx=2;
  if (status){ conditions.push(`b.status=$${idx++}`); values.push(status); }
  if (date){ const start=new Date(date); const end=new Date(new Date(date).setDate(new Date(date).getDate()+1)); conditions.push(`b."checkIn" >= $${idx} AND b."checkIn" < $${idx+1}`); values.push(start,end); idx+=2; }
  const where = conditions.join(' AND ');
  const [{ rows }, { rows: c }] = await Promise.all([
    pool.query(`SELECT b.*, jsonb_build_object('id',r.id,'name',r.name,'type',r.type) as room, jsonb_build_object('status',p.status,'channel',p.channel) as payment FROM "bookings" b LEFT JOIN "rooms" r ON r.id=b."roomId" LEFT JOIN "payments" p ON p."bookingId"=b.id WHERE ${where} ORDER BY b."createdAt" DESC LIMIT $${idx++} OFFSET $${idx++}`, [...values, limit, offset]),
    pool.query(`SELECT COUNT(*)::int as total FROM "bookings" b WHERE ${where}`, values)
  ]);
  return { bookings: rows, pagination:{ page, limit, total: c[0].total, pages: Math.ceil(c[0].total/limit) } };
}

export async function getBookingById(bookingId, userId) {
  const { rows } = await pool.query(`SELECT b.*, jsonb_build_object('id',h.id,'name',h.name,'address',h.address,'city',h.city,'state',h.state,'phone',h.phone,'email',h.email,'images',h.images,'googleMapsUrl',h."googleMapsUrl") as hotel, to_jsonb(r) as room, to_jsonb(p) as payment FROM "bookings" b LEFT JOIN "hotels" h ON h.id=b."hotelId" LEFT JOIN "rooms" r ON r.id=b."roomId" LEFT JOIN "payments" p ON p."bookingId"=b.id WHERE b.id=$1 AND b."userId"=$2 LIMIT 1`, [bookingId, userId]);
  if (!rows[0]) throw ApiError.notFound('Booking not found');
  const qrPayload = JSON.stringify({ bookingId: rows[0].id, token: rows[0].qrCodeToken });
  const qrCodeDataUrl = await QRCode.toDataURL(qrPayload, { width: 300 });
  return { ...rows[0], qrCodeDataUrl };
}

export async function getActiveHotelRooms(hotelId) {
  const { rows } = await pool.query(`SELECT b.id, b."guestName", b."assignedRoom", b."checkInTime", b."checkOut", jsonb_build_object('name',r.name,'type',r.type) as room, jsonb_build_object('id',cc.id,'status',cc.status,'unreadByStaff',cc."unreadByStaff") as "chatChannel" FROM "bookings" b LEFT JOIN "rooms" r ON r.id=b."roomId" LEFT JOIN "chat_channels" cc ON cc."bookingId"=b.id WHERE b."hotelId"=$1 AND b.status='CHECKED_IN' ORDER BY b."checkInTime" DESC`, [hotelId]);
  return rows;
}

export async function verifyBookingPayment(reference, userId) {
  const { rows } = await pool.query(`SELECT b.*, to_jsonb(h) as hotel, to_jsonb(r) as room FROM "bookings" b LEFT JOIN "hotels" h ON h.id=b."hotelId" LEFT JOIN "rooms" r ON r.id=b."roomId" WHERE b."paystackRef"=$1 AND b."userId"=$2 LIMIT 1`, [reference, userId]);
  const booking = rows[0];
  if (!booking) throw ApiError.notFound('Booking not found for this reference');
  if (booking.status === 'CONFIRMED') {
    const qrPayload = JSON.stringify({ bookingId: booking.id, token: booking.qrCodeToken });
    return { status:'confirmed', booking:{ ...booking, qrCodeDataUrl: await QRCode.toDataURL(qrPayload, { width: 300 }) } };
  }
  const paystackData = await paystackService.verifyTransaction(reference);
  if (paystackData.status === 'success') {
    const qrPayload = JSON.stringify({ bookingId: booking.id, token: booking.qrCodeToken });
    const qrCodeDataUrl = await QRCode.toDataURL(qrPayload, { width: 300 });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE "bookings" SET status='CONFIRMED', "paymentStatus"='WITHHELD', "qrCodeUrl"=$1, "updatedAt"=NOW() WHERE id=$2`, [qrCodeDataUrl, booking.id]);
      await client.query(`INSERT INTO "payments" ("bookingId", amount, channel, status, "paystackRef", "paystackStatus", "paystackData") VALUES ($1,$2,'PAYSTACK','WITHHELD',$3,'success',$4) ON CONFLICT ("bookingId") DO UPDATE SET status='WITHHELD', "paystackStatus"='success', "paystackData"=$4, "updatedAt"=NOW()`, [booking.id, booking.totalAmount, reference, JSON.stringify(paystackData)]);
      await client.query('COMMIT');
    } catch(e){ await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    logAudit({ action:'PAYMENT_VERIFIED', entity:'Booking', bookingId: booking.id, userId, hotelId: booking.hotelId, newValue:{status:'CONFIRMED'} });
    await emailService.sendBookingConfirmation({ booking:{ ...booking, status:'CONFIRMED', paymentStatus:'WITHHELD', qrCodeUrl: qrCodeDataUrl }, hotel: booking.hotel, room: booking.room, qrCodeDataUrl });
    return { status:'confirmed', booking:{ ...booking, qrCodeDataUrl } };
  }
  return { status: paystackData.status === 'abandoned' ? 'abandoned' : 'failed' };
}