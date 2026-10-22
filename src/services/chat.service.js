// src/services/chat.service.js
import pool from '../config/database.js';
import { ApiError } from '../utils/ApiError.js';

async function loadChannelWithBooking(channelId) {
  const { rows } = await pool.query(
    `SELECT 
       cc.*,
       jsonb_build_object('id', b.id, 'userId', b."userId", 'hotelId', b."hotelId", 'guestName', b."guestName", 'assignedRoom', b."assignedRoom") as booking
     FROM "chat_channels" cc
     LEFT JOIN "bookings" b ON b.id = cc."bookingId"
     WHERE cc.id = $1
     LIMIT 1`,
    [channelId]
  );
  const channel = rows[0];
  if (!channel) throw ApiError.notFound('Chat channel not found');
  return channel;
}

function assertAccess(channel, actor) {
  if (actor.type === 'guest' && channel.booking.userId !== actor.id) throw ApiError.forbidden('You do not have access to this chat');
  if (actor.type === 'staff' && channel.booking.hotelId !== actor.hotelId) throw ApiError.forbidden('You do not have access to this chat');
}

export async function getChannel(channelId, actor) {
  const channel = await loadChannelWithBooking(channelId);
  assertAccess(channel, actor);

  const { rows: messages } = await pool.query(
    `SELECT * FROM "chat_messages" WHERE "channelId" = $1 ORDER BY "createdAt" ASC`,
    [channelId]
  );

  const guestIds = [...new Set(messages.filter((m) => m.senderType === 'GUEST' && m.senderId).map((m) => m.senderId))];
  const staffIds = [...new Set(messages.filter((m) => m.senderType === 'STAFF' && m.senderId).map((m) => m.senderId))];

  let guests = [];
  let staffMembers = [];

  if (guestIds.length) {
    const { rows } = await pool.query(`SELECT id, name FROM "users" WHERE id = ANY($1)`, [guestIds]);
    guests = rows;
  }
  if (staffIds.length) {
    const { rows } = await pool.query(`SELECT id, name FROM "hotel_staff" WHERE id = ANY($1)`, [staffIds]);
    staffMembers = rows;
  }

  const nameMap = new Map([...guests, ...staffMembers].map((p) => [p.id, p.name]));
  const hydrated = messages.map((m) => ({ ...m, senderName: m.senderId ? nameMap.get(m.senderId) ?? null : null }));

  if (actor.type === 'guest') {
    await pool.query(
      `UPDATE "chat_messages" SET "readStatus" = 'DELIVERED' WHERE "channelId" = $1 AND "senderType" = 'STAFF' AND "readStatus" = 'SENT'`,
      [channelId]
    );
    await pool.query(`UPDATE "chat_channels" SET "unreadByGuest" = 0, "updatedAt" = NOW() WHERE id = $1`, [channelId]);
  } else {
    await pool.query(`UPDATE "chat_channels" SET "unreadByStaff" = 0, "updatedAt" = NOW() WHERE id = $1`, [channelId]);
  }

  return { channel, messages: hydrated };
}

