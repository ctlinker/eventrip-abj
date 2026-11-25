# EVENTRIP-ABJ — État fonctionnel & Guide par acteur (`STATE.md`)

> Ce document décrit l'état actuel de l'application telle qu'elle est implémentée dans `packages/db`, `workers/api` et `workers/web` : ce que chaque acteur peut faire, par quelles pages UI et via quelles routes API.

---

## 1. Visiteur (non authentifié)

| Action | Comment (UI) | API correspondante |
|---|---|---|
| Parcourir les événements publiés | Page d'accueil `/` (`EventsCatalog`) avec carrousel multi-photos, tarif minimum et places restantes | `GET /api/events` |
| Voir les photos/affiches d'un événement | Chargement automatique dans les cartes et fiches | `GET /api/media/posters/:key` |
| Consulter le détail d'un événement & ses convois | Page `/events/[slug]` (`EventCheckout`) | `GET /api/events/:slug` |
| Créer un compte ou se connecter | Page `/auth` (`AuthForm`) : nom, téléphone, email, mot de passe | `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email` |

---

## 2. Client (`role: "client"`)

Le client dispose de toutes les capacités du visiteur, plus :

| Action | Comment (UI) | API correspondante & Règles |
|---|---|---|
| Consulter / modifier son profil | Via session & profil | `GET /api/me`, `PATCH /api/me` (`name`, `phone` unique) |
| Passer une commande mixte (tickets + convois) | Sur `/events/[slug]`, choisir les quantités et cliquer sur **« Commander maintenant »** | `POST /api/orders` — réserve les places atomiquement pour **2 heures** (`pending_payment`) et génère les tickets au statut `pending` |
| Consulter son historique de commandes | Page `/orders` (`OrdersList`) | `GET /api/orders` |
| Suivre une commande & voir le compte à rebours 2h | Page `/orders/[id]` (`OrderDetail`) | `GET /api/orders/:id` |
| Payer via Wave | Sur `/orders/[id]`, cliquer sur **« Payer avec Wave »** ou scanner le **QR code de paiement** généré automatiquement | Lien `https://pay.wave.com/m/<merchantId>/c/ci?amount=<total_amount_xof>` |
| Envoyer son justificatif Wave | Sur `/orders/[id]`, saisir l'**ID de transaction Wave**, joindre une **capture d'écran** (JPEG/PNG/WebP <= 5 Mo), ou les deux | `POST /api/orders/:id/proof` — stocke la capture dans R2 (`proofs/...`), passe la commande en `under_review` et **gèle l'expiration** |
| Accéder à ses billets & QR codes | Page `/tickets` (`TicketsWallet`) | `GET /api/tickets` — le `qr_token` (et donc le QR code) reste verrouillé tant que le paiement n'est pas confirmé (`status === 'valid'`) |
| Consulter ses notifications | Endpoint notifications in-app | `GET /api/notifications`, `PATCH /api/notifications/:id/read` |

---

## 3. Administrateur (`role: "admin"`)

L'administrateur accède au back-office via le bouton **Admin** dans la barre de navigation (`/admin`).

| Action | Comment (UI) | API correspondante & Permissions |
|---|---|---|
| Consulter les statistiques (KPIs) | Page `/admin` (`AdminDashboard`) : CA confirmé, paiements en attente/confirmés, commandes, tickets, places convois | `GET /api/admin/dashboard` (filtrable par `?event_id=...`) |
| Créer, publier ou dépublier un événement | Page `/admin/events` (`AdminEvents`) : titre, lieu, date, ID Marchand Wave optionnel, description, 1ère catégorie (prix + places) et photos | `GET /api/admin/events`, `POST /api/admin/events`, `PATCH /api/admin/events/:id` |
| Gérer les photos d'un événement | Sur `/admin/events` : upload multiple à la création, ajout ou suppression (`×`) sur les événements existants | `POST /api/admin/events/:id/poster`, `DELETE /api/admin/events/:id/poster` |
| Ajouter des catégories de tickets | Sur `/admin/events`, bouton **« + Ajouter une catégorie de tickets »** (avec aperçu du lien Wave) | `POST /api/admin/events/:id/categories` |
| Créer un convoi & voir ses passagers | API convois dédiée | `POST /api/admin/events/:id/convoys`, `GET /api/admin/convoys/:id/passengers` |
| Consulter la file des paiements & captures | Page `/admin/payments` (`AdminPayments`) avec filtres (`En attente`, `Confirmés`, `Rejetés`, `Tous`) et bouton **« Voir justificatif »** | `GET /api/admin/payments`, `GET /api/admin/payments/:id/proof` |
| **Valider un paiement Wave** | Sur `/admin/payments`, cliquer sur **« Valider le paiement »** *(nécessite `payments:verify`)* | `POST /api/admin/payments/:id/confirm` — passe les tickets en `valid`, vérifie l'unicité de `wave_transaction_ref`, écrit dans `audit_logs` et notifie le client |
| **Rejeter un paiement Wave** | Sur `/admin/payments`, saisir un motif et cliquer sur **« Rejeter »** *(nécessite `payments:verify`)* | `POST /api/admin/payments/:id/reject` — annule les tickets, **restitue les places réservées**, écrit dans `audit_logs` et notifie le client |
| Scanner les QR codes à l'entrée | Page `/admin/scanner` (`AdminScanner`) : caméra (`BarcodeDetector`) ou saisie/collage manuel du `qr_token` | `POST /api/admin/tickets/scan` — validation atomique (`valid` → `used`), empêche les doubles scans et logue dans `audit_logs` |

