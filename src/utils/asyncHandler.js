/**
 * src/utils/asyncHandler.js
 *
 * Wraps async Express handlers so unhandled promise rejections
 * are forwarded to Express's error middleware instead of crashing the process.
 *
 * Without this, any thrown ApiError or unhandled rejection in a controller
 * silently hangs the request (no response sent, client times out).
 *
 * Usage:
 *   export const myController = asyncHandler(async (req, res) => { ... });
 */
export function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
