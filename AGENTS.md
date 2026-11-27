# EVENTRIP-ABJ — Guide de travail & Conventions

Application web de billetterie événementielle et de gestion de convois de transport pour la Côte d'Ivoire, construite sur Cloudflare Workers, D1, R2, Hono, Better Auth, Kysely et Astro/Preact.

## Références principales

* **Cahier des charges fonctionnel** : `dev/SPEC.md`
* **Spécification technique & architecture** : `dev/TECH_SPEC.md`
* **État fonctionnel courant & Changelog** : `dev/STATE.md`, `CHANGELOG.md`
* **Guides par workspace** :
  * `packages/db/AGENTS.md` (D1, Kysely, Better Auth, migrations)
  * `workers/api/AGENTS.md` (Cloudflare Workers, Wrangler, Local Explorer)
  * `workers/mail/AGENTS.md` (Worker d'envoi d'emails Resend & quotas D1)
  * `workers/web/AGENTS.md` (Astro, Preact, Tailwind CSS)

## Structure du monorepo (`bun` workspaces)

* `packages/db` : Schéma D1 (`migrations/*.sql`), client Kysely (`getDB`), Better Auth (`getAuth`), types générés (`src/generated_types.ts`) et helpers de rôles/permissions (`src/types.ts`).
* `packages/utils` : Utilitaires partagés de gestion d'erreurs (`tryCatch`, `tryCatchSync`, `Result<T, E>`, `isUniqueConstraintError`, `getErrorMessage`).
* `workers/api` : API REST Hono (`src/index.ts`), middlewares d'authentification/permissions (`src/middleware/auth.ts`), stockage R2 (`UPLOADS`), Service Bindings (`WEB_PUSH`, `MAIL`) et Cron Trigger (`*/5 * * * *`).
* `workers/mail` : Envoi d'emails transactionnels via Resend (`noreply@eventrip-abj.com`), contrôle des quotas journalier/mensuel, cooldown par destinataire et journalisation `mail_logs` sur D1.
* `workers/web-push` : Notifications temps réel WebSocket (Durable Object `UserRealtimeHub`) et consommateur Queue Web Push (`push-notifications`).
* `workers/web` : Frontend Astro SSR + îlots Preact + Tailwind CSS v4 déployé sur `@astrojs/cloudflare`.

## Conventions Cloudflare Workers

* **Communication inter-services** : Toujours utiliser un **Service Binding** (ex. `API` dans `workers/web/wrangler.jsonc` via `/api/[...path].ts`) plutôt qu'une URL publique en variable d'environnement.
* **Accès aux bindings & variables Cloudflare** : Dans tout Worker (y compris Astro SSR), importer les variables et bindings via `import { env } from "cloudflare:workers"` plutôt que `locals.runtime.env`.

## Gestion des erreurs (`packages/utils`)

* Pour toute opération susceptible d'échouer (appels D1, uploads R2, `fetch`, parsing JSON/multipart), utiliser `tryCatch` / `tryCatchSync` de `utils` au lieu de blocs `try/catch` ad hoc ou de `.catch(() => ({}))`.
* Utiliser `isUniqueConstraintError(err)` pour détecter les violations de contrainte d'unicité D1/SQLite (téléphone, `wave_transaction_ref`, slug) et retourner un statut `409 Conflict` explicite.
* Utiliser `getErrorMessage(err, fallback)` pour extraire un message lisible côté client/API.

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

## Audit UI Web avec Playwright (headless)

* **Outil** : `playwright` est installé dans les `devDependencies` à la racine du monorepo (`package.json`).
* **Usage** : Pour auditer le comportement de l'interface web (`workers/web`), exécuter des scripts Playwright en mode **headless** (`chromium.launch({ headless: true })`, activé par défaut) contre le serveur local (`astro dev --background` ou `bun run --cwd workers/web dev`).
* **Points à vérifier lors d'un audit** :
  * Absence d'erreurs console ou d'exceptions non gérées (`console` error, `pageerror`).
  * Réponses réseau et appels `/api/...` (statuts HTTP, payloads, gestion des erreurs).
  * Hydratation des îlots Preact, parcours utilisateur complets (formulaires, navigation, états vides/erreurs) et rendu responsive (mobile & desktop).
  * Capture de captures d'écran ou d'états DOM si nécessaire pour diagnostiquer un bug visuel ou comportemental.

## Conventions Git

* Réaliser un commit entre chaque tâche/jalon avec le préfixe :
  `scope: [ai-assisted] <type>(<scope>): <résumé>`
