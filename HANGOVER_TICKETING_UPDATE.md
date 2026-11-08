# HANGOVER — Ticketing System Update

## Summary
- **Ticket categories:** only Group of 6 (GHS 300 total), Guys (GHS 80), Girls (GHS 65), Late Bird (GHS 100).
  Regular, VIP and VVIP are removed; the API rejects them. Prices live only in `hangover-backend/config/tickets.config.js`.
- **Server-side pricing:** the browser sends category + quantity only. The backend calculates the amount, stores a price
  snapshot, and re-validates it when the admin confirms payment.
- **Tickets:** a paid Group of 6 produces six tickets, each with its own unique ID and PDF; per-person bookings produce one
  ticket per person. Tickets are linked to the booking (`attendee_tickets.booking_id`), verified and checked in individually
  with the existing admin verify/check-in. They are created only after the administrator confirms payment.
- **Tables removed:** packages, forms, prices, free tickets, table payment account, API routes, admin floor plan, dashboard
  stat, Excel columns, seed script. Homepage section, nav/footer/hero links removed.
- **Location:** `hangover-backend/config/event-location.json` is the single source. Written venue:
  "Adjirigano, behind Beirut Cafe, Accra, Ghana". Map pin and Get Directions search for "Beirut Cafe, Adjirigano, Accra, Ghana"
  (the landmark itself). A note beside the map explains this. `"confirmed": false` shows "Venue details coming soon."
- **Payment:** unchanged manual Mobile Money flow (reference submission -> admin confirmation). No payment provider added.
- **No QR codes** were added; none exist.

## Files modified / added / removed (relative to the previous delivery)
Added: `config/payment.config.js`, `config/tickets.config.js`, `config/event-location.json`, `services/{pricing,location,attendee}Service.js`,
`services/bookingPresenter.js`, `models/AttendeeTicket.js`, `controllers/publicInfoController.js`, `routes/publicInfoRoutes.js`,
`tests/pricing-and-location.test.js`.
Removed: `config/tables.config.js`, `controllers/tableController.js`, `routes/tableRoutes.js`, `models/Table.js`,
`models/FreeTicket.js`, `scripts/seedTables.js`, `HANGOVER_FREE_TICKETS_UPDATE.md`.
Modified: `app.js`, `server.js`, `package.json`, `.env.example`, `README.md`, `config/env.js`, `database/db.js`, `models/Booking.js`,
`controllers/{booking,admin,payment}Controller.js`, `routes/{booking,admin}Routes.js`, `services/{pdf,email,excel}Service.js`,
`utils/idGenerator.js`, `public/{index,admin,payment-success,retrieve-ticket}.html`.

## Database changes (SQLite, same database)
- New table `attendee_tickets` (one row per person; `ticket_id` UNIQUE; linked to `bookings.booking_id`).
- `bookings` gets two nullable columns: `price_unit` (`group`/`person`) and `unit_price`. Added automatically on boot.
- New databases no longer create `tables_inventory`, `free_tickets` or the table columns on `bookings`.
- **Existing databases keep** those legacy tables/columns untouched (nothing is dropped, so no history is lost); the app no
  longer reads or writes them. Drop them manually only after you have backed up and confirmed you do not need them.
- Old bookings keep their stored data. Old **paid** single tickets can still be verified and checked in. Old **pending**
  bookings (Regular/VIP/VVIP/table) can no longer be confirmed; the admin sees a clear message.

## Testing
```bash
cd hangover-backend && npm install && npm test
```
Runs 23 automated checks against a throw-away database (pricing, six-ticket issuance, manual payment, tickets-only-after-
approval, tables removed, no old prices, map pin vs written venue, no QR code, upgrade of an old database).
Manual check: run `npm start`, open `/`, book each category, then log in at `/admin.html`, confirm the payment, and use
"View tickets", Verify and Mark Checked In.

## Deployment
1. Back up `database/hangover.db` and your `.env`.
2. Copy the files over the project (keep your own `.env`, `database/`, `tickets/`, `uploads/`).
3. `npm install` (no new dependencies) and restart. The database migrates itself on boot.
4. Edit `config/event-location.json` when the venue or map landmark changes; no restart needed.
