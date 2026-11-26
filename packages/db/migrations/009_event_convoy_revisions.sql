-- Système de révisions immuables pour événements & convois + snapshot d'achat sur les billets
CREATE TABLE "event_revisions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "event_id" TEXT NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "version_number" INTEGER NOT NULL,
  "snapshot_json" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'minor',
  "change_summary" TEXT,
  "changes_json" TEXT,
  "changed_by" TEXT REFERENCES "user"("id"),
  "created_at" TEXT NOT NULL,
  UNIQUE("event_id", "version_number")
);

CREATE INDEX "event_revisions_event_idx" ON "event_revisions" ("event_id", "version_number");

CREATE TABLE "convoy_revisions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "convoy_id" TEXT NOT NULL REFERENCES "convoys"("id") ON DELETE CASCADE,
  "version_number" INTEGER NOT NULL,
  "snapshot_json" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'minor',
  "change_summary" TEXT,
  "changes_json" TEXT,
  "changed_by" TEXT REFERENCES "user"("id"),
  "created_at" TEXT NOT NULL,
  UNIQUE("convoy_id", "version_number")
);

CREATE INDEX "convoy_revisions_convoy_idx" ON "convoy_revisions" ("convoy_id", "version_number");

ALTER TABLE "events" ADD COLUMN "revision_number" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "events" ADD COLUMN "current_revision_id" TEXT;

ALTER TABLE "convoys" ADD COLUMN "revision_number" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "convoys" ADD COLUMN "current_revision_id" TEXT;

ALTER TABLE "tickets" ADD COLUMN "event_revision_id" TEXT REFERENCES "event_revisions"("id");
ALTER TABLE "tickets" ADD COLUMN "convoy_revision_id" TEXT REFERENCES "convoy_revisions"("id");
ALTER TABLE "tickets" ADD COLUMN "purchase_snapshot" TEXT;

-- Backfill v1 pour les événements existants
INSERT INTO "event_revisions" ("id", "event_id", "version_number", "snapshot_json", "severity", "change_summary", "changes_json", "changed_by", "created_at")
SELECT
  'evrev-' || "id" || '-v1',
  "id",
  1,
  json_object(
    'title', "title",
    'description', "description",
    'starts_at', "starts_at",
    'ends_at', "ends_at",
    'venue', "venue",
    'price_xof', "price_xof",
    'category_id', "category_id",
    'extra_info', "extra_info",
    'wave_payment_url', "wave_payment_url",
    'status', "status"
  ),
  'minor',
  'Version initiale',
  NULL,
  "created_by",
  "created_at"
FROM "events";

UPDATE "events"
SET "current_revision_id" = 'evrev-' || "id" || '-v1', "revision_number" = 1;

-- Backfill v1 pour les convois existants
INSERT INTO "convoy_revisions" ("id", "convoy_id", "version_number", "snapshot_json", "severity", "change_summary", "changes_json", "changed_by", "created_at")
SELECT
  'cvrev-' || "id" || '-v1',
  "id",
  1,
  json_object(
    'name', "name",
    'commune', "commune",
    'departure_at', "departure_at",
    'meeting_point', "meeting_point",
    'destination', "destination",
    'trip_type', "trip_type",
    'price_xof', "price_xof",
    'capacity', "capacity",
    'extra_info', "extra_info",
    'status', "status"
  ),
  'minor',
  'Version initiale',
  NULL,
  NULL,
  "created_at"
FROM "convoys";

UPDATE "convoys"
SET "current_revision_id" = 'cvrev-' || "id" || '-v1', "revision_number" = 1;

-- Backfill des références de révision et purchase_snapshot sur les billets existants
UPDATE "tickets"
SET
  "event_revision_id" = 'evrev-' || "event_id" || '-v1',
  "convoy_revision_id" = CASE WHEN "convoy_id" IS NOT NULL THEN 'cvrev-' || "convoy_id" || '-v1' ELSE NULL END,
  "purchase_snapshot" = (
    SELECT json_object(
      'event_id', e."id",
      'event_title', e."title",
      'event_starts_at', e."starts_at",
      'event_venue', e."venue",
      'event_version', 1,
      'convoy_id', cv."id",
      'convoy_name', cv."name",
      'convoy_commune', cv."commune",
      'convoy_departure_at', cv."departure_at",
      'convoy_meeting_point', cv."meeting_point",
      'convoy_version', CASE WHEN cv."id" IS NOT NULL THEN 1 ELSE NULL END,
      'unit_price_xof', COALESCE(oi."unit_price_xof", e."price_xof"),
      'purchased_at', "tickets"."created_at"
    )
    FROM "events" e
    LEFT JOIN "convoys" cv ON cv."id" = "tickets"."convoy_id"
    LEFT JOIN "order_items" oi ON oi."id" = "tickets"."order_item_id"
    WHERE e."id" = "tickets"."event_id"
  );
