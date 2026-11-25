# EVENTRIP-ABJ — Guide de travail & Conventions

Application web de billetterie événementielle et de gestion de convois de transport pour la Côte d'Ivoire, construite sur Cloudflare Workers, D1, R2, Hono, Better Auth, Kysely et Astro/Preact.

## Références principales

* **Cahier des charges fonctionnel** : `dev/SPEC.md`
* **Spécification technique & architecture** : `dev/TECH_SPEC.md`
* **Guides par workspace** :
  * `packages/db/AGENTS.md` (D1, Kysely, Better Auth, migrations)
  * `workers/api/AGENTS.md` (Cloudflare Workers, Wrangler, Local Explorer)
  * `workers/web/AGENTS.md` (Astro, Preact, Tailwind CSS)

## Structure du monorepo (`bun` workspaces)

* `packages/db` : Schéma D1 (`migrations/*.sql`), client Kysely (`getDB`), Better Auth (`getAuth`), types générés (`src/generated_types.ts`) et helpers de rôles/permissions (`src/types.ts`).
* `workers/api` : API REST Hono (`src/index.ts`), middlewares d'authentification/permissions (`src/middleware/auth.ts`), stockage R2 (`UPLOADS`) et Cron Trigger (`*/5 * * * *`).
* `workers/web` : Frontend Astro SSR + îlots Preact + Tailwind CSS v4 déployé sur `@astrojs/cloudflare`.

## Invariants métier critiques (à ne jamais contourner)

1. **Réservation & TTL 2h** : Les places (`ticket_categories.reserved_count`, `convoys.reserved_count`) sont réservées dès la création de la commande via des mises à jour atomiques (`WHERE reserved_count + qty <= capacity`). Une commande `pending_payment` expire après 2h ; dès qu'un justificatif Wave est déposé (`under_review`), l'expiration automatique est gelée.
2. **Commandes mixtes** : Une même commande (`orders` + `order_items`) peut combiner des tickets d'événement et des places de convoi.
3. **Validation manuelle Wave** : Seul un `super_admin` ou un `admin` disposant de la permission `payments:verify` peut confirmer/rejeter un paiement. Une `wave_transaction_ref` confirmée ne peut jamais être réutilisée (contrainte d'unicité partielle en base).
4. **QR Codes & Scan atomique** : Les tickets sont générés à la commande (`pending`) avec un `qr_token` opaque unique, mais restent inutilisables tant que le paiement n'est pas confirmé (`valid`). Le scan valide en base de façon atomique (`UPDATE tickets SET status = 'used' ... WHERE qr_token = ? AND status = 'valid' RETURNING ...`).
5. **Traçabilité** : Toute opération sensible (confirmation/rejet de paiement, scan, expiration, modification de permissions) doit écrire une entrée dans `audit_logs`.

## Commandes utiles

```bash
# Installer les dépendances du monorepo
bun install

# Générer les types Kysely après modification de packages/db/migrations/*.sql
bun run --cwd packages/db db:gen-kysely-types

# Appliquer les migrations D1 en local
bun run --cwd packages/db db:migrate:local

# Régénérer les types Cloudflare Worker après modification de wrangler.jsonc
bun run --cwd workers/api cf-typegen

# Typecheck & tests API
bunx tsc -p workers/api/tsconfig.json --noEmit
bun run --cwd workers/api test -- --run
```

## Conventions Git

* Réaliser un commit entre chaque tâche/jalon avec le préfixe :
  `scope: [ai-assisted] <type>(<scope>): <résumé>`
