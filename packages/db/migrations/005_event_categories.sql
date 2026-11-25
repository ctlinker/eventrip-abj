-- Catégories d'événements extensibles (Concert live, Séminaire, etc.)
CREATE TABLE "event_categories" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "slug" TEXT NOT NULL UNIQUE,
  "created_at" TEXT NOT NULL
);

INSERT INTO "event_categories" ("id", "name", "slug", "created_at") VALUES
  ('cat-concert-live', 'Concert live', 'concert-live', '2026-11-25T00:00:00.000Z'),
  ('cat-seminaire', 'Séminaire', 'seminaire', '2026-11-25T00:00:00.000Z'),
  ('cat-festival', 'Festival', 'festival', '2026-11-25T00:00:00.000Z'),
  ('cat-excursion', 'Excursion', 'excursion', '2026-11-25T00:00:00.000Z'),
  ('cat-soiree', 'Soirée', 'soiree', '2026-11-25T00:00:00.000Z');

ALTER TABLE "events" ADD COLUMN "category_id" TEXT REFERENCES "event_categories"("id");
CREATE INDEX "events_category_idx" ON "events" ("category_id");
