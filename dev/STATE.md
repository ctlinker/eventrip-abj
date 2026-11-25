# EVENTRIP-ABJ — État fonctionnel & Guide par acteur (`STATE.md`)

> Ce document décrit l'état actuel de l'application telle qu'elle est implémentée dans `packages/db`, `packages/utils`, `workers/api` et `workers/web` : ce que chaque acteur peut faire, par quelles pages UI et via quelles routes API.

---

## 1. Visiteur (non authentifié)

| Action | Comment (UI) | API correspondante |
|---|---|---|
| Explorer & rechercher des événements | Page d'accueil `/` (`EventsCatalog`) : Hero 2 colonnes avec navette cartoon animée, barre de recherche segmentée (`Mot-clé`, `Commune de départ`, `Catégorie`) et cartes à badges de catégorie flottants + bandeau défilant des départs (`42/55 dispo`) | `GET /api/events`, `GET /api/event-categories` |
| Voir les photos/affiches d'un événement | Carrousel multi-photos (`EventImageCarousel`) sur les cartes et sur la fiche événement | `GET /api/media/posters/:key` (avec cache `ETag` / `304`) |
| Consulter le détail d'un événement & ses départs | Page `/events/[slug]` (`EventCheckout`) : tarif unique de l'événement (convoi A/R inclus), départs triés de façon déterministe selon la commune préférée | `GET /api/events/:slug` |
| Préparer une réservation avant connexion | Sur `/events/[slug]`, choisir sa commune et sa quantité : si non connecté, le choix est mémorisé dans `sessionStorage` et restauré automatiquement après connexion | — (local) |
| Créer un compte ou se connecter | Page `/auth` (`AuthForm`) : nom, téléphone, commune préférée (optionnelle), email, mot de passe | `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email` |

---

## 2. Client (`role: "client"`)

Le client dispose de toutes les capacités du visiteur, plus :

