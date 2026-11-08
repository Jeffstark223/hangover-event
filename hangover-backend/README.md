# HANGOVER — Backend

Production backend for the HANGOVER event website: ticketing
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

- **Bookings**: `POST /api/bookings` validates input, generates secure Booking/Reservation/Ticket IDs, stores everything in SQLite, and starts a Hubtel checkout.
- **Payment confirmation**: Hubtel's callback (`/api/payments/hubtel/callback`) re-verifies the transaction, marks the booking Paid, generates the PDF ticket, and emails the guest.
- **Admin**: JWT-based login (`/api/admin/auth/login`), dashboard stats, booking search/list, ticket verification + check-in, and on-demand `.xlsx` guest list export (`ExcelJS`, generated fresh from SQLite every time — never used as a database).
- **Security**: helmet, CORS allow-list, rate limiting (general API, login, booking creation), bcrypt-hashed admin passwords, parameterized queries throughout, unique-ID collision retries.

## 7. Project structure

```
backend/
  config/        env, ticket prices, payment account, event location
  controllers/   request handlers
  database/      SQLite connection + schema
  middleware/    auth, error handling, rate limiting
  models/        SQLite data access (Booking, AttendeeTicket, Admin)
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

- **index.html** — the ticket "Buy" buttons (which pointed to `#`) now open a booking modal that collects guest details and posts to `POST /api/bookings`. Styling reuses your existing CSS variables.
- **admin.html** — the login form, dashboard stats, bookings table, ticket verification, check-in, and export button are now wired to the real API instead of static/mock data. No markup was redesigned — only the `<script>` logic was replaced.


## 9. Ticket pricing (updated)

All ticket prices live in **one file**: `config/tickets.config.js`.

| Category | Price |
|---|---|
| Group of 6 | GHS 300 total (six people) |
| Guys | GHS 80 per person |
| Girls | GHS 65 per person |
| Late Bird (Gate – Everybody) | GHS 100 per person |

- Regular, VIP and VVIP tickets and table reservations have been removed completely.
- The browser only sends a category key and a quantity. The backend calculates the amount
  (`services/pricingService.js`), stores a price snapshot on the booking (`price_unit`, `unit_price`),
  and re-validates it when an admin confirms payment. Prices or amounts sent by a browser are ignored.
- A **Group of 6** is exactly one booking for six people: one payment, **six separate tickets**.
  Every paid booking issues one ticket per person (table `attendee_tickets`), each with its own
  unique `TCK-…` ID and PDF, verified and checked in independently (`POST /api/admin/checkin`).
- Payment is manual Mobile Money: the customer submits a reference, an administrator confirms it,
  and only then are tickets generated. The ticket payment account is in `config/payment.config.js`.

## 10. Event location (updated)

The venue is defined in **one file**: `config/event-location.json`.

- `confirmed: true` shows the venue everywhere (homepage hero, Event Location section, map,
  Get Directions, footer, PDF tickets, confirmation emails).
- `confirmed: false` shows *"Venue details coming soon."* everywhere and hides the map and directions.
- Changes apply immediately, no restart or redeploy of the website pages needed.
- `venueName` + `address` are the written venue; `mapQuery` is what the map pin and Get Directions search for
  (currently the landmark, Beirut Cafe, while the written venue says "behind Beirut Cafe"); `mapNote` explains the pin.
- `directionsUrl` / `embedUrl` are optional https overrides (e.g. a pinned Google Maps share link
  once the exact spot exists). No GPS coordinates are used or invented.
- Public endpoints: `GET /api/event/location`, `GET /api/tickets`.

## 11. Tests

```bash
npm test
```
Runs `tests/pricing-and-location.test.js` against a throw-away database (nothing real is touched).
