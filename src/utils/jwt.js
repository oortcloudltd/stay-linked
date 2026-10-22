import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const ALG = 'HS256';
const ISSUER = 'staylink-api';
const AUD = { access: 'staylink-access', refresh: 'staylink-refresh' };

export function generateAccessToken(payload) {
  return signAccessToken(payload);
}

export function generateRefreshToken(payload) {
  return signRefreshToken(payload);
}

export const signAccessToken = (payload) =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: ALG, expiresIn: env.JWT_ACCESS_EXPIRES_IN, issuer: ISSUER, audience: AUD.access,
  });

export const signRefreshToken = (payload) =>
  jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    algorithm: ALG, expiresIn: env.JWT_REFRESH_EXPIRES_IN, issuer: ISSUER, audience: AUD.refresh,
    jwtid: crypto.randomUUID(),
  });

const opts = (audience, extra = {}) => ({ algorithms: [ALG], issuer: ISSUER, audience, ...extra });

export const verifyAccessToken = (t) => jwt.verify(t, env.JWT_ACCESS_SECRET, opts(AUD.access));
export const verifyRefreshToken = (t) => jwt.verify(t, env.JWT_REFRESH_SECRET, opts(AUD.refresh));
// Logout only: signature must still be valid, but an expired token may still revoke its session.
export const verifyAccessTokenIgnoringExpiry = (t) =>
  jwt.verify(t, env.JWT_ACCESS_SECRET, opts(AUD.access, { ignoreExpiration: true }));