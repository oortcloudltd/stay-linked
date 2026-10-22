/**
 * src/middleware/errorHandler.middleware.js
 *
 * Global Express error handler. Must be registered LAST in your Express app
 * (after all routes) with app.use(errorHandler).
 *
 * Without this, ApiError instances thrown in controllers produce an unhandled
 * Express default error page (HTML) instead of your JSON error format.
 * The frontend then tries to JSON.parse an HTML string and crashes.
 *
 * USAGE in your main server file (app.js or server.js):
 *
 *   import { errorHandler } from './middleware/errorHandler.middleware.js';
 *   // ... all your routes ...
 *   app.use(errorHandler);  // ← must be last
 */

import { ApiError } from '../utils/ApiError.js';

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  // If it's our own structured error, use its statusCode
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors:  err.errors ?? [],
    });
  }

  // Prisma duplicate record (unique constraint violation)
  if (err.code === 'P2002') {
    const field = err.meta?.target?.[0] ?? 'field';
    return res.status(409).json({
      success: false,
      message: `An account with this ${field} already exists`,
    });
  }

  // Prisma record not found
  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      message: 'Record not found',
    });
  }

  // JWT errors (shouldn't reach here normally — auth middleware catches them first)
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    });
  }

  // Zod validation errors forwarded from validate middleware
  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  // Unknown error — don't leak internals in production
  const isDev = process.env.NODE_ENV === 'development';
  console.error('[StayLink] Unhandled error:', err);

  return res.status(500).json({
    success: false,
    message: isDev ? err.message : 'An unexpected error occurred',
  });
}
