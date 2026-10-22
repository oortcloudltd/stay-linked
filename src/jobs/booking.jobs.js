// src/jobs/booking.jobs.js
import cron  from 'node-cron';
import prisma from '../config/database.js';

// Runs every 5 minutes
export const startBookingJobs = () => {
  cron.schedule('*/5 * * * *', async () => {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

    const cancelled = await prisma.booking.updateMany({
      where: {
        paymentStatus: 'UNPAID',
        status:        'PENDING',
        createdAt:     { lt: thirtyMinsAgo },
      },
      data: { status: 'CANCELLED' },
    });

    if (cancelled.count > 0) {
      console.log(`Auto-cancelled ${cancelled.count} unpaid bookings`);
    }
  });
  console.log('Booking jobs started');
};