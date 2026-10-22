import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export const transporter = nodemailer.createTransport({
  host:   env.SMTP_HOST,
  port:   env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth:   { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

async function sendEmail({ to, subject, html }) {
  try {
    await transporter.sendMail({ from: env.EMAIL_FROM, to, subject, html });
  } catch (err) {
    console.error('Email send error:', err.message);
  }
}

// ─────────────────────────────────────────────
// BOOKING CONFIRMATION + QR CODE
// ─────────────────────────────────────────────
export async function sendBookingConfirmation({ booking, hotel, room, qrCodeDataUrl }) {
  const checkIn  = new Date(booking.checkIn).toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const checkOut = new Date(booking.checkOut).toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <div style="background: #1a1a2e; padding: 24px; text-align: center;">
        <h1 style="color: #e94560; margin: 0;">StayLink</h1>
        <p style="color: #aaa; margin: 4px 0 0;">Booking Confirmed ✓</p>
      </div>

      <div style="padding: 32px 24px;">
        <h2 style="color: #1a1a2e;">Your booking is confirmed!</h2>
        <p>Hi ${booking.guestName}, your reservation at <strong>${hotel.name}</strong> has been confirmed.</p>

        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <h3 style="margin-top: 0; color: #1a1a2e;">Booking Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; color: #666;">Booking ID</td><td style="padding: 8px 0; font-weight: bold;">${booking.id}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Hotel</td><td style="padding: 8px 0;">${hotel.name}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Room</td><td style="padding: 8px 0;">${room.name} (${room.type})</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Check-in</td><td style="padding: 8px 0;">${checkIn}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Check-out</td><td style="padding: 8px 0;">${checkOut}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Nights</td><td style="padding: 8px 0;">${booking.nights}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Guests</td><td style="padding: 8px 0;">${booking.guestCount}</td></tr>
            <tr style="border-top: 1px solid #dee2e6;">
              <td style="padding: 12px 0; font-weight: bold;">Total Paid</td>
              <td style="padding: 12px 0; font-weight: bold; color: #e94560;">₦${booking.totalAmount.toLocaleString('en-NG')}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center; margin: 32px 0;">
          <h3>Your Check-in QR Code</h3>
          <p style="color: #666;">Show this at the hotel reception to check in instantly.</p>
          <img src="${qrCodeDataUrl}" alt="Check-in QR Code" style="width: 200px; height: 200px;" />
          <p style="font-size: 14px; color: #666; margin-top: 8px;">Booking ID: <strong>${booking.id}</strong></p>
        </div>

        <div style="background: #fff3cd; border-radius: 8px; padding: 16px; margin-top: 24px;">
          <p style="margin: 0; font-size: 14px;">
            <strong>💡 Important:</strong> Your payment is securely held and will only be released to the hotel when you check in.
            Keep this email for your records.
          </p>
        </div>

        ${hotel.googleMapsUrl ? `
        <div style="margin-top: 24px;">
          <a href="${hotel.googleMapsUrl}" style="display: inline-block; background: #1a1a2e; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
            📍 Get Directions to Hotel
          </a>
        </div>` : ''}
      </div>

      <div style="background: #f8f9fa; padding: 16px 24px; text-align: center; font-size: 12px; color: #666;">
        <p>Need help? Contact us at support@staylink.ng</p>
        <p>© ${new Date().getFullYear()} StayLink. All rights reserved.</p>
      </div>
    </div>
  `;

  await sendEmail({ to: booking.guestEmail, subject: `Booking Confirmed – ${hotel.name} | ${booking.id}`, html });
}

// ─────────────────────────────────────────────
// CHECK-IN RECEIPT (to guest)
// ─────────────────────────────────────────────
export async function sendCheckInReceipt({ booking, hotel, room, staffName }) {
  const checkOutDate = new Date(booking.checkOut).toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <div style="background: #1a1a2e; padding: 24px; text-align: center;">
        <h1 style="color: #e94560; margin: 0;">StayLink</h1>
        <p style="color: #aaa; margin: 4px 0 0;">Check-in Successful ✓</p>
      </div>
      <div style="padding: 32px 24px;">
        <h2>You've checked in successfully!</h2>
        <p>Hi ${booking.guestName}, welcome to <strong>${hotel.name}</strong>.</p>
        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p><strong>Room:</strong> ${room.name}${booking.assignedRoom ? ` — Room ${booking.assignedRoom}` : ''}</p>
          <p><strong>Check-out:</strong> ${checkOutDate}</p>
          <p><strong>Amount Paid:</strong> ₦${booking.totalAmount.toLocaleString('en-NG')}</p>
          ${staffName ? `<p style="color: #666; font-size: 14px;">Checked in by: ${staffName}</p>` : ''}
        </div>
        <p>Enjoy your stay! Contact reception or use the in-app chat if you need anything.</p>
      </div>
      <div style="background: #f8f9fa; padding: 16px 24px; text-align: center; font-size: 12px; color: #666;">
        <p>Need help? Contact us at support@staylink.ng</p>
        <p>© ${new Date().getFullYear()} StayLink. All rights reserved.</p>
      </div>
    </div>
  `;

  await sendEmail({ to: booking.guestEmail, subject: `Welcome to ${hotel.name} – Check-in Confirmed`, html });
}

// ─────────────────────────────────────────────
// CHECKOUT INVOICE (to guest)
// ─────────────────────────────────────────────
export async function sendCheckoutInvoice({ booking, hotel, room, overdueCharges = 0, finalAmount }) {
  const checkInDate  = new Date(booking.checkInTime  ?? booking.checkIn).toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const checkOutDate = new Date(booking.checkOutTime ?? booking.checkOut).toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const totalDue     = finalAmount ?? (booking.totalAmount + overdueCharges);

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <div style="background: #1a1a2e; padding: 24px; text-align: center;">
        <h1 style="color: #e94560; margin: 0;">StayLink</h1>
        <p style="color: #aaa; margin: 4px 0 0;">Checkout Receipt</p>
      </div>
      <div style="padding: 32px 24px;">
        <h2>Thank you for staying with us!</h2>
        <p>Hi ${booking.guestName}, here is your final invoice for your stay at <strong>${hotel.name}</strong>.</p>

        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <h3 style="margin-top: 0; color: #1a1a2e;">Invoice – ${booking.id}</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; color: #666;">Hotel</td><td style="padding: 8px 0;">${hotel.name}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Room</td><td style="padding: 8px 0;">${room?.name ?? 'N/A'}${booking.assignedRoom ? ` (Room ${booking.assignedRoom})` : ''}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Check-in</td><td style="padding: 8px 0;">${checkInDate}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Check-out</td><td style="padding: 8px 0;">${checkOutDate}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Nights booked</td><td style="padding: 8px 0;">${booking.nights}</td></tr>
            <tr style="border-top: 1px solid #dee2e6;">
              <td style="padding: 8px 0; color: #666;">Room charge</td>
              <td style="padding: 8px 0;">₦${booking.totalAmount.toLocaleString('en-NG')}</td>
            </tr>
            ${overdueCharges > 0 ? `
            <tr>
              <td style="padding: 8px 0; color: #c0392b;">Extended stay fee</td>
              <td style="padding: 8px 0; color: #c0392b;">₦${overdueCharges.toLocaleString('en-NG')}</td>
            </tr>` : ''}
            <tr style="border-top: 2px solid #dee2e6;">
              <td style="padding: 12px 0; font-weight: bold;">Total</td>
              <td style="padding: 12px 0; font-weight: bold; color: #e94560;">₦${totalDue.toLocaleString('en-NG')}</td>
            </tr>
          </table>
        </div>

        <p style="color: #666; font-size: 14px;">We hope you enjoyed your stay. Please leave a review to help other travellers.</p>
      </div>
      <div style="background: #f8f9fa; padding: 16px 24px; text-align: center; font-size: 12px; color: #666;">
        <p>Questions? Contact us at support@staylink.ng</p>
        <p>© ${new Date().getFullYear()} StayLink. All rights reserved.</p>
      </div>
    </div>
  `;

  await sendEmail({ to: booking.guestEmail, subject: `Checkout Invoice – ${hotel.name} | ${booking.id}`, html });
}

// ─────────────────────────────────────────────
// SETTLEMENT NOTIFICATION (to hotel)
// Sent when payment is released to the hotel at check-in
// ─────────────────────────────────────────────
export async function sendSettlementNotification({ booking, hotel, room, transferRef }) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <div style="background: #1a1a2e; padding: 24px; text-align: center;">
        <h1 style="color: #e94560; margin: 0;">StayLink</h1>
        <p style="color: #aaa; margin: 4px 0 0;">Payment Released</p>
      </div>
      <div style="padding: 32px 24px;">
        <h2>Payment Disbursed to Your Account</h2>
        <p>A guest has checked in and their payment has been released to <strong>${hotel.name}</strong>.</p>

        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; color: #666;">Booking ID</td><td style="padding: 8px 0; font-weight: bold;">${booking.id}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Guest</td><td style="padding: 8px 0;">${booking.guestName}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Room</td><td style="padding: 8px 0;">${room?.name ?? 'N/A'}${booking.assignedRoom ? ` — Room ${booking.assignedRoom}` : ''}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Check-in</td><td style="padding: 8px 0;">${new Date(booking.checkIn).toLocaleDateString('en-NG')}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Check-out</td><td style="padding: 8px 0;">${new Date(booking.checkOut).toLocaleDateString('en-NG')}</td></tr>
            <tr style="border-top: 1px solid #dee2e6;">
              <td style="padding: 12px 0; font-weight: bold;">Amount Disbursed</td>
              <td style="padding: 12px 0; font-weight: bold; color: #27ae60;">₦${booking.totalAmount.toLocaleString('en-NG')}</td>
            </tr>
            ${transferRef && !transferRef.startsWith('MANUAL') && !transferRef.startsWith('FAILED') ? `
            <tr>
              <td style="padding: 8px 0; color: #666;">Transfer Ref</td>
              <td style="padding: 8px 0; font-family: monospace;">${transferRef}</td>
            </tr>` : `
            <tr>
              <td colspan="2" style="padding: 8px 0; color: #e67e22; font-size: 13px;">
                ⚠️ Transfer will be processed manually. Our team will contact you within 24 hours.
              </td>
            </tr>`}
          </table>
        </div>

        <p style="color: #666; font-size: 14px;">Funds typically reflect in your account within 1–3 business days. Contact support@staylink.ng for any queries.</p>
      </div>
      <div style="background: #f8f9fa; padding: 16px 24px; text-align: center; font-size: 12px; color: #666;">
        <p>© ${new Date().getFullYear()} StayLink. All rights reserved.</p>
      </div>
    </div>
  `;

  await sendEmail({ to: hotel.email, subject: `Payment Released – Booking ${booking.id} | StayLink`, html });
}

// ─────────────────────────────────────────────
// BOOKING CANCELLATION (to guest)
// ─────────────────────────────────────────────
export async function sendCancellationEmail({ booking, hotel, refundAmount }) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <div style="background: #1a1a2e; padding: 24px; text-align: center;">
        <h1 style="color: #e94560; margin: 0;">StayLink</h1>
        <p style="color: #aaa; margin: 4px 0 0;">Booking Cancelled</p>
      </div>
      <div style="padding: 32px 24px;">
        <h2>Booking Cancelled</h2>
        <p>Hi ${booking.guestName}, your booking <strong>${booking.id}</strong> at <strong>${hotel.name}</strong> has been cancelled.</p>
        ${refundAmount ? `<p style="color: #27ae60;"><strong>Refund of ₦${refundAmount.toLocaleString('en-NG')} is being processed</strong> and will reflect in 3–5 business days.</p>` : ''}
        <p>Questions? Contact us at support@staylink.ng</p>
      </div>
      <div style="background: #f8f9fa; padding: 16px 24px; text-align: center; font-size: 12px; color: #666;">
        <p>© ${new Date().getFullYear()} StayLink. All rights reserved.</p>
      </div>
    </div>
  `;

  await sendEmail({ to: booking.guestEmail, subject: `Booking Cancelled – ${booking.id}`, html });
}