| Action | Comment (UI) | API correspondante & Règles |
|---|---|---|
| Consulter / modifier son profil | Via session SSR (`Layout.astro` → `Navbar`) & endpoint profil | `GET /api/me`, `PATCH /api/me` (`name`, `phone` unique, `commune`) |
| Commander ses billets (événement + convoi A/R) | Sur `/events/[slug]`, sélectionner sa commune de départ et le nombre de billets, puis cliquer sur **« Commander maintenant »** (ou barre sticky en bas d'écran sur mobile) | `POST /api/orders` (`{ convoy_id, quantity }`) — tarif unique `event.price_xof`, réservation atomique des places pendant **2 heures** (`pending_payment`), génération anticipée des billets (`pending`) |
| Consulter son historique de commandes | Page `/orders` (`OrdersList`) | `GET /api/orders` |
| Suivre une commande & copier la référence | Page `/orders/[id]` (`OrderDetail`) avec compte à rebours 2h et copie 1-clic de la référence | `GET /api/orders/:id` |
| Payer via Wave | Sur `/orders/[id]`, cliquer sur **« Payer avec Wave »** ou scanner le **QR code de paiement** généré localement | Lien `https://pay.wave.com/m/<merchantId>/c/ci?amount=<total_amount_xof>` |
| Transmettre sa preuve de paiement Wave | Sur `/orders/[id]`, saisir l'**ID de transaction Wave**, déposer une **capture d'écran** (dropzone avec miniature d'aperçu, <= 5 Mo), ou les deux | `POST /api/orders/:id/proof` — stocke la capture dans R2 (`proofs/...`), passe la commande en `under_review` et **gèle l'expiration** |
| Consulter ses billets, afficher le QR & télécharger son reçu | Page `/tickets` (`TicketsWallet`) : billets perforés avec statut Aller/Retour (`Dispo` / `Scanné ✓`), modale **« Afficher QR »**, et téléchargement reçu officiel en **Image PNG** ou **PDF** (`jspdf`) | `GET /api/tickets` — `qr_token` masqué tant que `status !== 'valid'` ; reçus PNG/PDF générés 100 % côté client (`0` requête serveur) |
| Consulter ses notifications | Endpoint notifications in-app | `GET /api/notifications`, `PATCH /api/notifications/:id/read` |

---

## 3. Administrateur (`role: "admin"`)

L'administrateur accède au back-office via le bouton **Admin** dans la barre de navigation (`/admin`). Toutes les mutations admin mettent à jour l'état local sans rechargement réseau redondant.

| Action | Comment (UI) | API correspondante & Permissions |
|---|---|---|
| Consulter les statistiques (KPIs) | Page `/admin` (`AdminDashboard`) : CA confirmé, paiements en attente/confirmés, commandes, billets générés/valides/utilisés, places convois | `GET /api/admin/dashboard` (filtrable par `?event_id=...`) |
| Gérer les catégories d'événements | Page `/admin/events`, onglet **`Catégories`** (ou bouton `+` inline à la création) : `Concert live`, `Séminaire`, `Festival`, `Excursion`, `Soirée`… | `GET /api/admin/event-categories`, `POST /api/admin/event-categories` (anti-doublon `409`) |
| Créer, publier ou dépublier un événement | Page `/admin/events`, bouton **`+ Nouvel événement`** (vue dédiée séparée de la liste) : titre, catégorie, lieu, date, **prix unique du billet**, ID Marchand Wave optionnel, **départ initial obligatoire** (`55` places par défaut) et photos | `GET /api/admin/events`, `POST /api/admin/events`, `PATCH /api/admin/events/:id` |
| Gérer les photos d'un événement | Upload multiple à la création, ajout ou suppression (`×`) sur les événements existants | `POST /api/admin/events/:id/poster`, `DELETE /api/admin/events/:id/poster` |
| Ajouter d'autres communes de départ | Sur chaque carte dans `/admin/events`, bouton **« + Ajouter une commune de départ (55 pl.) »** (sans modifier le prix de l'événement) | `POST /api/admin/events/:id/convoys`, `GET /api/admin/convoys/:id/passengers` |
| Consulter la file des paiements & captures | Page `/admin/payments` (`AdminPayments`) avec statuts traduits (`Preuve reçue`, `Attente preuve`, `Confirmée`, `Rejetée`) et aperçu de la capture R2 | `GET /api/admin/payments`, `GET /api/admin/payments/:id/proof` |
| **Valider un paiement Wave en 1 clic** | Sur `/admin/payments`, cliquer sur **« Valider le paiement »** *(nécessite `payments:verify`)* | `POST /api/admin/payments/:id/confirm` — active les billets (`valid`), vérifie l'unicité de `wave_transaction_ref`, écrit dans `audit_logs` et notifie le client |
| **Rejeter un paiement Wave** | Sur `/admin/payments`, saisir un motif et cliquer sur **« Rejeter »** *(nécessite `payments:verify`)* | `POST /api/admin/payments/:id/reject` — annule les billets, **restitue les places réservées**, écrit dans `audit_logs` et notifie le client |
| Scanner les QR codes (Aller & Retour) | Page `/admin/scanner` (`AdminScanner`) : sélecteur **« Contrôle Aller / Entrée »** vs **« Contrôle Retour (Convoi) »**, caméra (`BarcodeDetector`) ou saisie manuelle, vibration haptique et **historique de session** | `POST /api/admin/tickets/scan` (`{ qr_token, direction }`) — validation atomique en 2 temps (`outbound_used_at` puis `return_used_at`), anti double-scan par trajet, journalisé dans `audit_logs` |

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

* **Expiration des commandes non payées (`*/5 * * * *`)** : `expirePendingOrders` (dans `workers/api/src/services/orders.ts`) recherche toutes les commandes en `pending_payment` dont `expires_at <= now`, les passe en `expired`, annule leurs billets `pending`, restitue les places réservées, et écrit une entrée `order.expire` dans `audit_logs`. Les commandes passées en `under_review` (preuve Wave transmise) sont gelées et ne sont jamais expirées automatiquement.

---

## 6. Fonctionnalités implémentées (par module)

| Module | État | Détails de ce qui est en place |
|---|---|---|
| **Authentification & Rôles** | Implémenté | Better Auth (`emailAndPassword`) sur D1, champs `phone`, `commune`, `role`, `permissions`, `is_active`, bootstrap auto du 1er `super_admin` via `BOOTSTRAP_SUPER_ADMIN_EMAIL`, session résolue en SSR pour `Navbar`. |
| **Événements, Catégories & Médias** | Implémenté | Catégories d'événements extensibles (`Concert live`, `Séminaire`…), prix unique par événement (`events.price_xof`), vue admin séparée par onglets, upload/suppression multi-photos R2 (`ETag`/`304`), carrousel photo client. |
| **Départs par commune (Convois)** | Implémenté | Départ initial obligatoire à la création (`55` places par défaut), ajout illimité de communes sans surcoût, tri déterministe selon la commune du client (`sortConvoysByCommune`), bandeau défilant `X/55 dispo` sur les cartes d'accueil. |
| **Billetterie & Commandes** | Implémenté | Réservation atomique des capacités (`D1 batch` + rollback compensatoire), TTL 2h, persistance du panier dans `sessionStorage` avant connexion, barre mobile sticky sur `/events/[slug]`. |
| **Paiements Wave & Vérification** | Implémenté | Lien `pay.wave.com/m/<id>/c/ci?amount=<montant>` auto-généré + QR code Wave, preuve par ID Wave et/ou capture R2 (dropzone avec miniature), validation admin en 1 clic ou rejet avec restitution des places, unicité de `wave_transaction_ref`. |
| **QR Codes, Reçus & Double Scan** | Implémenté | Billets perforés dans `/tickets` avec modale QR plein écran, téléchargement reçu officiel en **Image PNG** ou **PDF**, scanner `/admin/scanner` avec mode **Aller (1/2)** / **Retour (2/2)** atomique, vibration mobile et historique de session. |
| **Administration & Audit** | Implémenté | Dashboard KPIs, gestion des paiements, événements/catégories/départs, scanner QR, gestion des rôles/permissions (`payments:verify`) et `audit_logs`. |
| **Notifications** | Implémenté (API) | Table `notifications` alimentée sur création de commande, dépôt de preuve, confirmation et rejet ; endpoints `GET /api/notifications` et `PATCH /api/notifications/:id/read`. *(Optionnel UI : cloche de notifications dans `Navbar`.)* |
| **Design System & Architecture** | Implémenté | Monorepo Bun, Service Binding `API` via `/api/[...path].ts` (`cloudflare:workers`), `packages/utils` (`tryCatch`, `Result`, `isUniqueConstraintError`), refonte UI blanc pur / `slate-200` / vert émeraude, bandes hachurées diagonales, Hero 2 colonnes + navette cartoon animée (`CartoonShuttle`), police `Satoshi-Variable`, tests Vitest API. |
