// ============================================================
// src/services/payment.service.js
// The single interface the rest of the app talks to.
// Booking/renewal/checkout code should NEVER import monnify.service.js
// or paystack.service.js directly. Always come through here.
// ============================================================

import * as monnifyService from './monnify.service.js';
import * as paystackService from './paystack.service.js';

// Swap this one env var to change providers platform-wide.
const ACTIVE_PROVIDER = process.env.PAYMENT_PROVIDER || 'monnify';

const providers = {
  monnify: monnifyService,
  paystack: paystackService,
};

function getProvider() {
  const provider = providers[ACTIVE_PROVIDER];
  if (!provider) {
    throw new Error(`Unknown payment provider configured: ${ACTIVE_PROVIDER}`);
  }
  return provider;
}

/**
 * Starts a payment for a booking or renewal.
 * @param {{ amount: number, reference: string, customerEmail: string, customerName: string, metadata: object }} params
 * @returns {{ checkoutUrl: string, providerReference: string }}
 */
async function initializePayment(params) {
  return getProvider().initializePayment(params);
}

/**
 * Verifies a payment directly against the provider (used as a
 * fallback/manual check in addition to webhooks; never trust the
 * frontend's "it succeeded" alone).
 */
async function verifyPayment(providerReference) {
  return getProvider().verifyPayment(providerReference);
}

/**
 * Marks funds as held (escrow). Bookkeeping only: the money is
 * already with the provider. Holding is enforced by us simply not
 * calling releaseFunds until check-in.
 */
async function holdFunds({ transactionId }) {
  return { held: true, transactionId };
}

/**
 * Releases held funds to a hotel's verified bank account.
 */
async function releaseFunds({ hotelAccount, amount, reference, metadata }) {
  return getProvider().initiateTransfer({ hotelAccount, amount, reference, metadata });
}

/**
 * Refunds a guest.
 */
async function refund({ providerReference, amount, reason }) {
  return getProvider().refund({ providerReference, amount, reason });
}

/**
 * Verifies a hotel's bank account details before allowing payouts.
 */
async function verifyBankAccount({ accountNumber, bankCode }) {
  return getProvider().verifyBankAccount({ accountNumber, bankCode });
}

function getActiveProvider() {
  return ACTIVE_PROVIDER;
}

export {
  initializePayment,
  verifyPayment,
  holdFunds,
  releaseFunds,
  refund,
  verifyBankAccount,
  getActiveProvider,
};