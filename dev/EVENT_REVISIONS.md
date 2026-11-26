# EVENTRIP — Event Revisions & Price Immutability

**Status:** Approved & Implementing  
**Scope:** Event management, convoy management, ticketing, notifications, and administrative operations.

## 1. Objective

Introduce a revision-based system for managing modifications to published events and convoys while preserving the integrity of tickets already purchased.

The system guarantees two principles:

1. **Historical integrity:** Information associated with a purchase is never silently rewritten.
2. **Financial integrity:** A ticket's purchase amount remains immutable after a purchase is initiated or completed.

Administrators retain the ability to correct and update operational information without compromising existing tickets.

---

## 2. Revision Management

### 2.1 General principle

Every significant modification to an event or convoy creates a new immutable revision.

- Creating an event or convoy automatically creates its initial revision (`v1`).
- Existing revisions are never overwritten or deleted through normal administrative operations.
- Both `events` and `convoys` track `revision_number` and `current_revision_id` for fast lookup.

### 2.2 Revision structure

Each revision in `event_revisions` / `convoy_revisions` stores:

- Unique revision identifier (`id`).
- Parent entity identifier (`event_id` or `convoy_id`).
- Sequential version number (`version_number`).
- JSON snapshot of the entity's relevant information (`snapshot_json`).
- Modification severity (`minor` | `important` | `critical`).
- Description / reason of the modification (`change_summary`).
- Previous and new values for modified fields (`changes_json`).
- Administrator responsible for the change (`changed_by`).
- Creation timestamp (`created_at`).

### 2.3 Modification severity

| Severity | Automatic triggers (minimum floor) | Notification |
|---|---|---|
| `minor` | Title, description, extra info, category, Wave URL | Optional (none by default) |
| `important` | Venue, convoy departure time, pickup location, commune | Push + in-app |
| `critical` | Event date (`starts_at`), event/convoy cancellation (`status = 'archived'`/`'cancelled'`) | Immediate Push + in-app |

Server-side logic enforces the minimum severity based on modified fields. Administrators may escalate severity (e.g. `minor` → `important`) but cannot downgrade an `important` or `critical` modification.

### 2.4 Ticket revision association

At purchase (`POST /api/orders`), each ticket records:

- `event_revision_id`: current event revision ID at purchase time.
- `convoy_revision_id`: current convoy revision ID at purchase time (if applicable).
- `purchase_snapshot`: immutable JSON snapshot containing at minimum:
  - `event_id`, `event_title`, `event_starts_at`, `event_venue`, `event_version`
  - `convoy_id`, `convoy_name`, `convoy_commune`, `convoy_departure_at`, `convoy_meeting_point`, `convoy_version`
  - `unit_price_xof`, `purchased_at`

These fields are never mutated by subsequent revisions.

### 2.5 Display behaviour

When a customer opens `/tickets`:

- Original purchase information (`purchase_snapshot`) remains accessible via an expandable details block.
- Current operational information is shown prominently when it differs from the original snapshot, with inline visual comparison (e.g. ~~`14:00`~~ **`16:00`**) and an update badge (`Mis à jour v2`).
- Downloadable ticket image / PDF displays the current operational details + update notice + immutable purchase price.
- The ticket remains valid and its `qr_token` is unchanged.

---

## 3. Customer Notifications

Customers holding affected tickets (`tickets.status IN ('valid', 'pending')` on non-expired/non-cancelled orders) are notified when `important` or `critical` revisions occur:

- Deduplicated per user (1 notification per user even if holding multiple tickets for the same event/convoy).
- Delivered via the existing D1 `notification_outbox` + WebSocket (`UserRealtimeHub`) + Web Push Queue (`PUSH_QUEUE`).
- Notification dispatch happens asynchronously via `ctx.waitUntil(flushNotificationOutbox(...))` so delivery failures never roll back a committed revision.

---

## 4. Price Immutability & Clone & Archive

### 4.1 Price lock rule

The price of an event (`events.price_xof`) is locked as soon as at least one active or confirmed order exists for that event (`orders.status IN ('pending_payment', 'under_review', 'confirmed')`).

- Before any active/confirmed order (or if all previous orders expired/were cancelled/rejected), administrators may edit `price_xof` directly.
- Once locked, direct modification of `price_xof` is rejected (`409 Conflict`) regardless of admin permission level.

### 4.2 Clone & Archive (`POST /api/admin/events/:id/clone-archive`)

To change pricing after sales have started:

1. Archives the original event (`status = 'archived'`), preserving all existing orders, tickets, payments, and convoy reservations.
2. Creates a new independent event (`v1`) with a new `id`, new `slug`, and the administrator's new `price_xof` (plus optional title/status).
3. Clones convoys cleanly (`reserved_count = 0`, `v1`) with capacities pre-filled by default in the UI to `max(0, capacity - reserved_count)` (editable by the admin) to prevent accidentally overselling the same physical bus.
4. Never duplicates orders, tickets, payments, or reservations.

### 4.3 Capacity constraint

Convoy capacity remains editable subject to `new_capacity >= reserved_count`.

---

## 5. Ticket Validity

A revision never invalidates an existing ticket or alters its `qr_token`. Ticket status (`pending`, `valid`, `used`, `cancelled`, `expired`) remains independent.

---

## 6. Database Schema (`009_event_convoy_revisions.sql`)

- New table `event_revisions`
- New table `convoy_revisions`
- `events`: `revision_number INTEGER NOT NULL DEFAULT 1`, `current_revision_id TEXT`
- `convoys`: `revision_number INTEGER NOT NULL DEFAULT 1`, `current_revision_id TEXT`
- `tickets`: `event_revision_id TEXT`, `convoy_revision_id TEXT`, `purchase_snapshot TEXT`
- Backfill `v1` revisions for existing events/convoys and `purchase_snapshot` for existing tickets.
- All administrative updates are written atomically via `DB.batch()` along with `audit_logs`.
