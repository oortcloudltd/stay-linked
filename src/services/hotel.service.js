import pool from '../config/database.js';
import cloudinary from '../config/cloudinary.js';
import { ApiError } from '../utils/ApiError.js';
import bcrypt from 'bcryptjs';
import { toPublicHotel } from '../utils/hotelPublic.js';
import { getAvailability } from './roomAvailability.service.js';

function buildGoogleMapsUrl(latitude, longitude, address) {
  if (latitude && longitude) {
    return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  }
  if (address) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
  }
  return null;
}

const formatHotelPublic = (hotel) => toPublicHotel(hotel);

// CREATE HOTEL
export async function createHotel(ownerId, data, imageFiles = []) {
  const imageUrls = imageFiles.map((f) => f.path);
  const googleMapsUrl = buildGoogleMapsUrl(
    data.latitude, data.longitude,
    `${data.address}, ${data.city}, ${data.state}, Nigeria`
  );

  const query = `
    INSERT INTO "hotels" (
      "id", "ownerId", "name", "description", "category", "address", "city", "lga", "state",
      "latitude", "longitude", "googleMapsUrl", "phone", "email",
      "images", "amenities", "status", "isApproved", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13,
      $14, $15, 'PENDING', false, NOW(), NOW()
    ) RETURNING *;
  `;
  const values = [
    ownerId, data.name, data.description, data.category, data.address,
    data.city, data.lga, data.state, data.latitude, data.longitude,
    googleMapsUrl, data.phone, data.email,
    imageUrls, data.amenities || []
  ];
  const { rows } = await pool.query(query, values);
  return rows[0];
}

// GET OWNER HOTELS
export async function getOwnerHotels(ownerId) {
  const query = `
    SELECT h.*,
      (SELECT json_agg(json_build_object('id', r.id, 'name', r.name, 'type', r.type, 'pricePerNight', r."pricePerNight", 'isAvailable', r."isAvailable"))
       FROM "rooms" r WHERE r."hotelId" = h.id) as rooms,
      (SELECT COUNT(*)::int FROM "bookings" b WHERE b."hotelId" = h.id) as bookings_count,
      (SELECT COUNT(*)::int FROM "hotel_staff" s WHERE s."hotelId" = h.id) as staff_count
    FROM "hotels" h
    WHERE h."ownerId" = $1
    ORDER BY h."createdAt" DESC;
  `;
  const { rows } = await pool.query(query, [ownerId]);
  return rows;
}

// GET SINGLE OWNER HOTEL
export async function getOwnerHotelById(hotelId, ownerId) {
  const hotelQuery = `
    SELECT h.*, 
      (SELECT json_agg(r.*) FROM "rooms" r WHERE r."hotelId" = h.id) as rooms,
      (SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'email', s.email, 'role', s.role, 'isActive', s."isActive", 'lastLogin', s."lastLogin"))
       FROM "hotel_staff" s WHERE s."hotelId" = h.id) as staff
    FROM "hotels" h
    WHERE h.id = $1 AND h."ownerId" = $2;
  `;
  const { rows } = await pool.query(hotelQuery, [hotelId, ownerId]);
  if (!rows[0]) throw ApiError.notFound('Hotel not found');
  return rows[0];
}