---

## 4. Super Administrateur (`role: "super_admin"`)

Le super administrateur dispose automatiquement de **tous les droits administrateur** (y compris `payments:verify`), plus :

| Action | Comment | Détails techniques |
|---|---|---|
| Initialisation du 1er Super Admin | Automatique à la première inscription ou connexion | Variable/secret `BOOTSTRAP_SUPER_ADMIN_EMAIL` dans `workers/api` : promeut l'email correspondant uniquement s'il n'existe encore aucun `super_admin` en base (`audit_logs`: `super_admin.bootstrap`) |
| Gérer les comptes, rôles et permissions | Page `/admin/users` (`AdminUsers`) | `GET /api/super-admin/users`, `PATCH /api/super-admin/users/:id` (`role`, `permissions` dont `payments:verify`, `is_active`), journalisé dans `audit_logs` |
| Consulter les journaux d'audit | Page `/admin/users` (section *Journaux d'audit récents*) | `GET /api/super-admin/audit-logs` (100 dernières opérations sensibles) |

---

## 5. Automates système (Cron Cloudflare Workers)

* **Expiration des commandes non payées (`*/5 * * * *`)** : `expirePendingOrders` (dans `workers/api/src/services/orders.ts`) recherche toutes les commandes en `pending_payment` dont `expires_at <= now`, les passe en `expired`, annule leurs tickets `pending`, restitue les places réservées sur `ticket_categories` et `convoys`, et écrit une entrée `order.expire` dans `audit_logs`. Les commandes passées en `under_review` (justificatif envoyé) sont gelées et ne sont jamais expirées automatiquement.

---

## 6. Fonctionnalités implémentées (par module)

| Module | État | Détails de ce qui est en place |
|---|---|---|
| **Authentification & Rôles** | Implémenté | Better Auth (`emailAndPassword`) sur D1, champs `phone`, `role`, `permissions`, `is_active`, bootstrap automatique du 1er `super_admin` via `BOOTSTRAP_SUPER_ADMIN_EMAIL`. |
| **Événements & Médias** | Implémenté | CRUD événements, catégories tarifées, publication/dépublication, upload multi-photos vers R2, suppression de photo, carrousel client sur les cartes et fiches. |
| **Billetterie & Commandes mixtes** | Implémenté | Panier combinant tickets d'événement et places de convoi, réservation atomique des capacités (`D1 batch` + rollback compensatoire), TTL 2h, génération anticipée des tickets (`pending`). |
| **Paiements Wave & Vérification** | Implémenté | Génération auto du lien `pay.wave.com/m/<id>/c/ci?amount=<montant>` + QR code de paiement, soumission justificatif par capture R2 et/ou ID Wave (gel de l'expiration), validation admin en 1 clic ou rejet avec restitution des places, unicité de `wave_transaction_ref`. |
| **Convois** | Implémenté (API + Achat client) | Modèle DB, création et liste passagers via API (`/api/admin/events/:id/convoys`, `/api/admin/convoys/:id/passengers`), sélection et achat côté client sur `/events/[slug]`. *(Reste à ajouter si activé en V1 : formulaire de création de convoi dans l'UI `/admin/events`.)* |
| **QR Codes & Contrôle d'accès** | Implémenté | Tokens opaques masqués tant que le paiement n'est pas confirmé, affichage QR code dans `/tickets`, scanner caméra (`BarcodeDetector`) + saisie manuelle dans `/admin/scanner`, validation atomique anti double-scan. |
| **Administration & Audit** | Implémenté | Dashboard KPIs, file de vérification des paiements, gestion des rôles/permissions (`payments:verify`) et consultation des `audit_logs`. |
| **Notifications** | Implémenté (API) | Table `notifications` alimentée sur création de commande, dépôt de justificatif, confirmation et rejet ; endpoints `GET /api/notifications` et `PATCH /api/notifications/:id/read`. *(Reste à brancher : cloche de notifications dans la `Navbar`.)* |
| **Architecture & Qualité** | Implémenté | Monorepo Bun, Service Binding `API` via `/api/[...path].ts` (`cloudflare:workers`), lib partagée `packages/utils` (`tryCatch`, `Result`, `isUniqueConstraintError`), thème blanc/vert avec police `Satoshi-Variable`, tests Vitest API. |

