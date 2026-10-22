// ============================================================
// src/services/payment/wallet.service.js - RAW SQL
// Part 2 & 6: Verifies a hotel's bank account before it's saved,
// so payouts never go to an unverified account.
// ============================================================

import pool from '../config/database.js'; // pg Pool
import * as paymentService from './payment.service.js';
import { logAudit } from './audit.service.js';

/**
 * Call this from your hotel-owner "add/update payout details" endpoint
 * INSTEAD of saving accountNumber/bankCode directly to the DB.
 */
async function verifyAndSaveHotelBankAccount({ hotelId, accountNumber, bankCode, actorId }) {
  // 1. Verify with provider first - no DB lock yet
  const verification = await paymentService.verifyBankAccount({ accountNumber, bankCode });

  if (!verification.verified) {
    throw new Error('Bank account could not be verified');
  }

  // 2. Save verified account
  const { rows } = await pool.query(
    `UPDATE "Hotel"
     SET "bankAccountNumber" = $1,
         "bankCode" = $2,
         "bankAccountName" = $3,
         "bankAccountVerified" = true,
         "updatedAt" = NOW()
     WHERE id = $4
     RETURNING *`,
    [accountNumber, bankCode, verification.accountName, hotelId]
  );

  if (!rows[0]) throw new Error('Hotel not found');

  const updated = rows[0];

  await logAudit({
    actorId,
    actorType: 'owner',
    action: 'HOTEL_BANK_ACCOUNT_VERIFIED',
    entityType: 'Hotel',
    entityId: hotelId,
    newValue: { accountNumber, bankCode, accountName: verification.accountName },
  });

  return updated;
}

export { verifyAndSaveHotelBankAccount };