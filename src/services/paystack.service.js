// ============================================================
// src/services/payment/paystack.service.js
// Part 2: Your EXISTING Paystack logic, re-exported behind the
// same interface shape as monnify.service.js so payment.service.js
// can swap between them via PAYMENT_PROVIDER env var.
//
// I don't have your real paystack.service.js — this is a thin
// adapter shell. Move your existing initializeTransaction/
// verifyTransaction/initiateTransfer functions from your current
// file into the matching methods below rather than rewriting them;
// only the export shape needs to change to match monnify.service.js.
// ============================================================
import crypto from 'crypto';
// const existingPaystack = require('../paystack.service.OLD'); // your current file, renamed

async function initializePayment({ amount, reference, customerEmail, customerName, metadata }) {
  // return existingPaystack.initializeTransaction({ amount, reference, email: customerEmail, metadata });
  throw new Error('paystack.service.js: wire this to your existing initializeTransaction() logic');
}

async function verifyPayment(providerReference) {
 return existingPaystack.verifyTransaction(providerReference);
  throw new Error('paystack.service.js: wire this to your existing verifyTransaction() logic');
}

async function verifyBankAccount({ accountNumber, bankCode }) {
  // Paystack: GET /bank/resolve?account_number=...&bank_code=...
  throw new Error('paystack.service.js: wire this to Paystack account resolution');
}

async function initiateTransfer({ hotelAccount, amount, reference, metadata }) {
  // return existingPaystack.initiateTransfer({ ... });
  throw new Error('paystack.service.js: wire this to your existing initiateTransfer() logic');
}

async function refund({ providerReference, amount, reason }) {
  // Paystack: POST /refund
  throw new Error('paystack.service.js: wire this to Paystack refund API');
}

function verifyWebhookSignature(rawBody, signatureHeader) {
  // Paystack signs with HMAC SHA512 of PAYSTACK_SECRET_KEY over the raw body,
  // compared against the x-paystack-signature header.
  const computed = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
    .update(rawBody)
    .digest('hex');
    const a = Buffer.from(computed);
  const b = Buffer.from(String(signatureHeader || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export {
  initializePayment,
  verifyPayment,
  verifyBankAccount,
  initiateTransfer,
  refund,
  verifyWebhookSignature,
};

// This file stays inactive (PAYMENT_PROVIDER=monnify by default) but
// intact — flip the env var back to "paystack" as an emergency
// rollback if Monnify has issues after launch, once the three
// throw-new-Error stubs above are wired to your real logic.
