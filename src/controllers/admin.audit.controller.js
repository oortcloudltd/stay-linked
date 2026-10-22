// src/controllers/admin.audit.controller.js
import prisma from '../config/database.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiResponse } from '../utils/ApiResponse.js';

// Keep the response shape the admin frontend already expects
const withLegacyFields = (log) => ({
  ...log,
  entityType: log.entity,
  oldValue: log.prevValue,
  ipAddress: log.ip,
});

export const listAuditLogs = asyncHandler(async (req, res) => {
  const { entityType, actorId, from, to, page = 1, limit = 50 } = req.query;

  const where = {
    ...(entityType && { entity: entityType }),
    ...(actorId && { actorId }),
    ...((from || to) && {
      createdAt: {
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(to) }),
      },
    }),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.auditLog.count({ where }),
  ]);

  ApiResponse.paginated(res, logs.map(withLegacyFields), { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) });
});

export const getEntityAuditHistory = asyncHandler(async (req, res) => {
  const { entityType, entityId } = req.params;
  const logs = await prisma.auditLog.findMany({
    where: { entity: entityType, entityId },
    orderBy: { createdAt: 'asc' },
  });
  ApiResponse.ok(res, logs.map(withLegacyFields));
});

export const paymentsDashboard = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 50 } = req.query;
  const where = { ...(status && { status }) };

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
      include: { booking: { select: { id: true, guestName: true, hotelId: true } } },
    }),
    prisma.payment.count({ where }),
  ]);

  ApiResponse.paginated(res, payments, { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) });
});