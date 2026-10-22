/**
 * src/routes/user.routes.js
 *
 * All routes require authentication (protect middleware).
 *
 * GET    /users/me                     → get profile
 * PATCH  /users/me                     → update profile fields
 * POST   /users/me/photo               → upload profile photo
 * POST   /users/me/change-password     → change password
 * POST   /users/me/change-email        → request email change (sends code)
 * POST   /users/me/change-email/verify → confirm email change with code
 *
 * POST   /users/forgot-password        → send reset code (public)
 * POST   /users/reset-password         → reset password with code (public)
 */

import { Router } from 'express';
import multer     from 'multer';
import { protect } from '../middleware/auth.middleware.js';
import * as userController from '../controllers/user.controller.js';
import { authLimiter } from '../middleware/rateLimiter.middleware.js';

const router = Router();

// Multer — memory storage for Cloudinary upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// ─── Public routes (no auth required) ────────────────────────────────────────
router.post('/forgot-password', authLimiter, userController.forgotPassword);
router.post('/reset-password',  authLimiter, userController.resetPassword);

// ─── Protected routes ─────────────────────────────────────────────────────────
router.use(protect);

router.get  ('/me',                    userController.getMyProfile);
router.patch('/me',                    userController.updateMyProfile);
router.post ('/me/photo',              upload.single('photo'), userController.uploadProfilePhoto);
router.post ('/me/change-password',    userController.changePassword);
router.post ('/me/change-email',       userController.requestEmailChange);
router.post ('/me/change-email/verify', userController.confirmEmailChange);

export default router;