export async function sendMessage(channelId, actor, { content, priority = 'NORMAL' }) {
  const channel = await loadChannelWithBooking(channelId);
  assertAccess(channel, actor);

  if (channel.status !== 'ACTIVE') throw ApiError.badRequest('This chat is not active. Messaging opens at check-in and closes at checkout.');
  if (!content || !content.trim()) throw ApiError.badRequest('Message cannot be empty');
  if (content.length > 2000) throw ApiError.badRequest('Message is too long');

  const senderType = actor.type === 'guest' ? 'GUEST' : 'STAFF';

  const { rows } = await pool.query(
    `INSERT INTO "chat_messages" ("channelId", "senderId", "senderType", content, priority)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [channelId, actor.id, senderType, content.trim(), priority]
  );
  const message = rows[0];

  if (actor.type === 'guest') {
    await pool.query(`UPDATE "chat_channels" SET "unreadByStaff" = "unreadByStaff" + 1, "updatedAt" = NOW() WHERE id = $1`, [channelId]);
  } else {
    await pool.query(`UPDATE "chat_channels" SET "unreadByGuest" = "unreadByGuest" + 1, "updatedAt" = NOW() WHERE id = $1`, [channelId]);
  }

  return { ...message, senderName: actor.name };
}

export async function markAsRead(channelId, actor, messageIds) {
  if (!messageIds?.length) return;
  const channel = await loadChannelWithBooking(channelId);
  assertAccess(channel, actor);
  const senderType = actor.type === 'guest' ? 'STAFF' : 'GUEST';

  await pool.query(
    `UPDATE "chat_messages" SET "readStatus" = 'READ'
     WHERE id = ANY($1) AND "channelId" = $2 AND "senderType" = $3 AND "readStatus" != 'READ'`,
    [messageIds, channelId, senderType]
  );
}

export async function createServiceRequest(bookingId, actor, { requestType, notes }) {
  const { rows } = await pool.query(
    `SELECT b.*, to_jsonb(cc) as "chatChannel" FROM "bookings" b LEFT JOIN "chat_channels" cc ON cc."bookingId" = b.id WHERE b.id = $1 AND b."userId" = $2 AND b.status = 'CHECKED_IN' LIMIT 1`,
    [bookingId, actor.id]
  );
  const booking = rows[0];
  if (!booking) throw ApiError.notFound('Active stay not found for this booking');

  const { rows: srRows } = await pool.query(
    `INSERT INTO "service_requests" ("bookingId", "requestType", notes) VALUES ($1,$2,$3) RETURNING *`,
    [bookingId, requestType, notes || null]
  );
  const serviceRequest = srRows[0];

  if (booking.chatChannel) {
    const label = requestType.replace('_', ' ').toLowerCase();
    await pool.query(
      `INSERT INTO "chat_messages" ("channelId", "senderId", "senderType", content, priority)
       VALUES ($1,$2,'GUEST',$3,'IMPORTANT')`,
      [booking.chatChannel.id, actor.id, `🔔 Service request: ${label}${notes ? ` — ${notes}` : ''}`]
    );
    await pool.query(`UPDATE "chat_channels" SET "unreadByStaff" = "unreadByStaff" + 1, "updatedAt" = NOW() WHERE id = $1`, [booking.chatChannel.id]);
  }

  return serviceRequest;
}

export async function getServiceRequests(bookingId, actor) {
  const { rows } = await pool.query(`SELECT * FROM "bookings" WHERE id = $1 LIMIT 1`, [bookingId]);
  const booking = rows[0];
  if (!booking) throw ApiError.notFound('Booking not found');
  if (actor.type === 'guest' && booking.userId !== actor.id) throw ApiError.forbidden('Access denied');
  if (actor.type === 'staff' && booking.hotelId !== actor.hotelId) throw ApiError.forbidden('Access denied');

  const { rows: requests } = await pool.query(
    `SELECT * FROM "service_requests" WHERE "bookingId" = $1 ORDER BY "requestedAt" DESC`,
    [bookingId]
  );
  return requests;
}

export async function updateServiceRequest(requestId, actor, status) {
  if (actor.type !== 'staff') throw ApiError.forbidden('Only hotel staff can update service requests');
  
  const { rows } = await pool.query(
    `SELECT sr.*, to_jsonb(b) as booking FROM "service_requests" sr LEFT JOIN "bookings" b ON b.id = sr."bookingId" WHERE sr.id = $1 LIMIT 1`,
    [requestId]
  );
  const request = rows[0];
  if (!request) throw ApiError.notFound('Service request not found');
  if (request.booking.hotelId !== actor.hotelId) throw ApiError.forbidden('Access denied');

  let setClause = `status = $2, `;
  const values = [requestId, status];
  let idx = 3;
  
  if (status === 'IN_PROGRESS') {
    setClause += `"acknowledgedAt" = NOW(), `;
  }
  if (status === 'COMPLETED') {
    setClause += `"completedAt" = NOW(), `;
  }
  // remove trailing comma
  setClause = setClause.replace(/, $/, '');

  const { rows: updated } = await pool.query(
    `UPDATE "service_requests" SET ${setClause} WHERE id = $1 RETURNING *`,
    values
  );
  return updated[0];
}

export async function createNote(channelId, actor, content) {
  if (actor.type !== 'staff') throw ApiError.forbidden('Only hotel staff can add internal notes');
  const channel = await loadChannelWithBooking(channelId);
  assertAccess(channel, actor);
  
  const { rows } = await pool.query(
    `INSERT INTO "room_notes" ("channelId", "authorId", content) VALUES ($1,$2,$3) RETURNING *`,
    [channelId, actor.id, content]
  );
  return { ...rows[0], authorName: actor.name };
}

export async function getNotes(channelId, actor) {
  if (actor.type !== 'staff') throw ApiError.forbidden('Only hotel staff can view internal notes');
  const channel = await loadChannelWithBooking(channelId);
  assertAccess(channel, actor);
  
  const { rows: notes } = await pool.query(
    `SELECT * FROM "room_notes" WHERE "channelId" = $1 ORDER BY "createdAt" DESC`,
    [channelId]
  );

  const authorIds = [...new Set(notes.map((n) => n.authorId))];
  let authors = [];
  if (authorIds.length) {
    const { rows } = await pool.query(`SELECT id, name FROM "hotel_staff" WHERE id = ANY($1)`, [authorIds]);
    authors = rows;
  }
  const nameMap = new Map(authors.map((a) => [a.id, a.name]));
  return notes.map((n) => ({ ...n, authorName: nameMap.get(n.authorId) ?? 'Staff' }));
}