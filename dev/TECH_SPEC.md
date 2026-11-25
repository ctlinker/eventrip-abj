# EVENTRIP-ABJ — Spécification Technique & Architecture (Draft v1)

> Document de cadrage technique basé sur [SPEC.md](./SPEC.md) et adapté à la stack du monorepo (`Bun` + `Cloudflare Workers` + `D1` + `R2` + `Hono` + `Better Auth` + `Kysely` + `Astro` / `Preact`).

---

## 1. Décisions de cadrage retenues

| Sujet | Décision | Impact technique |
|---|---|---|
| **Réservation de capacité** | Dès la création de la commande, avec **expiration par défaut à 2h** | Décrément/incrément atomique à la commande ; Cron Trigger + garde-fou à la lecture pour libérer les places expirées. |
| **Identité & Téléphone** | Numéro de téléphone requis/supporté côté client (contexte CI / Wave) | Ajout du champ `phone` sur `user` (et possibilité d'activer le plugin `phoneNumber` de Better Auth ultérieurement). |
| **Commandes mixtes** | Une même commande peut combiner **tickets d'événement + places de convoi** | Modèle `orders` + `order_items` polymorphique (`item_type`: `ticket_category` \| `convoy`). |
| **QR Codes** | **Token unique opaque** vérifié en base | Colonne `qr_token` unique indexée (ex. UUID/nanoid 32 car.), zéro logique métier exposée dans le QR, révocable instantanément. |
| **Permissions admin** | À affiner avec le collaborateur | Socle simple `role` (`client`, `admin`, `super_admin`) + tableau `permissions` extensible (avec `payments:verify` isolé dès le départ comme exigé par la spec). |

### Points ouverts à confirmer
1. **Convois (cars)** : périmètre exact V1 (inclus dès le lancement ou activable par flag/phase 2). Le schéma ci-dessous le supporte nativement sans bloquer la billetterie.
2. **Délai d'expiration après envoi du justificatif** : une commande passée en `under_review` (capture Wave envoyée avant les 2h) doit être **gelée** vis-à-vis de l'expiration automatique pour laisser le temps à l'admin de valider.

---

## 2. Architecture du Monorepo

```text
eventrip/
├── packages/db/          # Schéma D1, migrations SQL, Kysely client + types générés, Better Auth
├── workers/api/          # API REST Hono sur Cloudflare Workers (D1 + R2 + Cron Expiration)
└── workers/web/          # Frontend SSR/CSR Astro + îlots Preact + Tailwind CSS v4
```

### Services Cloudflare utilisés
* **D1 (`DB` — `eventrip-db`)** : Base relationnelle SQLite (utilisateurs, événements, convois, commandes, tickets, paiements, audit, notifications).
* **R2 (`UPLOADS` — `eventrip-uploads`)** : Stockage des affiches d'événements (`events/...`) et des captures d'écran de justificatifs Wave (`proofs/...`), servis via routes API signées/protégées (pas d'accès public brut aux justificatifs clients).
* **Cron Triggers (`workers/api`)** : Tâche planifiée toutes les 5 minutes pour expirer les commandes en `pending_payment` dont `expires_at < now()` et restituer les places.

---

## 3. Modèle de données D1 (`002_domain.sql`)

La migration [001_better-auth.sql](../../packages/db/migrations/001_better-auth.sql) crée `user`, `session`, `account`, `verification`.
La migration `002_domain.sql` étend `user` et ajoute les tables métier :

### 3.1. Extension Utilisateurs & Permissions
```sql
ALTER TABLE "user" ADD COLUMN "phone" TEXT;
ALTER TABLE "user" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'client'; -- 'client' | 'admin' | 'super_admin'
ALTER TABLE "user" ADD COLUMN "permissions" TEXT NOT NULL DEFAULT '[]'; -- JSON array ex: ["payments:verify", "tickets:scan"]
ALTER TABLE "user" ADD COLUMN "is_active" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "user_phone_idx" ON "user" ("phone") WHERE "phone" IS NOT NULL;
```

### 3.2. Événements & Catégories de tickets
```sql
CREATE TABLE "events" (
  "id" TEXT PRIMARY KEY,
  "slug" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "poster_key" TEXT,                  -- Clé R2
  "starts_at" TEXT NOT NULL,          -- ISO 8601
  "ends_at" TEXT,
  "venue" TEXT NOT NULL,
  "extra_info" TEXT,
  "wave_payment_url" TEXT,            -- Lien de paiement Wave associé (optionnel)
  "sales_start_at" TEXT,
  "sales_end_at" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'published' | 'archived'
  "created_by" TEXT NOT NULL REFERENCES "user"("id"),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE TABLE "ticket_categories" (
  "id" TEXT PRIMARY KEY,
  "event_id" TEXT NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,               -- ex: Standard, VIP, VVIP
  "description" TEXT,
  "price_xof" INTEGER NOT NULL,       -- Montant entier en FCFA
  "capacity" INTEGER NOT NULL,
  "reserved_count" INTEGER NOT NULL DEFAULT 0, -- Places réservées + confirmées
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);
```

### 3.3. Convois (Transport)
```sql
CREATE TABLE "convoys" (
  "id" TEXT PRIMARY KEY,
  "event_id" TEXT NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "departure_at" TEXT NOT NULL,
  "meeting_point" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "trip_type" TEXT NOT NULL,          -- 'one_way' | 'round_trip'
  "price_xof" INTEGER NOT NULL,
  "capacity" INTEGER NOT NULL,
  "reserved_count" INTEGER NOT NULL DEFAULT 0,
  "extra_info" TEXT,
  "status" TEXT NOT NULL DEFAULT 'published', -- 'draft' | 'published' | 'cancelled'
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);
```

### 3.4. Commandes & Lignes de commande (Commandes mixtes)
```sql
CREATE TABLE "orders" (
  "id" TEXT PRIMARY KEY,
  "reference" TEXT NOT NULL UNIQUE,   -- Référence lisible ex: EVT-20261125-XXXX
  "user_id" TEXT NOT NULL REFERENCES "user"("id"),
  "total_amount_xof" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_payment',
  -- 'pending_payment' | 'under_review' | 'confirmed' | 'rejected' | 'expired' | 'cancelled'
  "expires_at" TEXT NOT NULL,         -- created_at + 2 heures par défaut
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE INDEX "orders_user_idx" ON "orders" ("user_id");
CREATE INDEX "orders_status_expires_idx" ON "orders" ("status", "expires_at");

CREATE TABLE "order_items" (
  "id" TEXT PRIMARY KEY,
  "order_id" TEXT NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "item_type" TEXT NOT NULL,          -- 'ticket_category' | 'convoy'
  "ticket_category_id" TEXT REFERENCES "ticket_categories"("id"),
  "convoy_id" TEXT REFERENCES "convoys"("id"),
  "quantity" INTEGER NOT NULL,
  "unit_price_xof" INTEGER NOT NULL,
  "subtotal_xof" INTEGER NOT NULL
);
```

### 3.5. Tickets & QR Codes
```sql
CREATE TABLE "tickets" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,        -- Code court lisible (support client)
  "qr_token" TEXT NOT NULL UNIQUE,    -- Token opaque scanné
  "order_id" TEXT NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "order_item_id" TEXT NOT NULL REFERENCES "order_items"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "user"("id"),
  "event_id" TEXT NOT NULL REFERENCES "events"("id"),
  "item_type" TEXT NOT NULL,          -- 'event_ticket' | 'convoy_ticket'
  "ticket_category_id" TEXT REFERENCES "ticket_categories"("id"),
  "convoy_id" TEXT REFERENCES "convoys"("id"),
  "status" TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'valid' | 'used' | 'cancelled'
  "used_at" TEXT,
  "scanned_by" TEXT REFERENCES "user"("id"),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE INDEX "tickets_order_idx" ON "tickets" ("order_id");
CREATE INDEX "tickets_user_idx" ON "tickets" ("user_id");
CREATE INDEX "tickets_qr_token_idx" ON "tickets" ("qr_token");
```

### 3.6. Paiements Wave & Traçabilité
```sql
CREATE TABLE "payments" (
  "id" TEXT PRIMARY KEY,
  "order_id" TEXT NOT NULL UNIQUE REFERENCES "orders"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "user"("id"),
  "expected_amount_xof" INTEGER NOT NULL,
  "payer_phone" TEXT,
  "proof_image_key" TEXT,             -- Clé R2 de la capture Wave
  "wave_transaction_ref" TEXT,        -- Saisie/extraite lors de la vérif admin
  "status" TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'confirmed' | 'rejected'
  "reviewed_by" TEXT REFERENCES "user"("id"),
  "reviewed_at" TEXT,
  "rejection_reason" TEXT,
  "submitted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

-- Empêche la réutilisation d'une transaction Wave déjà confirmée sur une autre commande
CREATE UNIQUE INDEX "payments_unique_confirmed_wave_ref"
  ON "payments" ("wave_transaction_ref")
  WHERE "status" = 'confirmed' AND "wave_transaction_ref" IS NOT NULL;
```

### 3.7. Audit & Notifications
```sql
CREATE TABLE "audit_logs" (
  "id" TEXT PRIMARY KEY,
  "actor_id" TEXT REFERENCES "user"("id"),
  "action" TEXT NOT NULL,             -- ex: 'payment.confirm', 'payment.reject', 'ticket.scan', 'order.expire', 'admin.permissions_update'
  "entity_type" TEXT NOT NULL,        -- 'payment' | 'ticket' | 'order' | 'user' | 'event' | 'convoy'
  "entity_id" TEXT NOT NULL,
  "old_state" TEXT,                   -- JSON
  "new_state" TEXT,                   -- JSON
  "metadata" TEXT,                    -- JSON (motif rejet, ref wave, ip, etc.)
  "created_at" TEXT NOT NULL
);

CREATE TABLE "notifications" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "type" TEXT NOT NULL,               -- ex: 'order_created', 'payment_confirmed', 'payment_rejected', 'new_proof_submitted'
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "link" TEXT,
  "is_read" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL
);
```

---

## 4. Flux critiques & Garanties d'atomicité (D1)

### 4.1. Création de commande mixte (Réservation immédiate + TTL 2h)
1. Valider que l'événement est `published` et dans sa fenêtre `sales_start_at`..`sales_end_at`.
2. Exécuter via `DB.batch([...])` :
   * Pour chaque ligne `ticket_category` :
     `UPDATE ticket_categories SET reserved_count = reserved_count + ? WHERE id = ? AND reserved_count + ? <= capacity`
   * Pour chaque ligne `convoy` :
     `UPDATE convoys SET reserved_count = reserved_count + ? WHERE id = ? AND reserved_count + ? <= capacity`
   * Vérifier que chaque `UPDATE` a modifié exactement 1 ligne (`meta.changes === 1`). Sinon, annuler/rejeter (409 Conflict — stock insuffisant).
3. Insérer `orders` (`expires_at = now + 2h`), `order_items`, `tickets` (statut `pending`, `qr_token` généré via `crypto.randomUUID()`), et `payments` (statut `pending`).

### 4.2. Envoi du justificatif Wave
1. Vérifier que la commande appartient au client, est en `pending_payment` et `expires_at > now()`.
2. Uploader l'image (type MIME `image/jpeg|png|webp`, taille max ex. 5 Mo) dans R2 sous `proofs/{order_id}/{uuid}.{ext}`.
3. Mettre à jour `payments` (`proof_image_key`, `payer_phone`, `submitted_at = now()`) et passer `orders.status` à `under_review` (ce qui **gèle** l'expiration automatique pendant la revue admin).
4. Créer une notification pour les admins habilités.

### 4.3. Validation / Rejet manuel du paiement
* **Permission requise** : `super_admin` OU `admin` possédant `payments:verify`.
* **Confirmation** :
  1. Vérifier que `wave_transaction_ref` est fourni et non vide.
  2. Transaction/batch atomique :
     * `UPDATE payments SET status = 'confirmed', wave_transaction_ref = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'` (échoue sur contrainte d'unicité si `wave_transaction_ref` déjà confirmée ailleurs).
     * `UPDATE orders SET status = 'confirmed' WHERE id = ?`
     * `UPDATE tickets SET status = 'valid' WHERE order_id = ? AND status = 'pending'`
     * `INSERT INTO audit_logs (...)`
     * `INSERT INTO notifications (...)` (client informé que ses tickets sont disponibles).
* **Rejet** :
  1. Motif obligatoire (`rejection_reason`).
  2. Passer `payments.status = 'rejected'`, `orders.status = 'rejected'`, `tickets.status = 'cancelled'`.
  3. **Restituer les places** (`reserved_count = reserved_count - qty`) sur `ticket_categories` et `convoys`.
  4. Logger dans `audit_logs` et notifier le client.

### 4.4. Expiration automatique (2h)
* Un Cron Trigger (`*/5 * * * *`) sélectionne les commandes `WHERE status = 'pending_payment' AND expires_at <= now()`.
* Pour chacune : passe `orders.status = 'expired'`, `tickets.status = 'cancelled'`, restitue `reserved_count` sur les catégories/convois, et enregistre dans `audit_logs`.

### 4.5. Scanner QR atomique
* Route `POST /api/admin/tickets/scan` avec `{ qr_token }`.
* Requête atomique :
  ```sql
  UPDATE tickets
  SET status = 'used', used_at = ?, scanned_by = ?, updated_at = ?
  WHERE qr_token = ? AND status = 'valid'
  RETURNING id, event_id, item_type, ticket_category_id, convoy_id, user_id;
  ```
* Si `RETURNING` renvoie une ligne → **Valide** (et log dans `audit_logs`).
* Sinon, `SELECT status FROM tickets WHERE qr_token = ?` pour retourner le diagnostic exact :
  * absent ou `cancelled` → **Invalide**
  * `pending` → **En attente** (paiement non confirmé)
  * `used` → **Déjà utilisé** (avec `used_at`)

---

## 5. Contrat d'API Hono (`workers/api`)

### Authentification (Better Auth)
* `ALL /api/auth/*` — géré par `getAuth(c.env.DB).handler(c.req.raw)`

### Routes Publiques
* `GET /api/events` — liste des événements `published` (avec catégories & disponibilités restantes)
* `GET /api/events/:slug` — détail d'un événement + ses catégories + convois associés
* `GET /api/media/posters/:key` — lecture sécurisée des affiches R2

### Routes Client (authentifié)
* `GET /api/me` / `PATCH /api/me` — profil & numéro de téléphone
* `POST /api/orders` — création commande mixte (retourne référence, montant, instructions Wave, `expires_at`)
* `GET /api/orders` / `GET /api/orders/:id` — historique & détail commande
* `POST /api/orders/:id/proof` — upload capture justificatif (multipart → R2) + numéro payeur
* `GET /api/tickets` — liste des tickets du client (avec `qr_token` généré en SVG/QR côté front uniquement si `valid`, ou affichage statut `pending`)
* `GET /api/notifications` / `PATCH /api/notifications/:id/read`

### Routes Admin (`role in ('admin', 'super_admin')`)
* `GET /api/admin/dashboard` — KPIs globaux et filtrables par événement
* `POST/PATCH /api/admin/events`, `/categories`, `/convoys` + upload affiche R2
* `GET /api/admin/payments` — file de vérification des paiements
* `GET /api/admin/payments/:id/proof` — streaming sécurisé de la capture R2
* `POST /api/admin/payments/:id/confirm` *(permission `payments:verify`)*
* `POST /api/admin/payments/:id/reject` *(permission `payments:verify`)*
* `POST /api/admin/tickets/scan` — validation atomique QR code
* `GET /api/admin/convoys/:id/passengers` — liste des passagers d'un convoi

### Routes Super Admin (`role === 'super_admin'`)
* `GET/POST/PATCH /api/super-admin/users` — gestion comptes admins & permissions
* `GET /api/super-admin/audit-logs` — journaux d'activité complets

---

## 6. Architecture Frontend (`workers/web`)

* **Astro SSR** sur Cloudflare pour le SEO des pages publiques et la rapidité initiale sur mobile.
* **Îlots Preact** pour les interactions dynamiques :
  * Panier / configurateur de commande mixte (tickets + convoi) avec compte à rebours des 2h.
  * Upload de justificatif Wave (prévisualisation mobile avant envoi).
  * Portefeuille de billets avec rendu QR code côté client (uniquement actif quand `status === 'valid'`).
  * Interface d'administration responsive : liste des paiements avec visionneuse de capture + saisie référence Wave.
  * Scanner QR mobile (accès caméra navigateur via `BarcodeDetector` / fallback `html5-qrcode`) avec retour visuel immédiat (`Valide` / `En attente` / `Déjà utilisé` / `Invalide`).

---

## 7. Plan de découpage par jalons

1. **Jalon 1 — Socle DB & Auth** (`packages/db`)
   * Écrire `002_domain.sql`, appliquer en local, régénérer les types Kysely (`bun run db:types`).
   * Étendre `auth.ts` (champ `phone`, `role`, `permissions`).
2. **Jalon 2 — API Core** (`workers/api`)
   * Structurer Hono (`routes/`, `middleware/auth.ts`, `services/`, `cron/expire-orders.ts`).
   * Implémenter événements, convois, commandes mixtes, upload R2, validation/rejet paiement, scan QR atomique + tests Vitest.
3. **Jalon 3 — Parcours Client** (`workers/web`)
   * Auth, catalogue événements, tunnel de commande mixte, dépôt justificatif Wave, espace « Mes billets ».
4. **Jalon 4 — Back-office & Scanner** (`workers/web`)
   * Dashboard KPIs, gestion événements/convois, file de vérification des paiements, scanner QR mobile, gestion super-admin & audit logs.
