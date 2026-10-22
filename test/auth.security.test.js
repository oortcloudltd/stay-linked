import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../src/config/database.js';
import app from '../src/app.js';
import * as authService from '../src/services/auth.service.js';
import { protect, protectOwner, protectStaff } from '../src/middleware/auth.middleware.js';
import { requireHotelOwnership, requireStaffHotelScope } from '../src/middleware/ownership.middleware.js';
import { errorHandler } from '../src/middleware/errorHandler.middleware.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { issueOtp, verifyOtp, OTP_PURPOSE } from '../src/services/otp.service.js';

const RUN = `t${Date.now()}`;
const SUFFIX = `.${RUN}@test.staylink.invalid`;
const em = (n) => `${n}${SUFFIX}`;
const PASSWORD = 'Passw0rd!';
const S = {};
let servers = [];
let base, appBase;

const listen = (a) => new Promise((resolve) => {
  const s = http.createServer(a).listen(0, () => { servers.push(s); resolve(`http://127.0.0.1:${s.address().port}`); });
});
const call = (b, path, token, init = {}) => fetch(b + path, {
  ...init,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
});
const denied = (res) => assert.ok([401, 403].includes(res.status), `expected 401/403, got ${res.status}`);
const userTok = (u, extra = {}) => signAccessToken({ userId: u.id, type: 'user', ...extra });
const staffTok = (s, extra = {}) => signAccessToken({ staffId: s.id, hotelId: s.hotelId, type: 'staff', ...extra });

let hash;
const mkUser = (name, role, extra = {}) => prisma.user.create({
  data: { name, email: em(name), passwordHash: hash, role, emailVerified: true,
    ...(role === 'OWNER' && { owner: { create: {} } }), ...extra },
  include: { owner: true },
});
const mkHotel = (name, ownerId) => prisma.hotel.create({
  data: { ownerId, name, address: '1 Test St', city: 'Bida', lga: 'Bida', state: 'Niger',
    phone: '08012345678', email: em(name), status: 'LIVE', isApproved: true },
});
const mkStaff = (name, hotelId) => prisma.hotelStaff.create({ data: { hotelId, name, email: em(name), passwordHash: hash } });

test('guest payload matches the prisma User schema shape', async () => {
  const data = await authService.buildGuestUserData({
    name: '',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'Jane.Doe@example.com',
    phone: '+2348123456789',
    password: 'Password123',
  });

  assert.equal(data.name, 'Jane Doe');
  assert.equal(data.firstName, 'Jane');
  assert.equal(data.lastName, 'Doe');
  assert.equal(data.email, 'jane.doe@example.com');
  assert.equal(data.role, 'GUEST');
  assert.equal(data.emailVerified, false);
  assert.ok(data.passwordHash.startsWith('$2'));
  assert.equal(data.phone, '+2348123456789');
});

before(async () => {
  hash = await bcrypt.hash(PASSWORD, 4);
  S.guest = await mkUser('guest', 'GUEST');
  S.ownerA = await mkUser('ownerA', 'OWNER');
  S.ownerB = await mkUser('ownerB', 'OWNER');
  S.hotelA = await mkHotel('hotelA', S.ownerA.owner.id);
  S.hotelB = await mkHotel('hotelB', S.ownerB.owner.id);
  S.staffA = await mkStaff('staffA', S.hotelA.id);
  S.staffB = await mkStaff('staffB', S.hotelB.id);
  S.unverified = await mkUser('unverified', 'GUEST', { emailVerified: false });

  const mini = express();
  mini.use(express.json());
  mini.get('/guest/me', protect, (req, res) => res.json({ id: req.user.id }));
  mini.get('/owner/hotels/:hotelId', protect, protectOwner, requireHotelOwnership(), (req, res) => res.json({ hotelId: req.hotel.id }));
  mini.get('/staff/hotels/:hotelId/rooms', protectStaff, requireStaffHotelScope, (req, res) => res.json({ hotelId: req.hotelId }));
  mini.post('/staff/echo', protectStaff, requireStaffHotelScope, (req, res) => res.json({ hotelId: req.hotelId }));
  mini.use(errorHandler);
  base = await listen(mini);
  appBase = await listen(app);
});

