/**
 * src/middleware/validate.middleware.js
 *
 * Zod schema validation middleware. Used in your auth router as:
 *   router.post('/guest/register', authLimiter, validate(guestRegisterSchema), ...)
 *
 * If the body fails validation, it throws a structured 400 error that
 * errorHandler.middleware.js converts to a clean JSON response with
 * field-level error messages the frontend can display.
 *
 * Without this file your route file import fails and ALL auth routes 500.
 */

import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';

export function validate(schema) {
  return (req, res, next) => {
    try {
      // parse() throws ZodError on failure; we catch and forward to errorHandler
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        // Format into { field, message } pairs the frontend can map to fieldErrors
        const errors = (err.issues ?? err.errors ?? []).map((e) => ({
          field:   e.path.join('.'),
          message: e.message,
        }));
        return next(ApiError.badRequest(errors[0]?.message ?? 'Validation failed', errors));
      }
      next(err);
    }
  };
}

export function validateQuery(schema) {
  return (req, res, next) => {
    try {
      // Express 5: req.query is a read-only getter — assigning a new object throws.
      // Mutating individual properties on the existing object works fine.
      const parsed = schema.parse(req.query);
      Object.assign(req.query, parsed);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const errors = (err.issues ?? err.errors ?? []).map((e) => ({
          field:   e.path.join('.'),
          message: e.message,
        }));
        return next(ApiError.badRequest(errors[0]?.message ?? 'Validation failed', errors));
      }
      next(err);
    }
  };
}
