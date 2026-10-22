// ============================================================
// src/controllers/payment.controller.js (new file)
// Part 2: Webhook receiver for Monnify (or active provider).
// Must be mounted with express.raw() BEFORE any express.json()
// body parser, same as your existing Paystack webhook route was —
// signature verification needs the raw, unparsed body.
// ============================================================

import prisma from '../config/database.js';
import * as monnifyService from '../services/monnify.service.js';
import { withIdempotency } from '../validators/idempotency.js';
import { logAudit } from '../services/audit.service.js';
import * as emailService from '../services/email.service.js';

async function handleWebhook(req, res) {
  const signature = req.headers['monnify-signature']; // confirm exact header name in Monnify docs
  const rawBody = req.body; // Buffer, because this route uses express.raw()

  const isValid = monnifyService.verifyWebhookSignature(rawBody, signature);
  if (!isValid) {
    console.warn('[payment.controller] Invalid webhook signature — rejecting');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = JSON.parse(rawBody.toString('utf8'));
  const eventType = event.eventType; // e.g. "SUCCESSFUL_TRANSACTION", "SUCCESSFUL_DISBURSEMENT"
  const providerReference = event.eventData?.transactionReference || event.eventData?.reference;

  // Acknowledge receipt immediately regardless of processing outcome —
  // Monnify (like most gateways) will retry if it doesn't get a 200.
  res.status(200).json({ received: true });

  try {
    await withIdempotency(providerReference, async () => {
      switch (eventType) {
        case 'SUCCESSFUL_TRANSACTION':
          await handleSuccessfulPayment(event.eventData);
          break;
        case 'FAILED_TRANSACTION':
          await handleFailedPayment(event.eventData);
          break;
        case 'SUCCESSFUL_DISBURSEMENT':
          await handleSuccessfulPayout(event.eventData);
          break;
        case 'FAILED_DISBURSEMENT':
          await handleFailedPayout(event.eventData);
          break;
        default:
          console.log(`[payment.controller] Unhandled event type: ${eventType}`);
      }
    });
  } catch (err) {
    console.error('[payment.controller] Error processing webhook:', err);
  }
}

async function handleSuccessfulPayment(eventData) {
  const { paymentReference, transactionReference, amountPaid } = eventData;

  // paymentReference should be the booking or renewal ID you passed
  // in at initializePayment() time — adjust matching logic to however
  // you construct that reference.
  const booking = await prisma.booking.findFirst({
    where: { id: paymentReference },
    include: { user: true, hotel: true },
  });

  if (booking) {
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: booking.id },
        data: { paymentStatus: 'HELD', status: 'CONFIRMED' },
      });
      await tx.transaction.create({
        data: {
          bookingId: booking.id,
          type: 'BOOKING_PAYMENT',
          status: 'SUCCESS',
          provider: 'monnify',
          providerReference: transactionReference,
          amount: amountPaid,
          userId: booking.userId,
          hotelId: booking.hotelId,
          rawResponse: eventData,
        },
      });
    });

    await logAudit({
      actorType: 'system',
      action: 'PAYMENT_HELD',
      entityType: 'Booking',
      entityId: booking.id,
      newValue: { paymentStatus: 'HELD', status: 'CONFIRMED' },
    });

    await emailService.sendBookingPaymentConfirmed(booking.user, booking);
    await emailService.sendHotelBookingPaymentNotice(booking.hotel, booking);
    return;
  }

  // If not a booking, check if it's a renewal payment.
  const renewal = await prisma.bookingRenewal.findFirst({
    where: { id: paymentReference },
    include: { booking: { include: { hotel: true } } },
  });

  if (renewal) {
    await prisma.bookingRenewal.update({
      where: { id: renewal.id },
      data: { paymentStatus: 'HELD', monnifyReference: transactionReference },
    });

    await logAudit({
      actorType: 'system',
      action: 'RENEWAL_PAYMENT_HELD',
      entityType: 'BookingRenewal',
      entityId: renewal.id,
      newValue: { paymentStatus: 'HELD' },
    });

    await emailService.sendRenewalRequestToHotel(renewal.booking.hotel, renewal);
    return;
  }

  console.warn(`[payment.controller] No booking/renewal found for reference ${paymentReference}`);
}

async function handleFailedPayment(eventData) {
  const { paymentReference, transactionReference } = eventData;

  await prisma.booking.updateMany({
    where: { id: paymentReference },
    data: { paymentStatus: 'FAILED' },
  });

  await logAudit({
    actorType: 'system',
    action: 'PAYMENT_FAILED',
    entityType: 'Booking',
    entityId: paymentReference,
  });
}

async function handleSuccessfulPayout(eventData) {
  await logAudit({
    actorType: 'system',
    action: 'PAYOUT_CONFIRMED_BY_WEBHOOK',
    entityType: 'Transaction',
    entityId: eventData.reference,
    newValue: eventData,
  });
}

async function handleFailedPayout(eventData) {
  console.error('[payment.controller] Payout failed:', eventData);
  await logAudit({
    actorType: 'system',
    action: 'PAYOUT_FAILED',
    entityType: 'Transaction',
    entityId: eventData.reference,
    newValue: eventData,
  });
  // TODO: alert admin — this needs manual follow-up with the hotel.
}

export { handleWebhook };
