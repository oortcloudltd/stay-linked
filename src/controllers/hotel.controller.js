import * as hotelService from '../services/hotel.service.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import prisma from '../config/database.js';
import { ApiError } from '../utils/ApiError.js';

// ─── Public ───────────────────────────────────

export const searchHotels = asyncHandler(async (req, res) => {
  const result = await hotelService.searchHotels(req.query);
  ApiResponse.paginated(res, result.hotels, result.pagination, 'Hotels fetched successfully');
});

export const getHotelById = asyncHandler(async (req, res) => {
  const hotel = await hotelService.getHotelById(req.params.id);
  ApiResponse.ok(res, hotel);
});

// Returns all available rooms for a hotel — used by the guest booking flow
export const getHotelRooms = asyncHandler(async (req, res) => {
  const hotel = await prisma.hotel.findFirst({
    where: { id: req.params.id, isApproved: true, status: 'LIVE' },
    select: { id: true },
  });
  if (!hotel) throw ApiError.notFound('Hotel not found');

  const rooms = await prisma.room.findMany({
    where:   { hotelId: hotel.id, isAvailable: true },
    orderBy: { pricePerNight: 'asc' },
    select: {
      id: true, name: true, type: true, description: true,
      pricePerNight: true, price4hr: true, price8hr: true,
      maxGuests: true, images: true, amenities: true,
    },
  });
  ApiResponse.ok(res, rooms);
});

export const getHotelRoomTypes = asyncHandler(async (req, res) => {
  const roomTypes = await hotelService.getHotelRoomTypes(req.params.id, req.query);
  ApiResponse.ok(res, roomTypes);
});

// ─── Owner ────────────────────────────────────

export const createHotel = asyncHandler(async (req, res) => {
  const hotel = await hotelService.createHotel(req.owner.id, req.body, req.files || []);
  ApiResponse.created(res, hotel, 'Hotel submitted for approval');
});

export const getOwnerHotels = asyncHandler(async (req, res) => {
  const hotels = await hotelService.getOwnerHotels(req.owner.id);
  ApiResponse.ok(res, hotels);
});

export const getOwnerHotelById = asyncHandler(async (req, res) => {
  const hotel = await hotelService.getOwnerHotelById(req.params.id, req.owner.id);
  ApiResponse.ok(res, hotel);
});

export const updateHotel = asyncHandler(async (req, res) => {
  const hotel = await hotelService.updateHotel(req.params.id, req.owner.id, req.body, req.files || []);
  ApiResponse.ok(res, hotel, 'Hotel updated successfully');
});

export const deleteHotelImage = asyncHandler(async (req, res) => {
  const { imageUrl } = req.body;
  const hotel = await hotelService.deleteHotelImage(req.params.id, req.owner.id, imageUrl);
  ApiResponse.ok(res, hotel, 'Image removed');
});

// ─── Rooms ────────────────────────────────────

export const addRoom = asyncHandler(async (req, res) => {
  const room = await hotelService.addRoom(req.params.hotelId, req.owner.id, req.body, req.files || []);
  ApiResponse.created(res, room, 'Room added successfully');
});

export const updateRoom = asyncHandler(async (req, res) => {
  const room = await hotelService.updateRoom(
    req.params.roomId, req.params.hotelId, req.owner.id, req.body, req.files || []
  );
  ApiResponse.ok(res, room, 'Room updated');
});

export const deleteRoom = asyncHandler(async (req, res) => {
  await hotelService.deleteRoom(req.params.roomId, req.params.hotelId, req.owner.id);
  ApiResponse.ok(res, null, 'Room deleted');
});

// ─── Staff ────────────────────────────────────

export const createStaff = asyncHandler(async (req, res) => {
  const staff = await hotelService.createStaff(req.params.hotelId, req.owner.id, req.body);
  ApiResponse.created(res, staff, 'Staff account created');
});

export const getHotelStaff = asyncHandler(async (req, res) => {
  const staff = await hotelService.getHotelStaff(req.params.hotelId, req.owner.id);
  ApiResponse.ok(res, staff);
});

export const deactivateStaff = asyncHandler(async (req, res) => {
  const staff = await hotelService.deactivateStaff(req.params.staffId, req.params.hotelId, req.owner.id);
  ApiResponse.ok(res, staff, 'Staff account deactivated');
});

// ─── Admin ────────────────────────────────────

export const getAllHotelsAdmin = asyncHandler(async (req, res) => {
  const result = await hotelService.getAllHotelsAdmin(req.query);
  ApiResponse.paginated(res, result.hotels, result.pagination);
});

export const approveHotel = asyncHandler(async (req, res) => {
  const hotel = await hotelService.approveHotel(req.params.id, req.user.id);
  ApiResponse.ok(res, hotel, 'Hotel approved and now live');
});

export const suspendHotel = asyncHandler(async (req, res) => {
  const hotel = await hotelService.suspendHotel(req.params.id, req.body.reason);
  ApiResponse.ok(res, hotel, 'Hotel suspended');
});
