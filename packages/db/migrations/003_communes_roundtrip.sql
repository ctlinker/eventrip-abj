-- Commune du client et des départs (convois) + double scan Aller/Retour
ALTER TABLE "user" ADD COLUMN "commune" TEXT;
ALTER TABLE "convoys" ADD COLUMN "commune" TEXT NOT NULL DEFAULT '';

ALTER TABLE "tickets" ADD COLUMN "outbound_used_at" TEXT;
ALTER TABLE "tickets" ADD COLUMN "outbound_scanned_by" TEXT;
ALTER TABLE "tickets" ADD COLUMN "return_used_at" TEXT;
ALTER TABLE "tickets" ADD COLUMN "return_scanned_by" TEXT;
