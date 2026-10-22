// ============================================================
// src/controllers/lodging.controller.js
// Part 3: HTTP layer for check-in/check-out/settle.
// ============================================================

import * as lodgingService from '../services/booking.lodging.service.js';

async function checkIn(req, res, next) {
  try {
    const { qrCodeToken } = req.body;
    const actorId = req.actor?.id || req.staff?.id;
    const actorType = req.actor?.type || 'staff';
    const hotelId = req.hotelId;

    const result = await lodgingService.checkInGuest({
      qrCodeToken,
      actorId,
      actorType,
      hotelId,
    });

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function checkOut(req, res, next) {
  try {
    const { bookingId } = req.params;
    const actorId = req.actor?.id || req.staff?.id;
    const actorType = req.actor?.type || 'staff';
    const hotelId = req.hotelId;

    const result = await lodgingService.checkOutGuest({
      bookingId,
      actorId,
      actorType,
      hotelId,
    });

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function markSettled(req, res, next) {
  try {
    const { bookingId } = req.params;
    const actorId = req.actor?.id || req.staff?.id;
    const actorType = req.actor?.type || 'staff';
    const hotelId = req.hotelId;

    const result = await lodgingService.markOverdueSettled({
      bookingId,
      actorId,
      actorType,
      hotelId,
    });

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export { checkIn, checkOut, markSettled };