// UPDATE HOTEL
export async function updateHotel(hotelId, ownerId, data, newImageFiles = []) {
  // 1. check ownership + get old images
  const existing = await pool.query(`SELECT * FROM "hotels" WHERE id = $1 AND "ownerId" = $2`, [hotelId, ownerId]);
  if (!existing.rows[0]) throw ApiError.notFound('Hotel not found');
  const hotel = existing.rows[0];

  const newImageUrls = newImageFiles.map((f) => f.path);
  const allImages = [...(hotel.images || []), ...newImageUrls];

  const googleMapsUrl = buildGoogleMapsUrl(
    data.latitude ?? hotel.latitude,
    data.longitude ?? hotel.longitude,
    `${data.address ?? hotel.address}, ${data.city ?? hotel.city}, ${data.state ?? hotel.state}, Nigeria`
  );

  const query = `
    UPDATE "hotels" SET
      "name" = COALESCE($3, "name"),
      "description" = COALESCE($4, "description"),
      "address" = COALESCE($5, "address"),
      "city" = COALESCE($6, "city"),
      "lga" = COALESCE($7, "lga"),
      "state" = COALESCE($8, "state"),
      "latitude" = COALESCE($9, "latitude"),
      "longitude" = COALESCE($10, "longitude"),
      "phone" = COALESCE($11, "phone"),
      "email" = COALESCE($12, "email"),
      "amenities" = COALESCE($13, "amenities"),
      "category" = COALESCE($14, "category"),
      "images" = $15,
      "googleMapsUrl" = $16,
      "updatedAt" = NOW()
    WHERE id = $1 AND "ownerId" = $2
    RETURNING *;
  `;
  const values = [
    hotelId, ownerId,
    data.name, data.description, data.address, data.city, data.lga, data.state,
    data.latitude, data.longitude, data.phone, data.email, data.amenities, data.category,
    allImages, googleMapsUrl
  ];
  const { rows } = await pool.query(query, values);
  return rows[0];
}

// DELETE HOTEL IMAGE
export async function deleteHotelImage(hotelId, ownerId, imageUrl) {
  const { rows } = await pool.query(`SELECT * FROM "hotels" WHERE id = $1 AND "ownerId" = $2`, [hotelId, ownerId]);
  if (!rows[0]) throw ApiError.notFound('Hotel not found');

  const publicId = imageUrl.split('/').slice(-2).join('/').replace(/\.[^.]+$/, '');
  await cloudinary.uploader.destroy(publicId);

  const updatedImages = rows[0].images.filter((img) => img !== imageUrl);
  const updated = await pool.query(`UPDATE "hotels" SET images = $1, "updatedAt" = NOW() WHERE id = $2 RETURNING *`, [updatedImages, hotelId]);
  return updated.rows[0];
}

// PUBLIC SEARCH - MOST COMPLEX
export async function searchHotels({ search, state, lga, city, category, minPrice, maxPrice, guests = 1, page = 1, limit = 20, sortBy = 'rating' }) {
  const skip = (page - 1) * limit;
  let paramIdx = 1;
  const conditions = [`h."isApproved" = true`, `h."status" = 'LIVE'`];
  const values = [];

  if (state) { conditions.push(`h."state" ILIKE $${paramIdx}`); values.push(state); paramIdx++; }
  if (lga) { conditions.push(`h."lga" ILIKE $${paramIdx}`); values.push(lga); paramIdx++; }
  if (city) { conditions.push(`h."city" ILIKE $${paramIdx}`); values.push(city); paramIdx++; }
  if (category) { conditions.push(`h."category" = $${paramIdx}`); values.push(category); paramIdx++; }
  if (search) {
    conditions.push(`(h."name" ILIKE $${paramIdx} OR h."city" ILIKE $${paramIdx} OR h."lga" ILIKE $${paramIdx} OR h."state" ILIKE $${paramIdx} OR h."description" ILIKE $${paramIdx} OR $${paramIdx-1} = ANY(h."amenities"))`);
    // duplicate search param for amenities check
    values.push(`%${search}%`);
    paramIdx++;
  }

  // Room availability filter
  let roomFilter = `r."hotelId" = h.id AND r."isAvailable" = true AND r."maxGuests" >= $${paramIdx}`;
  values.push(Number(guests));
  paramIdx++;

  if (minPrice) { roomFilter += ` AND r."pricePerNight" >= $${paramIdx}`; values.push(Number(minPrice)); paramIdx++; }
  if (maxPrice) { roomFilter += ` AND r."pricePerNight" <= $${paramIdx}`; values.push(Number(maxPrice)); paramIdx++; }

  conditions.push(`EXISTS (SELECT 1 FROM "rooms" r WHERE ${roomFilter})`);

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  let orderBy = `h."averageRating" DESC`;
  if (sortBy === 'price') orderBy = `(SELECT MIN("pricePerNight") FROM "rooms" WHERE "hotelId" = h.id) ASC`;
  else if (sortBy === 'newest') orderBy = `h."createdAt" DESC`;
  else if (sortBy === 'name') orderBy = `h."name" ASC`;

  const dataQuery = `
    SELECT h.*,
      (SELECT json_agg(json_build_object('id', r.id, 'name', r.name, 'type', r.type, 'pricePerNight', r."pricePerNight", 'maxGuests', r."maxGuests", 'images', r.images)
        ORDER BY r."pricePerNight" ASC)
       FROM (SELECT * FROM "rooms" r WHERE r."hotelId" = h.id AND r."isAvailable" = true AND r."maxGuests" >= $1 ORDER BY r."pricePerNight" ASC LIMIT 3) r
      ) as rooms
    FROM "hotels" h
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT $${paramIdx} OFFSET $${paramIdx+1};
  `;
  
  // For count query, we need values without limit/offset
  const countQuery = `SELECT COUNT(*)::int as total FROM "hotels" h ${whereClause};`;

  // The dataQuery values: first value is guests, we already built values array. Need to add limit/offset at end
  const dataValues = [...values, limit, skip];
  // Count query needs values without limit/offset but needs correct guest param position
  // Rebuild count values (same as values)
  const [hotelsRes, countRes] = await Promise.all([
    pool.query(dataQuery, dataValues),
    pool.query(countQuery, values)
  ]);

  const total = countRes.rows[0].total;
  return {
    hotels: hotelsRes.rows.map(formatHotelPublic),
    pagination: { page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1 }
  };
}

