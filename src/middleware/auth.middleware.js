import prisma from '../config/database.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyAccessToken } from '../utils/jwt.js';

export function readAccessToken(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw ApiError.unauthorized('No token provided');
  try {
    return verifyAccessToken(header.split(' ')[1]);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Token expired. Please refresh your session.');
    }
    throw ApiError.unauthorized('Invalid token');
  }
}

export const protect = asyncHandler(async (req, res, next) => {
  const decoded = readAccessToken(req);
  if (decoded.type !== 'user' || typeof decoded.userId !== 'string') {
    throw ApiError.forbidden('User token required');
  }
  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: { id: true, name: true, email: true, role: true, emailVerified: true },
  });
  if (!user) throw ApiError.unauthorized('User no longer exists');
  if (!user.emailVerified && user.role !== 'ADMIN') {
    throw ApiError.forbidden('Account not verified');
  }
  req.user = user;
  next();
});

export const protectStaff = asyncHandler(async (req, res, next) => {
  const decoded = readAccessToken(req);
  if (decoded.type !== 'staff' || typeof decoded.staffId !== 'string') {
    throw ApiError.forbidden('Staff token required');
  }
  const staff = await prisma.hotelStaff.findUnique({
    where: { id: decoded.staffId },
    include: { hotel: { select: { id: true, name: true, isApproved: true, status: true } } },
  });
  if (!staff || !staff.isActive) {
    throw ApiError.unauthorized('Staff account not found or inactive');
  }
  req.staff = staff;
  req.hotel = staff.hotel;
  req.hotelId = staff.hotelId;
  next();
});

export const requireLiveHotel = (req, _res, next) => {
  if (!req.hotel?.isApproved || req.hotel.status !== 'LIVE') {
    return next(ApiError.forbidden('This hotel is not live yet'));
  }
  next();
};

export const protectOwner = asyncHandler(async (req, res, next) => {
  if (req.user?.role !== 'OWNER') {
    throw ApiError.forbidden('Owner access required');
  }
  const owner = await prisma.hotelOwner.findUnique({
    where: { userId: req.user.id },
    select: { id: true, userId: true, businessName: true, verified: true },
  });
  if (!owner) throw ApiError.forbidden('Owner account required');
  req.owner = owner;
  next();
});

export const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    throw ApiError.forbidden('You do not have permission to perform this action');
  }
  next();
};