# Demo accounts

Five fully-populated demo organizations, one per KORVA OS vertical, seeded by
`apps/api/scripts/seed-demo-accounts.ts` — see that file for how to run it. Every account uses
the same password: **`DemoKorva2026!`**

Each dashboard login is the **owner** of that organization (full access). Each org also has a
second **staff** login (email shown below, same password) so role-based behavior (commission
rate, staff-linked bookings, tips) is visible too.

| Organization | Vertical | Dashboard login (owner) | Staff login | Storefront |
|---|---|---|---|---|
| Salon Éclat | Salon & bien-être | `demo.salon@korva.app` | `sophie.staff@korva.app` | `/salon-eclat` |
| Le Bistrot Marché | Restaurant | `demo.restaurant@korva.app` | `ibrahim.staff@korva.app` | `/le-bistrot-marche` |
| Cabinet Dupont Conseil | Services professionnels | `demo.services@korva.app` | `lucie.staff@korva.app` | `/cabinet-dupont-conseil` |
| Académie Skillup | Formation | `demo.formation@korva.app` | `oumar.staff@korva.app` | `/academie-skillup` |
| Boutique Nova | Commerce & e-commerce | `demo.commerce@korva.app` | — | `/boutique-nova` |

Storefront paths are relative to `NEXT_PUBLIC_STOREFRONT_URL` (`http://localhost:3001` in local
dev).

## Customer-portal logins (storefront `/[slug]/account/login`)

Two organizations also get one seeded customer-portal account, to demo the authenticated
storefront customer experience end-to-end (register/login/profile/order or booking history):

| Organization | Login | 
|---|---|
| Académie Skillup | `sandrine.yapi@example.com` / `DemoKorva2026!` |
| Boutique Nova | `prisca.ble@example.com` / `DemoKorva2026!` |

## What's seeded per organization

- **Salon Éclat**: staff-linked booking room, a completed+attended past appointment, a future
  confirmed appointment, a full slot with a waitlist entry behind it, a 5-session prepaid package
  sold to a client, retail product with stock, 8 CRM contacts.
- **Le Bistrot Marché**: 4 tables, an open tab ("addition ouverte") with a modifier
  ("Supplément fromage"), a closed/paid tab with a tipped payment attributed to staff, a menu
  item pushed to zero stock ("86'd"), 8 CRM contacts.
- **Cabinet Dupont Conseil**: a staff member with a default hourly rate + commission rate, 4 time
  entries (3 approved and invoiced into one client invoice), one billable and one non-billable
  expense, 6 CRM contacts.
- **Académie Skillup**: a 3-seat group training session with 3 attendees (2 completed/attended —
  certificate PDF available — 1 marked absent), a waitlist entry for the now-full session, 8 CRM
  contacts, one customer-portal login.
- **Boutique Nova**: a product with size variants, an active discount code, a real storefront
  order (variant pricing + discount + shipping address, via the same public checkout path the
  storefront and embeddable widget use), a second order that depletes the last unit of a
  low-stock item (triggers the Decision Engine's low-stock recommendation once `apps/worker`
  processes the event), 8 CRM contacts, one customer-portal login.

## Notes

- The script is **idempotent by skipping**: re-running it leaves any already-existing demo
  organization untouched rather than trying to reconcile every sub-record. To reseed one from
  scratch, delete that organization's data first (there is no built-in `--reset`/cascade-delete
  — this is a demo seed script, not a production migration tool).
- Async side effects (Decision Engine recommendations, booking reminders, webhook deliveries) are
  queued through the real EventBus/BullMQ and only materialize once `apps/worker` is running
  alongside `apps/api` — every synchronous record this script writes (contacts, offers, bookings,
  orders, invoices) is visible immediately either way.
- All 5 organizations use currency `XOF` and country `CI` (Côte d'Ivoire) for a locally coherent
  demo — nothing about KORVA OS itself is region-specific.
