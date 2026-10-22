/**
 * Audit logger. Returns a promise that never rejects, so both
 * `await logAudit(...)` and fire-and-forget `logAudit(...)` are safe.
 * Accepts both naming styles (entity/entityType, prevValue/oldValue, ip/ipAddress).
 */
import pool from '../config/database.js';

export function logAudit(p = {}) {
  const query = `
    INSERT INTO "AuditLog" (
      action, entity, "entityId",
      "userId", "staffId", "hotelId", "bookingId",
      "actorId", "actorType",
      "prevValue", "newValue",
      ip, "userAgent", "requestId", notes, reason
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6, $7,
      $8, $9,
      $10, $11,
      $12, $13, $14, $15, $16
    )
    RETURNING *
  `;

  const values = [
    p.action,
    p.entity ?? p.entityType ?? null,
    p.entityId ?? null,
    p.userId ?? null,
    p.staffId ?? null,
    p.hotelId ?? null,
    p.bookingId ?? null,
    p.actorId ?? null,
    p.actorType ?? null,
    p.prevValue ?? p.oldValue ? JSON.stringify(p.prevValue ?? p.oldValue) : null,
    p.newValue ? JSON.stringify(p.newValue) : null,
    p.ip ?? p.ipAddress ?? null,
    p.userAgent ?? null,
    p.requestId ?? null,
    p.notes ?? null,
    p.reason ?? null,
  ];

  // Handle JSONB columns correctly - pass object directly, pg will handle JSONB
  values[9] = p.prevValue ?? p.oldValue ?? null;
  values[10] = p.newValue ?? null;

  return pool.query(query, values)
    .then(res => res.rows[0])
    .catch((err) => {
      console.error('[AuditLog] Failed to write audit entry:', err.message, { action: p.action, bookingId: p.bookingId });
      // never reject
      return null;
    });
}

// Fire-and-forget safe version with JSONB cast if you need it:
export function logAuditSafe(p = {}) {
  return pool.query(
    `INSERT INTO "AuditLog" (action, entity, "entityId", "userId", "staffId", "hotelId", "bookingId", "actorId", "actorType", "prevValue", "newValue", ip, "userAgent", "requestId", notes, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16)`,
    [
      p.action,
      p.entity ?? p.entityType ?? null,
      p.entityId ?? null,
      p.userId ?? null,
      p.staffId ?? null,
      p.hotelId ?? null,
      p.bookingId ?? null,
      p.actorId ?? null,
      p.actorType ?? null,
      p.prevValue ?? p.oldValue ? JSON.stringify(p.prevValue ?? p.oldValue) : null,
      p.newValue ? JSON.stringify(p.newValue) : null,
      p.ip ?? p.ipAddress ?? null,
      p.userAgent ?? null,
      p.requestId ?? null,
      p.notes ?? null,
      p.reason ?? null,
    ]
  ).catch(err => {
    console.error('[AuditLog] Failed:', err.message);
  });
}