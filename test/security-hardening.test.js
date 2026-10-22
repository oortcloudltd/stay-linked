import assert from 'node:assert/strict';
import test from 'node:test';
import { getAdminSeedCredentials } from '../src/utils/adminSeedCredentials.js';
import { toSafeStaffSession } from '../src/utils/safeStaffSession.js';
import {
  createVerificationCodeStore,
  VERIFICATION_CODE_MAX_ATTEMPTS,
} from '../src/services/verificationCode.store.js';
import {
  DRAFT_KEY,
  clearDraft,
  loadDraft,
  saveDraft,
} from '../../stay-linked/src/pages/hotel/register/registerDraft.js';

test('staff session serializer excludes credential and refresh fields', () => {
  const session = toSafeStaffSession({
    id: 'staff-1', name: 'Staff', email: 'staff@example.test', hotelId: 'hotel-1',
    isActive: true, passwordHash: 'password-hash', pinHash: 'pin-hash',
    refreshToken: 'refresh-token', hotel: { id: 'hotel-1', name: 'Hotel', status: 'LIVE' },
  });

  assert.equal(session.role, 'hotel_staff');
  for (const field of ['passwordHash', 'pinHash', 'refreshToken']) {
    assert.equal(Object.hasOwn(session, field), false);
  }
});

function makeVerificationPrisma() {
  const records = [];
  let nextId = 0;
  const matches = (record, where) => {
    if (where.id && record.id !== where.id) return false;
    for (const field of ['userId', 'purpose', 'targetEmail', 'consumedAt']) {
      if (field in where && record[field] !== where[field]) return false;
    }
    if (where.attempts?.lt !== undefined && record.attempts >= where.attempts.lt) return false;
    if (where.expiresAt?.gt && record.expiresAt <= where.expiresAt.gt) return false;
    return true;
  };

  return {
    records,
    verificationCode: {
      async deleteMany({ where }) {
        for (let i = records.length - 1; i >= 0; i -= 1) {
          if (records[i].userId === where.userId && records[i].purpose === where.purpose) records.splice(i, 1);
        }
      },
      async create({ data }) {
        const record = { id: `code-${++nextId}`, attempts: 0, consumedAt: null, createdAt: new Date(), ...data };
        records.push(record);
        return record;
      },
      async findFirst({ where }) {
        return records.filter((record) => matches(record, where)).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
      },
      async updateMany({ where, data }) {
        const record = records.find((item) => matches(item, where));
        if (!record) return { count: 0 };
        if (data.attempts?.increment) record.attempts += data.attempts.increment;
        if (data.consumedAt) record.consumedAt = data.consumedAt;
        return { count: 1 };
      },
    },
  };
}

test('verification codes are hashed at rest and can only be consumed once', async () => {
  const prisma = makeVerificationPrisma();
  const codes = createVerificationCodeStore(prisma, 'test-only-secret');
  await codes.store({ userId: 'user-1', code: '123456', purpose: 'password_reset' });

  assert.notEqual(prisma.records[0].tokenHash, '123456');
  assert.match(prisma.records[0].tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(await codes.verify({ userId: 'user-1', code: '123456', purpose: 'password_reset' }), true);
  await assert.rejects(codes.verify({ userId: 'user-1', code: '123456', purpose: 'password_reset' }));
});

test('verification codes stop accepting guesses after the attempt limit', async () => {
  const prisma = makeVerificationPrisma();
  const codes = createVerificationCodeStore(prisma, 'test-only-secret');
  await codes.store({ userId: 'user-2', code: '654321', purpose: 'password_reset' });

  for (let attempt = 0; attempt < VERIFICATION_CODE_MAX_ATTEMPTS; attempt += 1) {
    await assert.rejects(codes.verify({ userId: 'user-2', code: '000000', purpose: 'password_reset' }));
  }
  assert.equal(prisma.records[0].attempts, VERIFICATION_CODE_MAX_ATTEMPTS);
  await assert.rejects(codes.verify({ userId: 'user-2', code: '654321', purpose: 'password_reset' }));
});

test('expired verification codes are rejected', async () => {
  const prisma = makeVerificationPrisma();
  const codes = createVerificationCodeStore(prisma, 'test-only-secret');
  await codes.store({ userId: 'user-3', code: '112233', purpose: 'password_reset' });
  prisma.records[0].expiresAt = new Date(Date.now() - 1);

  await assert.rejects(codes.verify({ userId: 'user-3', code: '112233', purpose: 'password_reset' }));
});

test('admin seeding requires explicit credentials', () => {
  assert.throws(() => getAdminSeedCredentials({}), /ADMIN_EMAIL, ADMIN_PASSWORD/);
  assert.deepEqual(getAdminSeedCredentials({ ADMIN_EMAIL: 'admin@example.test', ADMIN_PASSWORD: 'secret' }), {
    adminEmail: 'admin@example.test', adminPassword: 'secret',
  });
});

test('registration drafts never persist or restore sensitive fields', () => {
  const originalStorage = globalThis.sessionStorage;
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };

  try {
    saveDraft({ password: 'secret-pass', confirmPassword: 'secret-pass', pin: '1234', confirmPin: '1234', accountNumber: '1234567890', bankName: 'Example Bank', hotelName: 'Test Hotel' }, [], 1);
    const stored = values.get(DRAFT_KEY);
    for (const secret of ['secret-pass', '1234', '1234567890', 'Example Bank']) assert.equal(stored.includes(secret), false);

    const restored = loadDraft();
    assert.equal(restored.form.hotelName, 'Test Hotel');
    for (const field of ['password', 'confirmPassword', 'pin', 'confirmPin', 'accountName', 'accountNumber', 'bankName', 'bankCode']) {
      assert.equal(restored.form[field], '');
    }
    clearDraft();
    assert.equal(values.has(DRAFT_KEY), false);
  } finally {
    if (originalStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = originalStorage;
  }
});