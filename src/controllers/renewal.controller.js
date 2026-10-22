// ============================================================
// src/controllers/renewal.controller.js (new file)
// Part 4: HTTP layer for the renewal flow.
// ============================================================

import * as renewalService from '../services/renewal.service.js';

async function requestRenewal(req, res, next) {
  try {
    const { bookingId } = req.params;
    const { extraDays, pricePerDay } = req.body;
    const userId = req.user.id; // from your existing auth middleware

    const result = await renewalService.requestRenewal({
      bookingId,
      userId,
      extraDays,
      pricePerDay,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function acceptRenewal(req, res, next) {
  try {
    const { renewalId } = req.params;
    const staffId = req.staff.id; // from your existing staff auth middleware

    const result = await renewalService.acceptRenewal({ renewalId, staffId });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function rejectRenewal(req, res, next) {
  try {
    const { renewalId } = req.params;
    const { reason } = req.body;
    const staffId = req.staff.id;

    const result = await renewalService.rejectRenewal({ renewalId, staffId, reason });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export { requestRenewal, acceptRenewal, rejectRenewal };
