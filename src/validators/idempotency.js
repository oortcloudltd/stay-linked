// ============================================================
// src/utils/idempotency.js (new file)
// Part 2 & 6: prevents duplicate processing of the same webhook
// event or the same payment mutation if retried/replayed.
// ============================================================

import prisma from '../config/database.js';
/**
 * Returns true if this providerReference has already been recorded
 * as a SUCCESS or FAILED transaction — meaning this call is a
 * duplicate/replay and should be skipped.
 */
async function isDuplicateTransaction(providerReference) {
  const existing = await prisma.transaction.findUnique({
    where: { providerReference },
  });
  return existing && ['SUCCESS', 'FAILED', 'REVERSED'].includes(existing.status);
}

/**
 * Wraps a webhook/payment handler so that if the same providerReference
 * comes in twice, the second call is a no-op instead of double-processing
 * a payout, refund, or status change.
 */
async function withIdempotency(providerReference, handler) {
  if (await isDuplicateTransaction(providerReference)) {
    console.log(`[idempotency] Skipping duplicate event: ${providerReference}`);
    return { skipped: true };
  }
  return handler();
}

export { isDuplicateTransaction, withIdempotency };
