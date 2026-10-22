import pool from '../config/database.js';
import { ApiError } from '../utils/ApiError.js';
import * as paystackService from './paystack.service.js';

// ─────────────────────────────────────────────
// DASHBOARD ANALYTICS
// ─────────────────────────────────────────────
export async function getDashboardStats() {
  const [
    totalHotelsRes,
    pendingApprovalRes,
    totalUsersRes,
    totalBookingsRes,
    confirmedBookingsRes,
    checkedInBookingsRes,
    revenueDataRes,
    recentBookingsRes,
    recentHotelsRes,
  ] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int as count FROM "hotels" WHERE status = 'LIVE'`),
    pool.query(`SELECT COUNT(*)::int as count FROM "hotels" WHERE status = 'PENDING'`),
    pool.query(`SELECT COUNT(*)::int as count FROM "users" WHERE role = 'GUEST'`),
    pool.query(`SELECT COUNT(*)::int as count FROM "bookings"`),
    pool.query(`SELECT COUNT(*)::int as count FROM "bookings" WHERE status = 'CONFIRMED'`),
    pool.query(`SELECT COUNT(*)::int as count FROM "bookings" WHERE status = 'CHECKED_IN'`),
    pool.query(`SELECT COALESCE(SUM(amount),0)::float as total FROM "payments" WHERE status IN ('WITHHELD','RELEASED')`),
    pool.query(`
      SELECT 
        b.*,
        jsonb_build_object('name', h.name, 'city', h.city) as hotel,
        jsonb_build_object('name', r.name) as room
      FROM "bookings" b
      LEFT JOIN "hotels" h ON h.id = b."hotelId"
      LEFT JOIN "rooms" r ON r.id = b."roomId"
      ORDER BY b."createdAt" DESC
      LIMIT 10
    `),
    pool.query(`
      SELECT 
        h.*,
        jsonb_build_object(
          'user', jsonb_build_object('name', u.name, 'email', u.email)
        ) as owner
      FROM "hotels" h
      LEFT JOIN "hotel_owners" ho ON ho.id = h."ownerId"
      LEFT JOIN "users" u ON u.id = ho."userId"
      WHERE h.status = 'PENDING'
      ORDER BY h."createdAt" DESC
      LIMIT 5
    `),
  ]);

  return {
    summary: {
      totalHotels: totalHotelsRes.rows[0].count,
      pendingApproval: pendingApprovalRes.rows[0].count,
      totalUsers: totalUsersRes.rows[0].count,
      totalBookings: totalBookingsRes.rows[0].count,
      confirmedBookings: confirmedBookingsRes.rows[0].count,
      checkedInBookings: checkedInBookingsRes.rows[0].count,
      totalRevenue: revenueDataRes.rows[0].total || 0,
    },
    recentBookings: recentBookingsRes.rows,
    recentHotels: recentHotelsRes.rows,
  };
}

// ─────────────────────────────────────────────
// MONTHLY REVENUE CHART (last 6 months)
// ─────────────────────────────────────────────
export async function getRevenueChart() {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const { rows: payments } = await pool.query(
    `
    SELECT amount, "createdAt" 
    FROM "payments" 
    WHERE status IN ('WITHHELD','RELEASED') 
    AND "createdAt" >= $1
    `,
    [sixMonthsAgo]
  );

  // Group by month in JS (same as your original)
  const monthly = {};
  payments.forEach(({ amount, createdAt }) => {
    const d = new Date(createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthly[key] = (monthly[key] || 0) + Number(amount);
  });

  return Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, revenue]) => ({ month, revenue: parseFloat(revenue.toFixed(2)) }));
}

// Alternative pure SQL version (faster):
// SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') as month,
//        SUM(amount)::float as revenue
// FROM "payments" WHERE status IN ('WITHHELD','RELEASED') AND "createdAt" >= $1
// GROUP BY 1 ORDER BY 1

// ─────────────────────────────────────────────
// ALL USERS
// ─────────────────────────────────────────────
export async function getAllUsers({ role, page = 1, limit = 20, search }) {
  const offset = (page - 1) * limit;
  const values = [];
  const whereClauses = [];

  if (role) {
    values.push(role);
    whereClauses.push(`u.role = $${values.length}`);
  }

  if (search) {
    values.push(`%${search}%`);
    const idx = values.length;
    whereClauses.push(`(u.name ILIKE $${idx} OR u.email ILIKE $${idx})`);
  }

  const whereSQL = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const usersQuery = `
    SELECT 
      u.id, u.name, u.email, u.phone, u.role, u."emailVerified", u."createdAt",
      (SELECT COUNT(*)::int FROM "bookings" b WHERE b."userId" = u.id) as bookings_count
    FROM "users" u
    ${whereSQL}
    ORDER BY u."createdAt" DESC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
  `;

  const countQuery = `
    SELECT COUNT(*)::int as total FROM "users" u ${whereSQL}
  `;

  const [usersRes, countRes] = await Promise.all([
    pool.query(usersQuery, [...values, limit, offset]),
    pool.query(countQuery, values),
  ]);

  const total = countRes.rows[0].total;
  
  // reshape to match prisma _count structure
  const users = usersRes.rows.map(r => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    role: r.role,
    emailVerified: r.emailVerified,
    createdAt: r.createdAt,
    _count: { bookings: r.bookings_count }
  }));

  return { users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

// ─────────────────────────────────────────────
// ALL BOOKINGS (Admin view)
// ─────────────────────────────────────────────
export async function getAllBookings({ status, paymentStatus, page = 1, limit = 20 }) {
  const offset = (page - 1) * limit;
  const values = [];
  const whereClauses = [];

  if (status) {
    values.push(status);
    whereClauses.push(`b.status = $${values.length}`);
  }
  if (paymentStatus) {
    values.push(paymentStatus);
    whereClauses.push(`b."paymentStatus" = $${values.length}`);
  }

  const whereSQL = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const bookingsQuery = `
    SELECT 
      b.*,
      jsonb_build_object('id', h.id, 'name', h.name, 'city', h.city) as hotel,
      jsonb_build_object('name', r.name, 'type', r.type) as room,
      jsonb_build_object('name', u.name, 'email', u.email) as user,
      to_jsonb(p) as payment
    FROM "bookings" b
    LEFT JOIN "hotels" h ON h.id = b."hotelId"
    LEFT JOIN "rooms" r ON r.id = b."roomId"
    LEFT JOIN "users" u ON u.id = b."userId"
    LEFT JOIN "payments" p ON p."bookingId" = b.id
    ${whereSQL}
    ORDER BY b."createdAt" DESC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
  `;

  const countQuery = `SELECT COUNT(*)::int as total FROM "bookings" b ${whereSQL}`;

  const [bookingsRes, countRes] = await Promise.all([
    pool.query(bookingsQuery, [...values, limit, offset]),
    pool.query(countQuery, values),
  ]);

  const total = countRes.rows[0].total;

  return { bookings: bookingsRes.rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

// ─────────────────────────────────────────────
// MANUAL PAYMENT OVERRIDE (Admin safety net)
// ─────────────────────────────────────────────
export async function manualPaymentOverride({ bookingId, action, adminId, reason }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT b.*, to_jsonb(p) as payment, to_jsonb(h) as hotel
       FROM "bookings" b
       LEFT JOIN "payments" p ON p."bookingId" = b.id
       LEFT JOIN "hotels" h ON h.id = b."hotelId"
       WHERE b.id = $1 FOR UPDATE`,
      [bookingId]
    );

    const booking = rows[0];
    if (!booking) {
      throw ApiError.notFound('Booking not found');
    }

    if (action === 'release') {
      if (booking.paymentStatus === 'RELEASED') {
        throw ApiError.badRequest('Payment already released');
      }

      const newStatus = booking.status === 'CONFIRMED' ? 'CHECKED_IN' : booking.status;

      await client.query(
        `UPDATE "bookings" 
         SET "paymentStatus" = 'RELEASED',
             status = $2,
             "paymentReleasedAt" = NOW(),
             "paymentReleasedBy" = $3,
             "updatedAt" = NOW()
         WHERE id = $1`,
        [bookingId, newStatus, adminId]
      );

      await client.query(
        `UPDATE "payments"
         SET status = 'RELEASED', "releasedAt" = NOW(), "releasedBy" = $2, "updatedAt" = NOW()
         WHERE "bookingId" = $1`,
        [bookingId, adminId]
      );

      await client.query('COMMIT');
      return { message: `Payment manually released for booking ${bookingId}` };
    }

    if (action === 'refund') {
      if (booking.paymentStatus === 'REFUNDED') {
        throw ApiError.badRequest('Payment already refunded');
      }

      let refundResult = null;
      if (booking.paystackRef) {
        try {
          refundResult = await paystackService.refundTransaction({ transactionId: booking.paystackRef });
        } catch (err) {
          throw ApiError.internal(`Paystack refund failed: ${err.message}`);
        }
      }

      await client.query(
        `UPDATE "bookings"
         SET "paymentStatus" = 'REFUNDED',
             status = 'CANCELLED',
             "cancelReason" = $2,
             "cancelledAt" = NOW(),
             "updatedAt" = NOW()
         WHERE id = $1`,
        [bookingId, reason]
      );

      await client.query(
        `UPDATE "payments"
         SET status = 'REFUNDED',
             "refundedAt" = NOW(),
             "refundedBy" = $2,
             "refundReason" = $3,
             "updatedAt" = NOW()
         WHERE "bookingId" = $1`,
        [bookingId, adminId, reason]
      );

      await client.query('COMMIT');
      return { message: `Payment refunded for booking ${bookingId}`, refundResult };
    }

    throw ApiError.badRequest('Invalid action. Use "release" or "refund"');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────
// VERIFY BANK ACCOUNT
// ─────────────────────────────────────────────
export async function verifyBankAccount(accountNumber, bankCode) {
  return paystackService.verifyAccountNumber(accountNumber, bankCode);
}

export async function listBanks() {
  return paystackService.listBanks();
}