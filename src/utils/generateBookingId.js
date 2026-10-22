import prisma from '../config/database.js';

/**
 * Generates a unique booking ID in format: STL-YYYYMMDD-XXXX
 * Checks DB to guarantee uniqueness.
 */
export async function generateBookingId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let id;
  let exists = true;

  while (exists) {
    const rand = Math.floor(1000 + Math.random() * 9000);
    id = `STL-${date}-${rand}`;
    const booking = await prisma.booking.findUnique({ where: { id } });
    exists = !!booking;
  }

  return id;
}
