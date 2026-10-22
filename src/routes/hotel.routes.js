/**
 * src/routes/hotel.routes.js
 */

import { Router } from 'express';
import * as hotelController from '../controllers/hotel.controller.js';
import { protect, protectOwner, restrictTo } from '../middleware/auth.middleware.js';
import { requireHotelOwnership as own } from '../middleware/ownership.middleware.js';
import { validate, validateQuery } from '../middleware/validate.middleware.js';
import { generalLimiter } from '../middleware/rateLimiter.middleware.js';
import { uploadHotelImages, uploadRoomImages, handleUpload } from '../middleware/upload.middleware.js';
import {
  createHotelSchema, updateHotelSchema,
  createRoomSchema, updateRoomSchema,
  createStaffSchema, hotelSearchSchema, hotelAvailabilitySchema,
} from '../validators/hotel.validators.js';

const router = Router();

// ─────────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────────
router.get('/', generalLimiter, validateQuery(hotelSearchSchema), hotelController.searchHotels);
router.get('/:id', generalLimiter, hotelController.getHotelById);

// Public: get available rooms for a hotel (needed for booking flow)
router.get('/:id/rooms', generalLimiter, hotelController.getHotelRooms);
router.get('/:id/room-types', generalLimiter, validateQuery(hotelAvailabilitySchema), hotelController.getHotelRoomTypes);

// ─────────────────────────────────────────────
// OWNER ROUTES — /api/v1/owner/hotels
// ─────────────────────────────────────────────
export const ownerHotelRouter = Router();

ownerHotelRouter.use(protect, protectOwner);

ownerHotelRouter.get('/', hotelController.getOwnerHotels);
ownerHotelRouter.post(
  '/',
  handleUpload(uploadHotelImages),
  validate(createHotelSchema),
  hotelController.createHotel
);

ownerHotelRouter.get('/:id', own('id'), hotelController.getOwnerHotelById);

ownerHotelRouter.patch(
  '/:id',
  own('id'),
  handleUpload(uploadHotelImages),
  validate(updateHotelSchema),
  hotelController.updateHotel
);

ownerHotelRouter.delete('/:id/images', own('id'), hotelController.deleteHotelImage);

// Rooms (ownership checked before file upload middleware)
ownerHotelRouter.post(
  '/:hotelId/rooms',
  own(),
  handleUpload(uploadRoomImages),
  validate(createRoomSchema),
  hotelController.addRoom
);

ownerHotelRouter.patch(
  '/:hotelId/rooms/:roomId',
  own(),
  handleUpload(uploadRoomImages),
  validate(updateRoomSchema),
  hotelController.updateRoom
);

ownerHotelRouter.delete('/:hotelId/rooms/:roomId', own(), hotelController.deleteRoom);

// Staff
ownerHotelRouter.get('/:hotelId/staff', own(), hotelController.getHotelStaff);
ownerHotelRouter.post('/:hotelId/staff', own(), validate(createStaffSchema), hotelController.createStaff);

// Supporting both client service endpoint patterns for deactivation
ownerHotelRouter.patch('/:hotelId/staff/:staffId', own(), hotelController.deactivateStaff);
ownerHotelRouter.patch('/:hotelId/staff/:staffId/deactivate', own(), hotelController.deactivateStaff);

// ─────────────────────────────────────────────
// ADMIN ROUTES — /api/v1/admin/hotels
// ─────────────────────────────────────────────
export const adminHotelRouter = Router();

adminHotelRouter.use(protect, restrictTo('ADMIN'));

adminHotelRouter.get('/', hotelController.getAllHotelsAdmin);
adminHotelRouter.patch('/:id/approve', hotelController.approveHotel);
adminHotelRouter.patch('/:id/suspend', hotelController.suspendHotel);

export default router;