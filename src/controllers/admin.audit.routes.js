// ============================================================
// src/routes/admin.audit.routes.js (new file)
// Matches the adminHotelRouter pattern in your hotel.routes.js
// (protect + restrictTo('ADMIN')).
// ============================================================

import { Router } from 'express';
import * as adminAuditController from '../controllers/admin.audit.controller.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';

const router = Router();

router.use(protect, restrictTo('ADMIN'));

router.get('/audit-logs', adminAuditController.listAuditLogs);
router.get('/audit-logs/:entityType/:entityId', adminAuditController.getEntityAuditHistory);
router.get('/payments', adminAuditController.paymentsDashboard);

export default router;

// Mount in app.js alongside your existing adminRouter — either add
// these routes to your existing admin.routes.js file directly, or
// mount this as a separate router:
//   import adminAuditRouter from './routes/admin.audit.routes.js';
//   app.use('/api/v1/admin', adminAuditRouter);
// (safe to mount alongside your existing '/api/v1/admin' adminRouter —
// Express merges routes on the same prefix as long as paths don't collide)
