import { Router } from 'express';
import { protectStaff } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import prisma from '../config/database.js';

const router = Router();

router.use(protectStaff);

// Get hotel notifications (paginated)
router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, unread } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const where = {
    hotelId: req.hotelId,
    ...(unread === 'true' && { read: false }),
  };

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where, skip, take: Number(limit),
      orderBy: { createdAt: 'desc' },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { hotelId: req.hotelId, read: false } }),
  ]);

  ApiResponse.paginated(res, notifications, {
    page: Number(page), limit: Number(limit),
    total, pages: Math.ceil(total / Number(limit)), unreadCount,
  });
}));

// Mark specific notifications as read
router.patch('/read', asyncHandler(async (req, res) => {
  const { ids } = req.body; // Array of notification IDs, or 'all'

  if (ids === 'all') {
    await prisma.notification.updateMany({
      where: { hotelId: req.hotelId, read: false },
      data: { read: true, readAt: new Date() },
    });
  } else if (Array.isArray(ids)) {
    await prisma.notification.updateMany({
      where: { id: { in: ids }, hotelId: req.hotelId },
      data: { read: true, readAt: new Date() },
    });
  }

  const unreadCount = await prisma.notification.count({
    where: { hotelId: req.hotelId, read: false },
  });

  ApiResponse.ok(res, { unreadCount }, 'Notifications marked as read');
}));

export default router;
