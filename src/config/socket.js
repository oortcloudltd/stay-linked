import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import prisma from '../config/database.js';

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.FRONTEND_URL,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ─── Auth Middleware ─────────────────────────
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);

      if (decoded.type === 'staff') {
        const staff = await prisma.hotelStaff.findUnique({
          where: { id: decoded.staffId },
          select: { id: true, name: true, hotelId: true, role: true, isActive: true },
        });
        if (!staff || !staff.isActive) return next(new Error('Staff account not found'));
        socket.data.user = { type: 'staff', ...staff };
      } else {
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true, name: true, role: true },
        });
        if (!user) return next(new Error('User not found'));
        socket.data.user = { type: 'user', ...user };
      }

      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // ─── Connection Handler ─────────────────────
  io.on('connection', (socket) => {
    const { user } = socket.data;
    console.log(`[Socket] Connected: ${user.name} (${user.type})`);

    // ─── Staff joins hotel room for real-time updates
    socket.on('join:hotel', async (hotelId) => {
      if (user.type !== 'staff') {
        return socket.emit('error', 'Only hotel staff can join hotel rooms');
      }

      // Verify the staff belongs to this hotel
      if (user.hotelId !== hotelId) {
        return socket.emit('error', 'Access denied to this hotel room');
      }

      socket.join(`hotel:${hotelId}`);
      console.log(`[Socket] Staff ${user.name} joined hotel:${hotelId}`);
      socket.emit('joined', { hotelId, message: 'Connected to hotel dashboard' });

      // Send unread notification count on join
      const unreadCount = await prisma.notification.count({
        where: { hotelId, read: false },
      });
      socket.emit('notifications:count', { unreadCount });
    });

    // ─── Mark notifications as read
    socket.on('notifications:read', async ({ notificationIds }) => {
      if (user.type !== 'staff') return;
      await prisma.notification.updateMany({
        where: { id: { in: notificationIds }, hotelId: user.hotelId },
        data: { read: true, readAt: new Date() },
      });

      const unreadCount = await prisma.notification.count({
        where: { hotelId: user.hotelId, read: false },
      });
      socket.to(`hotel:${user.hotelId}`).emit('notifications:count', { unreadCount });
    });

    // ─── Disconnect
    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${user.name}`);
    });

    // ─── Error
    socket.on('error', (err) => {
      console.error('[Socket] Error:', err.message);
    });
  });

  return io;
}
