-- Prix unique du billet défini directement sur l'événement
ALTER TABLE "events" ADD COLUMN "price_xof" INTEGER NOT NULL DEFAULT 0;
