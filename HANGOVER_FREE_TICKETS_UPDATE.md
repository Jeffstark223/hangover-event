# HANGOVER — Free Table Ticket Update

Implemented in this version:

- GHS 5,000 Premium table includes 3 free tickets.
- GHS 3,500 Luxury table includes 2 free tickets.
- GHS 2,500 Standard table includes 1 free ticket.
- The purchaser does not enter recipient names.
- Free tickets are generated only after an admin confirms the table's manual Mobile Money payment.
- Every included free ticket receives its own unique `FREE-...` ticket ID.
- Each free ticket has its own PDF and can be checked in independently.
- Free ticket IDs are tied internally to the parent table reservation.
- Public ticket verification supports both normal tickets and free table tickets.
- Admin verification/check-in supports both normal tickets and free table tickets.
- Admin payment confirmation displays the generated free ticket IDs.
- Confirmation email can include the table reservation PDF plus all free-ticket PDFs.

Important:
- Keep your existing `.env` file and copy it into the backend root of this updated project.
- Do not commit `.env` to GitHub.
- The existing SQLite database is intentionally not included in the distributable update ZIP. Keep your current database as a backup.
