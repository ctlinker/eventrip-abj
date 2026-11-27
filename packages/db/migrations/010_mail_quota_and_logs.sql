-- Configuration des quotas d'envoi d'emails (Resend) et journal d'envoi
CREATE TABLE "mail_settings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "is_enabled" INTEGER NOT NULL DEFAULT 1,
  "daily_limit" INTEGER NOT NULL DEFAULT 100,
  "monthly_limit" INTEGER NOT NULL DEFAULT 3000,
  "cooldown_minutes" INTEGER NOT NULL DEFAULT 5,
  "updated_by" TEXT REFERENCES "user"("id"),
  "updated_at" TEXT NOT NULL
);

INSERT INTO "mail_settings" ("id", "is_enabled", "daily_limit", "monthly_limit", "cooldown_minutes", "updated_at")
VALUES ('default', 1, 100, 3000, 5, '2026-01-01T00:00:00.000Z');

CREATE TABLE "mail_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "template" TEXT NOT NULL DEFAULT 'transactional',
  "status" TEXT NOT NULL,
  "provider_id" TEXT,
  "error_message" TEXT,
  "created_at" TEXT NOT NULL
);

CREATE INDEX "mail_logs_created_idx" ON "mail_logs" ("created_at");
CREATE INDEX "mail_logs_status_created_idx" ON "mail_logs" ("status", "created_at");
CREATE INDEX "mail_logs_recipient_created_idx" ON "mail_logs" ("recipient", "template", "created_at");
