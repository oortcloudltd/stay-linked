# ─────────────────────────────────────────────
# SERVER
# ─────────────────────────────────────────────
NODE_ENV=development
PORT=5000

# ─────────────────────────────────────────────
# DATABASE (PostgreSQL via Prisma)
# ─────────────────────────────────────────────
DATABASE_URL="postgresql://username:password@localhost:5432/staylink_db?schema=public"

# ─────────────────────────────────────────────
# JWT SECRETS
# ─────────────────────────────────────────────
JWT_ACCESS_SECRET=your_super_secret_access_key_min_32_chars
JWT_REFRESH_SECRET=your_super_secret_refresh_key_min_32_chars
JWT_ACCESS_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# ─────────────────────────────────────────────
# FRONTEND
# ─────────────────────────────────────────────
FRONTEND_URL=http://localhost:5173

# ─────────────────────────────────────────────
# CLOUDINARY (Image Uploads)
# ─────────────────────────────────────────────
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret

# ─────────────────────────────────────────────
# PAYSTACK (Payments)
# ─────────────────────────────────────────────
PAYSTACK_SECRET_KEY=sk_test_your_paystack_secret_key
PAYSTACK_PUBLIC_KEY=pk_test_your_paystack_public_key

# ─────────────────────────────────────────────
# EMAIL (SMTP)
# ─────────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
EMAIL_FROM=StayLink <noreply@staylink.ng>

# ─────────────────────────────────────────────
# SUPER ADMIN (optional manual bootstrap; not run automatically)
# ─────────────────────────────────────────────
ADMIN_EMAIL=
ADMIN_PASSWORD=
