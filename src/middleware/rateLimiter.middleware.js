/**
 * src/middleware/rateLimiter.middleware.js
 *
 * Your auth router imports { authLimiter } from this file.
 * If the file doesn't exist, the entire auth router fails to load
 * and ALL auth routes return 500 before a single request is processed.
 *
 * Install: npm install express-rate-limit
 */

import rateLimit from 'express-rate-limit';

/**
 * Applied to all /api/auth/* routes.
 * 10 attempts per IP per 15 minutes.
 * Tight enough to prevent brute-force, loose enough for normal use.
 *
 * In production, set a Redis store so limits persist across server restarts
 * and work correctly behind a load balancer:
 *   npm install rate-limit-redis ioredis
 *   store: new RedisStore({ sendCommand: (...args) => redisClient.sendCommand(args) })
 */
export const authLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              10,              // max 10 requests per window per IP
  standardHeaders:  true,           // Return RateLimit-* headers
  legacyHeaders:    false,
  skipSuccessfulRequests: false,     // Count all requests, not just failures

  // IMPORTANT: if your server is behind a proxy (Nginx, Railway, Render, etc.)
  // you must set this so the real client IP is used, not the proxy IP.
  // Otherwise ALL users share one limit bucket and everyone gets blocked.
  // Uncomment after confirming your proxy sets X-Forwarded-For correctly:
  // trustProxy: true,  // or app.set('trust proxy', 1) in app.js

  handler(req, res) {
    res.status(429).json({
      success: false,
      message: 'Too many attempts. Please wait 15 minutes before trying again.',
    });
  },
});

/**
 * Booking-specific rate limiter.
 * Limits guests to 20 booking-related requests per IP per minute.
 */
export const bookingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      20,
  standardHeaders: true,
  legacyHeaders:   false,
  handler(req, res) {
    res.status(429).json({
      success: false,
      message: 'Too many booking attempts. Please wait a minute and try again.',
    });
  },
});

/**
 * Lighter limit for non-sensitive endpoints (e.g. hotel listings).
 * 100 requests per IP per minute.
 */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      100,
  standardHeaders: true,
  legacyHeaders:   false,
});
