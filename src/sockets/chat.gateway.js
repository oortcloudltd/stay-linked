// src/sockets/chat.gateway.js
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import { env } from '../config/env.js';
import * as chatService from '../services/chat.service.js';

async function authenticateSocket(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);

    if (decoded.type === 'staff') {
      const staff = await prisma.hotelStaff.findUnique({ where: { id: decoded.staffId } });
      if (!staff || !staff.isActive) return next(new Error('Invalid staff session'));
      socket.actor = { type: 'staff', id: staff.id, hotelId: staff.hotelId, name: staff.name };
      return next();
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) return next(new Error('Invalid session'));
    socket.actor = { type: 'guest', id: user.id, name: user.name };
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
}

async function canJoinChannel(actor, channelId) {
  const channel = await prisma.chatChannel.findUnique({
    where: { id: channelId },
    include: { booking: { select: { userId: true, hotelId: true } } },
  });
  if (!channel) return false;
  if (actor.type === 'guest') return channel.booking.userId === actor.id;
  if (actor.type === 'staff') return channel.booking.hotelId === actor.hotelId;
  return false;
}

export function registerChatGateway(io) {
  // Additive — if initSocket() already has io.use(...), this just adds a second
  // middleware in the chain; Socket.IO runs all of them, so it's safe either way.
  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    socket.on('join_channel', async ({ channelId }) => {
      if (!channelId || !(await canJoinChannel(socket.actor, channelId))) {
        return socket.emit('chat:error', { message: 'Access denied to this chat channel' });
      }
      socket.join(`channel:${channelId}`);
    });

    socket.on('leave_channel', ({ channelId }) => channelId && socket.leave(`channel:${channelId}`));

    socket.on('send_message', async ({ channelId, content, priority }) => {
      try {
        const message = await chatService.sendMessage(channelId, socket.actor, { content, priority });
        io.to(`channel:${channelId}`).emit('chat:new_message', { message });

        if (socket.actor.type === 'guest') {
          const channel = await prisma.chatChannel.findUnique({
            where: { id: channelId },
            include: { booking: { select: { hotelId: true, assignedRoom: true, guestName: true } } },
          });
          if (channel) {
            io.to(`hotel:${channel.booking.hotelId}`).emit('chat:guest_message_notification', {
              channelId, roomNumber: channel.booking.assignedRoom, guestName: channel.booking.guestName,
              preview: content.slice(0, 80), priority,
            });
          }
        }
      } catch (err) {
        socket.emit('chat:error', { message: err.message || 'Failed to send message' });
      }
    });

    socket.on('mark_read', async ({ channelId, messageIds }) => {
      try {
        await chatService.markAsRead(channelId, socket.actor, messageIds || []);
        io.to(`channel:${channelId}`).emit('chat:messages_read', { messageIds });
      } catch (err) {
        socket.emit('chat:error', { message: err.message });
      }
    });

    socket.on('typing_start', ({ channelId }) => channelId && socket.to(`channel:${channelId}`).emit('chat:user_typing', { actorType: socket.actor.type }));
    socket.on('typing_stop', ({ channelId }) => channelId && socket.to(`channel:${channelId}`).emit('chat:user_stopped_typing'));
  });
}