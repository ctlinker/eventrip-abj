-- Extension de la table user (Better Auth)
ALTER TABLE "user" ADD COLUMN "phone" TEXT;
ALTER TABLE "user" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'client';
ALTER TABLE "user" ADD COLUMN "permissions" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "user" ADD COLUMN "is_active" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "user_phone_idx" ON "user" ("phone") WHERE "phone" IS NOT NULL;

-- Événements
CREATE TABLE "events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slug" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "poster_key" TEXT,
  "starts_at" TEXT NOT NULL,
  "ends_at" TEXT,
  "venue" TEXT NOT NULL,
  "extra_info" TEXT,
  "wave_payment_url" TEXT,
  "sales_start_at" TEXT,
  "sales_end_at" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "created_by" TEXT NOT NULL REFERENCES "user"("id"),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE INDEX "events_status_starts_idx" ON "events" ("status", "starts_at");

-- Catégories de tickets
CREATE TABLE "ticket_categories" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "event_id" TEXT NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "price_xof" INTEGER NOT NULL,
  "capacity" INTEGER NOT NULL,
  "reserved_count" INTEGER NOT NULL DEFAULT 0,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE INDEX "ticket_categories_event_idx" ON "ticket_categories" ("event_id", "sort_order");

-- Convois de transport
CREATE TABLE "convoys" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "event_id" TEXT NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "departure_at" TEXT NOT NULL,
  "meeting_point" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "trip_type" TEXT NOT NULL,
  "price_xof" INTEGER NOT NULL,
  "capacity" INTEGER NOT NULL,
  "reserved_count" INTEGER NOT NULL DEFAULT 0,
  "extra_info" TEXT,
  "status" TEXT NOT NULL DEFAULT 'published',
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE INDEX "convoys_event_idx" ON "convoys" ("event_id");

-- Commandes (supporte commandes mixtes tickets + convois)
CREATE TABLE "orders" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "reference" TEXT NOT NULL UNIQUE,
  "user_id" TEXT NOT NULL REFERENCES "user"("id"),
  "total_amount_xof" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_payment',
  "expires_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE INDEX "orders_user_idx" ON "orders" ("user_id");
CREATE INDEX "orders_status_expires_idx" ON "orders" ("status", "expires_at");

-- Lignes de commande
CREATE TABLE "order_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "order_id" TEXT NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "item_type" TEXT NOT NULL,
  "ticket_category_id" TEXT REFERENCES "ticket_categories"("id"),
  "convoy_id" TEXT REFERENCES "convoys"("id"),
  "quantity" INTEGER NOT NULL,
  "unit_price_xof" INTEGER NOT NULL,
  "subtotal_xof" INTEGER NOT NULL
);

CREATE INDEX "order_items_order_idx" ON "order_items" ("order_id");

-- Tickets générés dès la création de la commande
CREATE TABLE "tickets" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "qr_token" TEXT NOT NULL UNIQUE,
  "order_id" TEXT NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "order_item_id" TEXT NOT NULL REFERENCES "order_items"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "user"("id"),
  "event_id" TEXT NOT NULL REFERENCES "events"("id"),
  "item_type" TEXT NOT NULL,
  "ticket_category_id" TEXT REFERENCES "ticket_categories"("id"),
  "convoy_id" TEXT REFERENCES "convoys"("id"),
  "status" TEXT NOT NULL DEFAULT 'pending',
  "used_at" TEXT,
  "scanned_by" TEXT REFERENCES "user"("id"),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE INDEX "tickets_order_idx" ON "tickets" ("order_id");
CREATE INDEX "tickets_user_idx" ON "tickets" ("user_id");

-- Paiements Wave et vérification manuelle
CREATE TABLE "payments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "order_id" TEXT NOT NULL UNIQUE REFERENCES "orders"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "user"("id"),
  "expected_amount_xof" INTEGER NOT NULL,
  "payer_phone" TEXT,
  "proof_image_key" TEXT,
  "wave_transaction_ref" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reviewed_by" TEXT REFERENCES "user"("id"),
  "reviewed_at" TEXT,
  "rejection_reason" TEXT,
  "submitted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE UNIQUE INDEX "payments_unique_confirmed_wave_ref"
  ON "payments" ("wave_transaction_ref")
  WHERE "status" = 'confirmed' AND "wave_transaction_ref" IS NOT NULL;

CREATE INDEX "payments_status_idx" ON "payments" ("status");

-- Journal d'audit des opérations sensibles
CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actor_id" TEXT REFERENCES "user"("id"),
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "old_state" TEXT,
  "new_state" TEXT,
  "metadata" TEXT,
  "created_at" TEXT NOT NULL
);

CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" ("entity_type", "entity_id");
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" ("created_at");

-- Notifications in-app
CREATE TABLE "notifications" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "link" TEXT,
  "is_read" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL
);

CREATE INDEX "notifications_user_read_idx" ON "notifications" ("user_id", "is_read");
