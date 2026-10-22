// src/controllers/chat.controller.js
import * as chatService from '../services/chat.service.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getChannel = asyncHandler(async (req, res) => {
  const result = await chatService.getChannel(req.params.channelId, req.actor);
  ApiResponse.ok(res, result);
});

export const sendMessage = asyncHandler(async (req, res) => {
  const message = await chatService.sendMessage(req.params.channelId, req.actor, req.body);
  const io = req.app.get('io');
  if (io) io.to(`channel:${req.params.channelId}`).emit('chat:new_message', { message });
  ApiResponse.created(res, message);
});

export const markAsRead = asyncHandler(async (req, res) => {
  await chatService.markAsRead(req.params.channelId, req.actor, req.body.messageIds || []);
  const io = req.app.get('io');
  if (io) io.to(`channel:${req.params.channelId}`).emit('chat:messages_read', { messageIds: req.body.messageIds });
  ApiResponse.ok(res, null, 'Marked as read');
});

export const createServiceRequest = asyncHandler(async (req, res) => {
  const sr = await chatService.createServiceRequest(req.params.bookingId, req.actor, req.body);
  ApiResponse.created(res, sr);
});

export const getServiceRequests = asyncHandler(async (req, res) => {
  const list = await chatService.getServiceRequests(req.params.bookingId, req.actor);
  ApiResponse.ok(res, list);
});

export const updateServiceRequest = asyncHandler(async (req, res) => {
  const sr = await chatService.updateServiceRequest(req.params.requestId, req.actor, req.body.status);
  ApiResponse.ok(res, sr);
});

export const createNote = asyncHandler(async (req, res) => {
  const note = await chatService.createNote(req.params.channelId, req.actor, req.body.content);
  ApiResponse.created(res, note);
});

export const getNotes = asyncHandler(async (req, res) => {
  const notes = await chatService.getNotes(req.params.channelId, req.actor);
  ApiResponse.ok(res, notes);
});