after(async () => {
  await prisma.hotel.deleteMany({ where: { email: { endsWith: SUFFIX } } });   // staff cascade
  await prisma.user.deleteMany({ where: { email: { endsWith: SUFFIX } } });    // owners + codes cascade
  servers.forEach((s) => s.close());
  await prisma.$disconnect();
});

// ── Role isolation ────────────────────────────────────────────────────────────
test('guest → guest endpoint = PASS', async () => {
  assert.equal((await call(base, '/guest/me', userTok(S.guest))).status, 200);
});
test('guest → owner endpoint = DENY', async () => denied(await call(base, `/owner/hotels/${S.hotelA.id}`, userTok(S.guest))));
test('guest → staff endpoint = DENY', async () => denied(await call(base, `/staff/hotels/${S.hotelA.id}/rooms`, userTok(S.guest))));
test('owner → staff endpoint = DENY', async () => denied(await call(base, `/staff/hotels/${S.hotelA.id}/rooms`, userTok(S.ownerA))));
test('staff → owner endpoint = DENY', async () => denied(await call(base, `/owner/hotels/${S.hotelA.id}`, staffTok(S.staffA))));
test('staff → user endpoint = DENY (not a 500)', async () => denied(await call(base, '/guest/me', staffTok(S.staffA))));
test('forged role claim in JWT grants nothing', async () => {
  denied(await call(base, `/owner/hotels/${S.hotelA.id}`, userTok(S.guest, { role: 'OWNER' })));
});
test('token signed with the wrong secret = DENY', async () => {
  const { default: jwt } = await import('jsonwebtoken');
  denied(await call(base, '/guest/me', jwt.sign({ userId: S.guest.id, type: 'user' }, 'not-the-secret')));
});
test('no token = 401', async () => assert.equal((await call(base, '/guest/me')).status, 401));
test('unverified account token = DENY', async () => denied(await call(base, '/guest/me', userTok(S.unverified))));

// ── Ownership ─────────────────────────────────────────────────────────────────
test('owner A → hotel A = PASS', async () => assert.equal((await call(base, `/owner/hotels/${S.hotelA.id}`, userTok(S.ownerA))).status, 200));
test('owner A → hotel B = DENY', async () => denied(await call(base, `/owner/hotels/${S.hotelB.id}`, userTok(S.ownerA))));
test('owner B → hotel B = PASS', async () => assert.equal((await call(base, `/owner/hotels/${S.hotelB.id}`, userTok(S.ownerB))).status, 200));

// ── Staff scope ───────────────────────────────────────────────────────────────
test('staff A → hotel A = PASS', async () => assert.equal((await call(base, `/staff/hotels/${S.hotelA.id}/rooms`, staffTok(S.staffA))).status, 200));
test('staff A → hotel B (URL) = DENY', async () => denied(await call(base, `/staff/hotels/${S.hotelB.id}/rooms`, staffTok(S.staffA))));
test('staff A → hotel B (body) = DENY', async () =>
  denied(await call(base, '/staff/echo', staffTok(S.staffA), { method: 'POST', body: JSON.stringify({ hotelId: S.hotelB.id }) })));
test('staff token with forged hotelId claim still resolves to the DB hotel', async () => {
  const res = await call(base, '/staff/echo', staffTok(S.staffA, { hotelId: S.hotelB.id }), { method: 'POST', body: '{}' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).hotelId, S.hotelA.id);
});
test('staff B → hotel B = PASS', async () => assert.equal((await call(base, `/staff/hotels/${S.hotelB.id}/rooms`, staffTok(S.staffB))).status, 200));

