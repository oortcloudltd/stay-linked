import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary-v2';
import cloudinary from '../config/cloudinary.js';
import { ApiError } from '../utils/ApiError.js';

// Allowed image MIME types
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// ─── Cloudinary Storage for Hotel Images ──────
const hotelStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req) => ({
    folder: `staylink/hotels/${req.params.hotelId || 'general'}`,
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1200, height: 800, crop: 'limit', quality: 'auto' }],
  }),
});

// ─── Cloudinary Storage for Room Images ───────
const roomStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req) => ({
    folder: `staylink/rooms/${req.params.roomId || 'general'}`,
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1000, height: 700, crop: 'limit', quality: 'auto' }],
  }),
});

// ─── File Filter ───────────────────────────────
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, `Invalid file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`), false);
  }
};

// ─── Multer Instances ──────────────────────────
export const uploadHotelImages = multer({
  storage: hotelStorage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 10 },
}).array('images', 10);

export const uploadRoomImages = multer({
  storage: roomStorage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 5 },
}).array('images', 5);

// ─── Error Handler Wrapper ─────────────────────
export const handleUpload = (uploadFn) => (req, res, next) => {
  uploadFn(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError(400, 'File too large. Maximum size is 5MB per image.'));
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return next(new ApiError(400, 'Too many files uploaded at once.'));
      }
      return next(new ApiError(400, `Upload error: ${err.message}`));
    }

    next(err);
  });
};
