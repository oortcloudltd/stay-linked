import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';

const router = Router();
const limiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false });

router.get('/resolve', limiter, asyncHandler(async (req, res) => {
  const { account_number: acct, bank_code: code } = req.query;
   if (!/^\d{10}$/.test(String(acct)) || !/^\d{3,6}$/.test(String(code))) {
    throw ApiError.badRequest('Invalid account details');
  }

  const r = await fetch(
    `https://api.paystack.co/bank/resolve?account_number=${acct}&bank_code=${code}`,
    { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
  );

  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body?.data?.account_name) {
    throw ApiError.badRequest('Account not found');
  }

  ApiResponse.ok(res, { accountName: body.data.account_name });
}));

export default router;