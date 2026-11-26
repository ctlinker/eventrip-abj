-- Phase 2: Notifications temps réel (Outbox transactionnelle, Web Push & rappel d'expiration)
ALTER TABLE "orders" ADD COLUMN "expiry_reminder_sent_at" TEXT;

CREATE TABLE "push_subscriptions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "endpoint" TEXT NOT NULL UNIQUE,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "user_agent" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");

CREATE TABLE "notification_outbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "notification_id" TEXT REFERENCES "notifications"("id") ON DELETE CASCADE,
  "event_type" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "push_enabled" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TEXT NOT NULL,
  "last_error" TEXT,
  "dispatched_at" TEXT,
  "created_at" TEXT NOT NULL
);

CREATE INDEX "notification_outbox_pending_idx" ON "notification_outbox" ("status", "next_attempt_at");
CREATE INDEX "notifications_user_created_idx" ON "notifications" ("user_id", "created_at");
