import { protect, protectStaff, protectOwner } from './auth.middleware.js';
import { requireHotelOwnership } from './ownership.middleware.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { ApiError } from '../utils/ApiError.js';

export function protectHotelActor(req, res, next) {
  let t;
  try { t = verifyAccessToken(String(req.headers.authorization ?? '').split(' ')[1]); }
  catch { return next(ApiError.unauthorized('Invalid token')); }

  if (t.type === 'staff') {
    return protectStaff(req, res, (e) => {
      if (e) return next(e);
      req.actor = { type: 'staff', id: req.staff.id };
      next();
    });
  }
  return protect(req, res, (e) => {
    if (e) return next(e);
    if (req.user.role !== 'OWNER') return next(ApiError.forbidden('Hotel access required'));
    protectOwner(req, res, (e2) => {
      if (e2) return next(e2);
      // Selecting among hotels you own is fine; ownership is verified against the DB.
      req.params.hotelId = req.get('x-hotel-id');
      requireHotelOwnership('hotelId')(req, res, (e3) => {
        if (e3) return next(e3);
        req.hotelId = req.hotel.id;
        req.hotel = { ...req.hotel, isApproved: true, status: 'LIVE' }; // owner mode can manage any state; tighten if needed
        req.actor = { type: 'owner', id: req.user.id };
        next();
      });
    });
  });
}