// GET HOTEL BY ID PUBLIC
export async function getHotelById(hotelId) {
  const query = `
    SELECT h.*, json_agg(r.* ORDER BY r."pricePerNight" ASC) as rooms
    FROM "hotels" h
    LEFT JOIN "rooms" r ON r."hotelId" = h.id AND r."isAvailable" = true
    WHERE h.id = $1 AND h."isApproved" = true AND h."status" = 'LIVE'
    GROUP BY h.id;
  `;
  const { rows } = await pool.query(query, [hotelId]);
  if (!rows[0]) throw ApiError.notFound('Hotel not found');
  return formatHotelPublic(rows[0]);
}

// ROOMS
export async function addRoom(hotelId, ownerId, data, imageFiles = []) {
  const check = await pool.query(`SELECT id FROM "hotels" WHERE id = $1 AND "ownerId" = $2`, [hotelId, ownerId]);
  if (!check.rows[0]) throw ApiError.notFound('Hotel not found');
  
  const imageUrls = imageFiles.map((f) => f.path);
  const q = `INSERT INTO "rooms" (id, "hotelId", name, type, description, "pricePerNight", "maxGuests", images, amenities, "isAvailable", "createdAt") 
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, true, NOW()) RETURNING *`;
  const { rows } = await pool.query(q, [hotelId, data.name, data.type, data.description, data.pricePerNight, data.maxGuests, imageUrls, data.amenities || []]);
  return rows[0];
}

export async function updateRoom(roomId, hotelId, ownerId, data, newImageFiles = []) {
  const roomQ = `SELECT r.* FROM "rooms" r JOIN "hotels" h ON h.id = r."hotelId" WHERE r.id = $1 AND r."hotelId" = $2 AND h."ownerId" = $3`;
  const { rows } = await pool.query(roomQ, [roomId, hotelId, ownerId]);
  if (!rows[0]) throw ApiError.notFound('Room not found');

  const newImageUrls = newImageFiles.map((f) => f.path);
  const allImages = [...(rows[0].images || []), ...newImageUrls];

  const q = `UPDATE "rooms" SET name = COALESCE($2, name), type = COALESCE($3, type), "pricePerNight" = COALESCE($4, "pricePerNight"), "maxGuests" = COALESCE($5, "maxGuests"), images = $6, amenities = COALESCE($7, amenities), "updatedAt" = NOW() WHERE id = $1 RETURNING *`;
  const res = await pool.query(q, [roomId, data.name, data.type, data.pricePerNight, data.maxGuests, allImages, data.amenities]);
  return res.rows[0];
}

