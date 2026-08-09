# HANGOVER — Backend

Production backend for the HANGOVER event website: ticketing, table
reservations, Hubtel payments, PDF tickets, confirmation emails, and
the admin console.

**Stack:** Node.js + Express + SQLite (`better-sqlite3`). No Mongo/Firebase/Supabase/MySQL/Postgres.

## 1. Install

```bash
npm install
```

Requires Node.js 18+ (uses the built-in `fetch`).

## 2. Configure

```bash
cp .env.example .env
```

Fill in `.env`:
- `JWT_SECRET` — generate with `openssl rand -hex 64`
- `HUBTEL_CLIENT_ID` / `HUBTEL_CLIENT_SECRET` / `HUBTEL_MERCHANT_ACCOUNT_NUMBER` — from your Hubtel merchant dashboard
- `SMTP_*` — your email provider's credentials
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — used once by `npm run create-admin`

## 3. Initialize the database + first admin user

```bash
npm run seed-tables     # creates the table inventory (Premium/Luxury/Standard)
npm run create-admin    # creates the first admin login from .env
```

Both are idempotent — safe to re-run. The SQLite file is created automatically at the path in `DATABASE_PATH` (default `./database/hangover.db`).

## 4. Run

```bash
npm start        # production
npm run dev       # auto-restart on file changes (Node's --watch)
```

The server serves the existing frontend from `/public` (`index.html`,
`admin.html`) and the API under `/api`. Visit `http://localhost:4000`.

## 5. Finish the Hubtel integration

Payment initiation and verification are isolated in
`services/hubtelService.js` with clearly marked placeholders:

- `initiateCheckout()` — confirm the exact Hubtel Online Checkout endpoint/payload for your merchant account against their docs, then update `HUBTEL_CHECKOUT_URL` and the request/response field names.
- `verifyTransaction()` — **must** be wired to Hubtel's transaction status-check endpoint before going live. Right now it deliberately returns `verified: false` so a spoofed callback can never grant a free ticket; nothing else in the code needs to change once this function calls the real API.

Point your Hubtel merchant dashboard's callback URL at:
`POST https://your-domain.com/api/payments/hubtel/callback`

## 6. What's implemented

- **Bookings**: `POST /api/bookings` validates input, atomically claims a table (if any), generates secure Booking/Reservation/Ticket IDs, stores everything in SQLite, and starts a Hubtel checkout.
- **Payment confirmation**: Hubtel's callback (`/api/payments/hubtel/callback`) re-verifies the transaction, marks the booking Paid, generates the PDF ticket, and emails the guest.
- **Tables**: `GET /api/tables` (public) lists only available tables per package. Reservation is atomic — two guests can never win the same table.
- **Admin**: JWT-based login (`/api/admin/auth/login`), dashboard stats, booking search/list, ticket verification + check-in, live table floor plan, and on-demand `.xlsx` guest list export (`ExcelJS`, generated fresh from SQLite every time — never used as a database).
- **Security**: helmet, CORS allow-list, rate limiting (general API, login, booking creation), bcrypt-hashed admin passwords, parameterized queries throughout, unique-ID collision retries, table-claim race protection.

## 7. Project structure

```
backend/
  config/        env + venue table configuration
  controllers/   request handlers
  database/      SQLite connection + schema
  middleware/    auth, error handling, rate limiting
  models/        SQLite data access (Booking, Table, Admin)
  routes/        Express routers
  services/      Hubtel, PDF, email, Excel export
  tickets/       generated PDF tickets (gitignored)
  exports/       generated guest-list .xlsx files (gitignored)
  utils/         ID generation, logger, error class
  public/        the existing index.html + admin.html (served statically)
  app.js         Express app
  server.js      entrypoint
```

## 8. Frontend changes

Per your instructions, the visual design was left untouched. The only
additions were the minimum needed to connect to the backend:

- **index.html** — the ticket/table "Buy"/"Reserve" buttons (which pointed to `#`) now open a booking modal that collects guest details and posts to `POST /api/bookings`. Styling reuses your existing CSS variables.
- **admin.html** — the login form, dashboard stats, bookings table, ticket verification, check-in, table floor plan, and export button are now wired to the real API instead of static/mock data. No markup was redesigned — only the `<script>` logic was replaced.
