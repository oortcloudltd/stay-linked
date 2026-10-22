/**
 * src/utils/mailer.js
 * Nodemailer transporter — Brevo SMTP
 * All outgoing emails go through sendMail()
 */

import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

const transporter = nodemailer.createTransport({
  host:   env.SMTP_HOST,
  port:   env.SMTP_PORT,
  secure: false, // STARTTLS on port 587
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
});

/**
 * Send an email.
 * @param {{ to: string, subject: string, html: string }} options
 */
export async function sendMail({ to, subject, html }) {
  const info = await transporter.sendMail({
    from:    env.EMAIL_FROM,
    to,
    subject,
    html,
  });

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Mailer] Sent "${subject}" to ${to} — ID: ${info.messageId}`);
  }

  return info;
}

// ─── Email templates ──────────────────────────────────────────────────────────

function baseTemplate(content) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:40px 0;">
        <tr>
          <td align="center">
            <table width="480" cellpadding="0" cellspacing="0" style="background:#0e0e0e;border:1px solid #232323;border-radius:16px;overflow:hidden;">
              <!-- Header -->
              <tr>
                <td style="padding:28px 32px;border-bottom:1px solid #1a1a1a;">
                  <span style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#fff;">
                    Stay<span style="color:#E53935;">Link</span>
                  </span>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:32px;">
                  ${content}
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="padding:20px 32px;border-top:1px solid #1a1a1a;text-align:center;">
                  <p style="margin:0;font-size:11px;color:#444;">
                    © 2026 StayLink · Nigeria's smartest hotel booking platform
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

export function codeEmailHtml({ name, code, action, expiresMinutes = 15 }) {
  return baseTemplate(`
    <p style="margin:0 0 8px;font-size:15px;color:#9CA3AF;">Hello, ${name}</p>
    <h2 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#fff;">${action}</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#9CA3AF;line-height:1.6;">
      Use the code below to complete your request. It expires in ${expiresMinutes} minutes.
    </p>
    <div style="background:#161616;border:1px solid #2a2a2a;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
      <span style="font-size:36px;font-weight:700;color:#E53935;letter-spacing:0.2em;">${code}</span>
    </div>
    <p style="margin:0;font-size:12px;color:#555;">
      If you didn't request this, you can safely ignore this email.
      Never share this code with anyone.
    </p>
  `);
}

export function welcomeEmailHtml({ name }) {
  return baseTemplate(`
    <h2 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#fff;">Welcome to StayLink, ${name} 🎉</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#9CA3AF;line-height:1.6;">
      Your account has been created. You can now book hotels across Nigeria with instant QR check-in.
    </p>
    <a href="${env.FRONTEND_URL}/explore"
       style="display:inline-block;background:#E53935;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">
      Explore Hotels →
    </a>
  `);
}