export async function deleteRoom(roomId, hotelId, ownerId) {
  const q = `
    SELECT r.*, (SELECT COUNT(*)::int FROM "bookings" b WHERE b."roomId" = r.id AND b.status IN ('PENDING','CONFIRMED','CHECKED_IN')) as active_bookings
    FROM "rooms" r JOIN "hotels" h ON h.id = r."hotelId"
    WHERE r.id = $1 AND r."hotelId" = $2 AND h."ownerId" = $3
  `;
  const { rows } = await pool.query(q, [roomId, hotelId, ownerId]);
  if (!rows[0]) throw ApiError.notFound('Room not found');
  if (rows[0].active_bookings > 0) throw ApiError.badRequest('Cannot delete a room with active bookings. Deactivate it instead.');
  
  await pool.query(`DELETE FROM "rooms" WHERE id = $1`, [roomId]);
  return { deleted: true };
}

// STAFF
export async function createStaff(hotelId, ownerId, { name, email, password, role, pin }) {
  const hotelCheck = await pool.query(`SELECT id FROM "hotels" WHERE id = $1 AND "ownerId" = $2`, [hotelId, ownerId]);
  if (!hotelCheck.rows[0]) throw ApiError.notFound('Hotel not found');

  const exists = await pool.query(`SELECT id FROM "hotel_staff" WHERE email = $1`, [email]);
  if (exists.rows[0]) throw ApiError.conflict('A staff account with this email already exists');

  const passwordHash = await bcrypt.hash(password, 12);
  const pinHash = pin ? await bcrypt.hash(pin, 12) : null;

  const q = `INSERT INTO "hotel_staff" (id, "hotelId", name, email, "passwordHash", "pinHash", role, "isActive", "createdAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, true, NOW()) RETURNING id, name, email, role, "isActive", "createdAt"`;
  const { rows } = await pool.query(q, [hotelId, name, email, passwordHash, pinHash, role]);
  return rows[0];
}

export async function approveHotel(hotelId, adminId) {
  const q = `UPDATE "hotels" SET "isApproved" = true, status = 'LIVE', "approvedAt" = NOW(), "approvedBy" = $2, "updatedAt" = NOW() WHERE id = $1 RETURNING *`;
  const { rows } = await pool.query(q, [hotelId, adminId]);
  if (!rows[0]) throw ApiError.notFound('Hotel not found');
  return rows[0];
}

export async function suspendHotel(hotelId) {
  const { rows } = await pool.query(`UPDATE "hotels" SET status = 'SUSPENDED', "isApproved" = false, "updatedAt" = NOW() WHERE id = $1 RETURNING *`, [hotelId]);
  if (!rows[0]) throw ApiError.notFound('Hotel not found');
  return rows[0];
}

export async function getAllHotelsAdmin({ status, page = 1, limit = 20, search }) {
  const skip = (page - 1) * limit;
  let conditions = []; let values = []; let idx = 1;
  if (status) { conditions.push(`h.status = $${idx}`); values.push(status); idx++; }
  if (search) { conditions.push(`(h.name ILIKE $${idx} OR h.state ILIKE $${idx} OR h.city ILIKE $${idx})`); values.push(`%${search}%`); idx++; }
  
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const dataQ = `SELECT h.*, json_build_object('name', u.name, 'email', u.email, 'phone', u.phone) as owner_user FROM "hotels" h LEFT JOIN "hotel_owners" ho ON ho.id = h."ownerId" LEFT JOIN "users" u ON u.id = ho."userId" ${where} ORDER BY h."createdAt" DESC LIMIT $${idx} OFFSET $${idx+1}`;
  const countQ = `SELECT COUNT(*)::int as total FROM "hotels" h ${where}`;

  const [data, count] = await Promise.all([
    pool.query(dataQ, [...values, limit, skip]),
    pool.query(countQ, values)
  ]);
  return { hotels: data.rows, pagination: { page, limit, total: count.rows[0].total, pages: Math.ceil(count.rows[0].total / limit) } };
}