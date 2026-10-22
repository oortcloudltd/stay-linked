// ============================================================
// src/services/payment/monnify.service.js
// Monnify implementation of the PaymentService interface.
// Docs: https://docs.teamapt.com/display/MON (Monnify API reference)
// Adjust endpoint paths if Monnify has updated their API surface
// since this was written — verify against their current docs
// before going live.
// ============================================================

import axios from 'axios';
import crypto from 'crypto';

const BASE_URL = process.env.MONNIFY_BASE_URL; // e.g. https://api.monnify.com
const API_KEY = process.env.MONNIFY_API_KEY;
const SECRET_KEY = process.env.MONNIFY_SECRET_KEY;
const CONTRACT_CODE = process.env.MONNIFY_CONTRACT_CODE;

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Fails fast with a clear error if Monnify is not configured.
 * Monnify is optional at startup, so every operation must check
 * before making a request.
 */
function assertMonnifyConfigured({ contractCode = false, walletAccount = false } = {}) {
  const required = [
    ['MONNIFY_BASE_URL', BASE_URL],
    ['MONNIFY_API_KEY', API_KEY],
    ['MONNIFY_SECRET_KEY', SECRET_KEY],
  ];

  if (contractCode) {
    required.push(['MONNIFY_CONTRACT_CODE', CONTRACT_CODE]);
  }

  if (walletAccount) {
    required.push([
      'MONNIFY_WALLET_ACCOUNT_NUMBER',
      process.env.MONNIFY_WALLET_ACCOUNT_NUMBER,
    ]);
  }

  const missing = required
    .filter(([, value]) => !String(value ?? '').trim())
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Monnify is not configured for this operation. Missing: ${missing.join(', ')}`
    );
  }
}

/**
 * Monnify auth: Basic-auth API key + secret to get a bearer token.
 * Token is cached and refreshed shortly before it expires.
 */
async function getAccessToken() {
  assertMonnifyConfigured();

  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const credentials = Buffer.from(`${API_KEY}:${SECRET_KEY}`).toString('base64');

  const { data } = await axios.post(
    `${BASE_URL}/api/v1/auth/login`,
    {},
    { headers: { Authorization: `Basic ${credentials}` } }
  );

  cachedToken = data.responseBody.accessToken;
  // Monnify tokens typically last ~1 hour — refresh 60s early to be safe.
  const expiresInSeconds = data.responseBody.expiresIn || 3600;
  tokenExpiresAt = Date.now() + (expiresInSeconds - 60) * 1000;

  return cachedToken;
}

async function authedClient() {
  const token = await getAccessToken();
  return axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Retries a request up to 3 times with exponential backoff on
 * network errors or 5xx responses. Does NOT retry on 4xx — those
 * are our bug, not a transient failure.
 */
async function withRetry(fn, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      if (status && status < 500) throw err; // don't retry client errors
      const delay = 500 * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

async function initializePayment({ amount, reference, customerEmail, customerName, metadata }) {
  assertMonnifyConfigured({ contractCode: true });

  const client = await authedClient();

  const { data } = await withRetry(() =>
    client.post('/api/v1/merchant/transactions/init-transaction', {
      amount,
      customerName,
      customerEmail,
      paymentReference: reference,
      paymentDescription: metadata?.description || 'StayLink booking payment',
      currencyCode: 'NGN',
      contractCode: CONTRACT_CODE,
      redirectUrl: metadata?.redirectUrl,
      metaData: metadata || {},
    })
  );

  return {
    checkoutUrl: data.responseBody.checkoutUrl,
    providerReference: data.responseBody.transactionReference,
    paymentReference: reference,
  };
}

async function verifyPayment(providerReference) {
  const client = await authedClient();

  const { data } = await withRetry(() =>
    client.get(`/api/v2/transactions/${providerReference}`)
  );

  const status = data.responseBody.paymentStatus; // e.g. "PAID", "PENDING", "FAILED"

  return {
    status,
    amount: data.responseBody.amountPaid,
    raw: data.responseBody,
  };
}

/**
 * Verifies a bank account name before a hotel's payout details are saved.
 */
async function verifyBankAccount({ accountNumber, bankCode }) {
  const client = await authedClient();

  const { data } = await withRetry(() =>
    client.get('/api/v1/disbursements/account/validate', {
      params: { accountNumber, bankCode },
    })
  );

  return {
    accountName: data.responseBody.accountName,
    accountNumber: data.responseBody.accountNumber,
    verified: true,
  };
}

/**
 * Transfers held funds to a hotel's verified bank account.
 */
async function initiateTransfer({ hotelAccount, amount, reference, metadata }) {
  assertMonnifyConfigured({ walletAccount: true });

  const client = await authedClient();

  const { data } = await withRetry(() =>
    client.post('/api/v2/disbursements/single', {
      amount,
      reference,
      narration: metadata?.narration || 'StayLink payout',
      destinationBankCode: hotelAccount.bankCode,
      destinationAccountNumber: hotelAccount.accountNumber,
      currency: 'NGN',
      sourceAccountNumber: process.env.MONNIFY_WALLET_ACCOUNT_NUMBER,
    })
  );

  return {
    providerReference: data.responseBody.reference,
    status: data.responseBody.status, // e.g. "SUCCESS", "PENDING"
    raw: data.responseBody,
  };
}

async function refund({ providerReference, amount, reason }) {
  const client = await authedClient();

  const { data } = await withRetry(() =>
    client.post('/api/v1/refunds/initiate-refund', {
      transactionReference: providerReference,
      refundAmount: amount,
      refundReason: reason || 'Booking cancelled / renewal rejected',
      customerNote: reason || 'Refund from StayLink',
    })
  );

  return {
    providerReference: data.responseBody.refundReference,
    status: data.responseBody.refundStatus,
    raw: data.responseBody,
  };
}

/**
 * Verifies an incoming webhook's signature. Monnify signs webhook
 * bodies with your secret key using SHA-512 — confirm the exact
 * header name/algorithm against current Monnify docs before relying
 * on this in production.
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  assertMonnifyConfigured();

  const computed = crypto
    .createHmac('sha512', SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  return computed === signatureHeader;
}

export {
  initializePayment,
  verifyPayment,
  verifyBankAccount,
  initiateTransfer,
  refund,
  verifyWebhookSignature,
};