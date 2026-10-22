/**
 * src/app.js
 *
 * Order matters:
 *  0. Proxy trust (so rate limiting sees real client IPs on Railway)
 *  1. Security + CORS
 *  2. Webhook routes (need the RAW body, so they go BEFORE express.json())
 *  3. Body parsers
 *  4. Normal routes
 *  5. 404 handler, then the error handler (always last)
 */

import express      from 'express';
import cors         from 'cors';
import helmet       from 'helmet';
import cookieParser from 'cookie-parser';

import authRouter         from './routes/auth.routes.js';
import userRouter         from './routes/user.routes.js';
import hotelRouter        from './routes/hotel.routes.js';
import bookingRouter      from './routes/booking.routes.js';
import ownerRouter        from './routes/owner.routes.js';
import adminRouter        from './routes/admin.routes.js';
import notificationRouter from './routes/notification.routes.js';
import webhookRouter      from './routes/webhook.routes.js';
import paymentRouter      from './routes/payment.routes.js';
import lodgingRouter      from './routes/lodging.routes.js';
import renewalRouter      from './routes/renewal.routes.js';
import bankRouter         from './routes/bank.routes.js';

import { errorHandler } from './middleware/errorHandler.middleware.js';

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// ─── Proxy trust ──────────────────────────────────────────────────────────────
// Railway puts one proxy in front of the app. Without this, every client shares
// the proxy's IP and authLimiter/bookingLimiter throttle ALL users together.
// Override with TRUST_PROXY=<hops> if your deployment has a different chain.
if (isProd || process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
}

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ─────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  ...(process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL.trim()] : []),
];

if (!isProd) {
  ALLOWED_ORIGINS.push(
    'http://localhost:5173',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
  );
  if (process.env.REPLIT_DEV_DOMAIN) ALLOWED_ORIGINS.push(`https://${process.env.REPLIT_DEV_DOMAIN}`);
}

if (isProd && ALLOWED_ORIGINS.length === 0) {
  console.error('[cors] CRITICAL: No ALLOWED_ORIGINS or FRONTEND_URL set in production environment');
}

app.use(cors({
  origin(origin, callback) {
    // No Origin header: server-to-server calls (Paystack/Monnify webhooks), curl, health checks.
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    // Deny without throwing: an Error here would surface as a misleading 500 from errorHandler.
    console.warn(`[cors] Blocked origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // X-Hotel-Id: owners pick which of their hotels a dashboard request targets.
  // The backend verifies it against hotel.ownerId; it is a selector, never an authority.
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Hotel-Id'],
}));

// ─── WEBHOOKS — MUST come before express.json() ───────────────────────────────
// Providers sign the raw request body. If express.json() runs first, the raw
// bytes are gone and every signature check fails.
app.use('/api/v1/webhook', webhookRouter); // Paystack

// Monnify webhook only: POST /api/v1/payments/webhook (raw body).
// Every other /payments route skips this and is mounted AFTER the body parsers
// below, so they get a parsed req.body (previously they got none).
app.use('/api/v1/payments', (req, res, next) =>
  req.path === '/webhook' ? paymentRouter(req, res, next) : next(),
);

// ─── Body parsers — AFTER webhooks ────────────────────────────────────────────
// 10kb was too tight for the hotel registration payload (rooms, amenities, landmarks).
// Image uploads are multipart and handled by multer, so they are unaffected.
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ─── Health check ─────────────────────────────────────────────────────────────
const health = (_req, res) =>
  res.json({ success: true, message: 'StayLink API is running', env: process.env.NODE_ENV });
app.get('/api/health', health);
app.get('/health', health); // server.js logs this path; handy for Railway health checks

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/v1/auth',          authRouter);
app.use('/api/v1/users',         userRouter);
app.use('/api/v1/hotels',        hotelRouter);
app.use('/api/v1/bookings',      bookingRouter);
app.use('/api/v1/owner',         ownerRouter);
app.use('/api/v1/admin',         adminRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/lodging',       lodgingRouter);
app.use('/api/v1/renewals',      renewalRouter);
app.use('/api/v1/payments',      paymentRouter); // non-webhook payment routes (parsed body)
app.use('/api/v1/banks',         bankRouter);    // account-name resolution for hotel registration

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// ─── Global error handler — must be last ─────────────────────────────────────
app.use(errorHandler);

export default app;