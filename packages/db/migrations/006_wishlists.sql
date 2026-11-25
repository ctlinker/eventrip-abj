-- Liste de souhaits (favoris) par utilisateur et événement
CREATE TABLE "wishlists" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "event_id" TEXT NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "created_at" TEXT NOT NULL,
  UNIQUE("user_id", "event_id")
);

CREATE INDEX "wishlists_user_idx" ON "wishlists" ("user_id");