// ── Real login endpoints (uses authLimiter; keep this block small) ───────────
const login = (path, body) => call(appBase, `/api/v1/auth${path}`, null, { method: 'POST', body: JSON.stringify(body) });
test('guest login OK', async () => assert.equal((await login('/guest/login', { email: em('guest'), password: PASSWORD })).status, 200));
test('wrong password = 401', async () => assert.equal((await login('/guest/login', { email: em('guest'), password: 'Nope1234' })).status, 401));
test('unknown account = 401 (same as wrong password)', async () => assert.equal((await login('/guest/login', { email: em('ghost'), password: PASSWORD })).status, 401));
test('unverified guest = 403', async () => assert.equal((await login('/guest/login', { email: em('unverified'), password: PASSWORD })).status, 403));
test('guest creds at owner login = DENY', async () => denied(await login('/owner/login', { email: em('guest'), password: PASSWORD })));
test('owner creds at staff login = 401', async () => assert.equal((await login('/staff/login', { email: em('ownerA'), password: PASSWORD, hotelId: S.hotelA.id })).status, 401));
test('staff login OK', async () => assert.equal((await login('/staff/login', { email: em('staffA'), password: PASSWORD, hotelId: S.hotelA.id })).status, 200));

// ── OTP lifecycle (own user per test: cooldown is per account) ───────────────
let n = 0;
const freshUser = () => mkUser(`otp${n++}`, 'GUEST', { emailVerified: false });
const P = OTP_PURPOSE.EMAIL_VERIFY;

test('OTP is 6 digits, correct code passes, reuse fails', async () => {
  const u = await freshUser();
  const code = await issueOtp({ userId: u.id, purpose: P });
  assert.match(code, /^\d{6}$/);
  assert.equal(await verifyOtp({ userId: u.id, purpose: P, code }), true);
  assert.equal(await verifyOtp({ userId: u.id, purpose: P, code }), false);
});
test('wrong OTP = DENY', async () => {
  const u = await freshUser();
  const code = await issueOtp({ userId: u.id, purpose: P });
  assert.equal(await verifyOtp({ userId: u.id, purpose: P, code: code === '000000' ? '000001' : '000000' }), false);
});
test('expired OTP = DENY', async () => {
  const u = await freshUser();
  const code = await issueOtp({ userId: u.id, purpose: P });
  await prisma.verificationCode.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await verifyOtp({ userId: u.id, purpose: P, code }), false);
});
test('too many attempts burns the code even if the right one follows', async () => {
  const u = await freshUser();
  const code = await issueOtp({ userId: u.id, purpose: P });
  const wrong = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await verifyOtp({ userId: u.id, purpose: P, code: wrong });
  assert.equal(await verifyOtp({ userId: u.id, purpose: P, code }), false);
});
test('resend cooldown blocks an immediate second code', async () => {
  const u = await freshUser();
  assert.ok(await issueOtp({ userId: u.id, purpose: P }));
  assert.equal(await issueOtp({ userId: u.id, purpose: P }), null);
});
test('hourly cap blocks the 6th code', async () => {
  const u = await freshUser();
  for (let i = 0; i < 5; i++) {
    assert.ok(await issueOtp({ userId: u.id, purpose: P }));
    await prisma.verificationCode.updateMany({ where: { userId: u.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
  }
  assert.equal(await issueOtp({ userId: u.id, purpose: P }), null);
});
test('a new code invalidates the previous one', async () => {
  const u = await freshUser();
  const first = await issueOtp({ userId: u.id, purpose: P });
  await prisma.verificationCode.updateMany({ where: { userId: u.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
  const second = await issueOtp({ userId: u.id, purpose: P });
  assert.equal(await verifyOtp({ userId: u.id, purpose: P, code: first }), first === second);
  assert.equal(await verifyOtp({ userId: u.id, purpose: P, code: second }), first !== second);
});