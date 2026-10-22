import cron from 'node-cron';
import prisma from '../config/database.js';
import * as paystackService from '../services/paystack.service.js';
import * as emailService from '../services/email.service.js';
import QRCode from 'qrcode';

/**
 * Runs every 5 minutes.
 * Finds PENDING bookings older than 5 minutes (webhook may have been missed)
 * and verifies their payment status directly with Paystack.
 */
export function startPaymentReconciliationJob(io) {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      // Find pending bookings with a Paystack ref that are between 5 mins and 2 hours old
      const pendingBookings = await prisma.booking.findMany({
        where: {
          status: 'PENDING',
          paymentStatus: 'PENDING',
          paystackRef: { not: null },
          createdAt: { lt: fiveMinutesAgo, gte: twoHoursAgo },
        },
        include: { hotel: true, room: true },
        take: 50, // Process max 50 at a time
      });

      if (pendingBookings.length > 0) {
        console.log(`[Reconciliation] Checking ${pendingBookings.length} pending bookings...`);
      }

      for (const booking of pendingBookings) {
        try {
          const paystackData = await paystackService.verifyTransaction(booking.paystackRef);

          if (paystackData.status === 'success') {
            const qrPayload = JSON.stringify({ bookingId: booking.id, token: booking.qrCodeToken });
            const qrCodeDataUrl = await QRCode.toDataURL(qrPayload, { width: 300 });

            await prisma.$transaction([
              prisma.booking.update({
                where: { id: booking.id },
                data: { status: 'CONFIRMED', paymentStatus: 'WITHHELD', qrCodeUrl: qrCodeDataUrl },
              }),
              prisma.payment.upsert({
                where: { bookingId: booking.id },
                update: { status: 'WITHHELD', paystackStatus: 'success', paystackData },
                create: {
                  bookingId: booking.id,
                  amount: booking.totalAmount,
                  channel: 'PAYSTACK',
                  status: 'WITHHELD',
                  paystackRef: booking.paystackRef,
                  paystackStatus: 'success',
                  paystackData,
                },
              }),
              prisma.notification.create({
                data: {
                  hotelId: booking.hotelId,
                  type: 'booking_new',
                  title: 'New Booking (Reconciled)',
                  message: `${booking.guestName} — ${booking.room?.name} — ${booking.nights} night(s). Payment confirmed via reconciliation.`,
                  bookingId: booking.id,
                },
              }),
            ]);

            if (io) {
              io.to(`hotel:${booking.hotelId}`).emit('booking:new', {
                bookingId: booking.id,
                guestName: booking.guestName,
                roomName: booking.room?.name,
                checkIn: booking.checkIn,
                nights: booking.nights,
                totalAmount: booking.totalAmount,
              });
            }

            await emailService.sendBookingConfirmation({
              booking,
              hotel: booking.hotel,
              room: booking.room,
              qrCodeDataUrl,
            });

            console.log(`[Reconciliation] ✅ Confirmed booking ${booking.id}`);
          } else if (paystackData.status === 'failed' || paystackData.status === 'abandoned') {
            // Mark booking as cancelled — payment never went through
            await prisma.booking.update({
              where: { id: booking.id },
              data: {
                status: 'CANCELLED',
                paymentStatus: 'FAILED',
                cancelReason: `Payment ${paystackData.status} — auto-cancelled by reconciliation job`,
                cancelledAt: new Date(),
              },
            });
            console.log(`[Reconciliation] ❌ Cancelled booking ${booking.id} — payment ${paystackData.status}`);
          }
        } catch (err) {
          console.error(`[Reconciliation] Error checking booking ${booking.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[Reconciliation] Job error:', err.message);
    }
  });

  console.log('⏰ Payment reconciliation job started (every 5 minutes)');
}

/**
 * Runs daily at 10pm.
 * Marks CONFIRMED bookings whose check-in date has passed as NO_SHOW.
 */
export function startNoShowJob() {
  cron.schedule('0 22 * * *', async () => {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(23, 59, 59, 999);

      const noShows = await prisma.booking.findMany({
        where: {
          status: 'CONFIRMED',
          checkIn: { lt: yesterday },
        },
        include: { hotel: true },
      });

      for (const booking of noShows) {
        await prisma.booking.update({
          where: { id: booking.id },
          data: { status: 'NO_SHOW' },
        });
        console.log(`[NoShow] Marked ${booking.id} as NO_SHOW`);
      }

      if (noShows.length > 0) {
        console.log(`[NoShow] Marked ${noShows.length} bookings as no-show`);
      }
    } catch (err) {
      console.error('[NoShow] Job error:', err.message);
    }
  });

  console.log('⏰ No-show detection job started (daily at 10pm)');
}
