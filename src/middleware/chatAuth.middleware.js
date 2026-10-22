// src/middleware/chatAuth.middleware.js
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';

// Accepts either a guest JWT or a staff JWT and normalises both into
// req.actor = { type: 'guest'|'staff', id, hotelId?, name }
export const identifyChatActor = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw ApiError.unauthorized('No token provided');
  }
  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw ApiError.unauthorized('Token expired. Please refresh your session.');
    throw ApiError.unauthorized('Invalid token');
  }

  if (decoded.type === 'staff') {
    const staff = await prisma.hotelStaff.findUnique({ where: { id: decoded.staffId } });
    if (!staff || !staff.isActive) throw ApiError.unauthorized('Staff account not found or inactive');
    req.actor = { type: 'staff', id: staff.id, hotelId: staff.hotelId, name: staff.name };
    return next();
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { id: true, name: true, role: true } });
  if (!user) throw ApiError.unauthorized('User no longer exists');
  if (user.role !== 'GUEST') throw ApiError.forbidden('Only guests and hotel staff can use chat');
  req.actor = { type: 'guest', id: user.id, name: user.name };
  next();
});