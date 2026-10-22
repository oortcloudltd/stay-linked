// src/routes/chat.routes.js
import { Router } from 'express';
import * as chatController from '../controllers/chat.controller.js';
import { identifyChatActor } from '../middleware/chatAuth.middleware.js';

const router = Router();
router.use(identifyChatActor);

router.get('/channel/:channelId', chatController.getChannel);
router.post('/channel/:channelId/messages', chatController.sendMessage);
router.patch('/channel/:channelId/read', chatController.markAsRead);
router.post('/channel/:channelId/notes', chatController.createNote);
router.get('/channel/:channelId/notes', chatController.getNotes);

router.post('/booking/:bookingId/service-request', chatController.createServiceRequest);
router.get('/booking/:bookingId/service-requests', chatController.getServiceRequests);
router.patch('/service-request/:requestId', chatController.updateServiceRequest);

export default router;