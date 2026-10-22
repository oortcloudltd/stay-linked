import * as userService from '../services/user.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError }     from '../utils/ApiError.js';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key:    env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

export const getMyProfile = asyncHandler(async (req, res) => {
  const user = await userService.getProfile(req.user.id);
  res.json({ success: true, data: user });
});

export const updateMyProfile = asyncHandler(async (req, res) => {
  const { name, phone, dob, addressLine1, city, residentialState, stateOfOrigin, localGovernmentOfOrigin } = req.body;
  const user = await userService.updateProfile(req.user.id, {
    name, phone, dob, addressLine1, city,
    residentialState, stateOfOrigin, localGovernmentOfOrigin,
  });
  res.json({ success: true, data: user, message: 'Profile updated successfully' });
});

export const uploadProfilePhoto = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No image file provided');
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder:         'staylink/profiles',
        transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
        format:         'webp',
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      },
    );
    stream.end(req.file.buffer);
  });
  const user = await userService.updateProfilePhoto(req.user.id, result.secure_url);
  res.json({ success: true, data: user, message: 'Profile photo updated' });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    throw ApiError.badRequest('Current password and new password are required');
  }
  if (newPassword.length < 8 || newPassword.length > 72) {
    throw ApiError.badRequest('New password must be between 8 and 72 characters');
  }
  await userService.changePassword(req.user.id, { currentPassword, newPassword });
  res.json({ success: true, message: 'Password changed successfully' });
});

export const requestEmailChange = asyncHandler(async (req, res) => {
  const { currentPassword, newEmail } = req.body;
  if (!currentPassword || !newEmail) {
    throw ApiError.badRequest('Current password and new email are required');
  }
  await userService.requestEmailChange(req.user.id, { currentPassword, newEmail });
  res.json({ success: true, message: 'Verification code sent to your new email address' });
});

export const confirmEmailChange = asyncHandler(async (req, res) => {
  const { code, newEmail } = req.body;
  if (!code || !newEmail) {
    throw ApiError.badRequest('Code and new email are required');
  }
  const user = await userService.confirmEmailChange(req.user.id, { code, newEmail });
  res.json({ success: true, data: user, message: 'Email updated successfully' });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw ApiError.badRequest('Email is required');
  await userService.requestPasswordReset(email);
  res.json({ success: true, message: 'If an account exists with that email, a reset code has been sent' });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    throw ApiError.badRequest('Email, code and new password are required');
  }
  if (newPassword.length < 8 || newPassword.length > 72) {
    throw ApiError.badRequest('Password must be between 8 and 72 characters');
  }
  await userService.resetPassword({ email, code, newPassword });
  res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
});