# EVENTRIP-ABJ — État fonctionnel & Guide par acteur (`STATE.md`)

> Ce document décrit l'état actuel de l'application telle qu'elle est implémentée dans `packages/db`, `packages/utils`, `workers/api`, `workers/web-push` et `workers/web` : ce que chaque acteur peut faire, par quelles pages UI et via quelles routes API.

---

## 1. Visiteur (non authentifié)

| Action | Comment (UI) | API correspondante |
|---|---|---|
| Explorer & rechercher des événements | Page d'accueil `/` (`EventsCatalog`) : Hero 2 colonnes avec navette cartoon animée, barre de recherche segmentée (`Mot-clé` sur titre/lieu/description, `Commune de départ`, `Catégorie`), tri prioritaire de la grille selon la commune choisie, badges de catégorie flottants et bandeau défilant des départs (`42/55 dispo`) | `GET /api/events`, `GET /api/event-categories` |
| Voir les photos/affiches d'un événement | Carrousel multi-photos (`EventImageCarousel`) sur les cartes et sur la fiche événement (sans imbrication `<button>` dans `<a>`) | `GET /api/media/posters/:key` (avec cache `ETag` / `304`) |
| Consulter le détail d'un événement & ses départs | Page `/events/[slug]` (`EventCheckout`) : tarif unique de l'événement (convoi A/R inclus), départs triés de façon déterministe selon la commune préférée | `GET /api/events/:slug` |
| Préparer une réservation avant connexion | Sur `/events/[slug]`, choisir sa commune et sa quantité : détection préalable de session sans erreur `401`, mémorisation dans `sessionStorage` et restauration automatique après connexion | `GET /api/auth/get-session` + stockage local |
| Créer un compte ou se connecter | Page `/auth` (`AuthForm`) : nom, téléphone unique (erreur `409` explicite en français si déjà utilisé), commune préférée (optionnelle), email, mot de passe | `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email` |

---

## 2. Client (`role: "client"`)

Le client dispose de toutes les capacités du visiteur, plus :

| Action | Comment (UI) | API correspondante & Règles |
|---|---|---|
| Consulter / modifier son profil | Via session SSR (`Layout.astro` → `Navbar`) & endpoint profil | `GET /api/me`, `PATCH /api/me` (`name`, `phone` unique, `commune`) |
| Gérer sa liste de souhaits (Favoris) | Bouton cœur sur les cartes de `/` et sur `/events/[slug]`, plus page dédiée `/wishlist` (`WishlistPage`) accessible depuis **Favoris** dans la `Navbar` | `GET /api/wishlists`, `POST /api/wishlists/:eventId`, `DELETE /api/wishlists/:eventId` (état initial inclus dans `GET /api/events` et `GET /api/events/:slug` sans requête supplémentaire) |
| Commander ses billets (événement + convoi A/R) | Sur `/events/[slug]`, sélectionner sa commune de départ et le nombre de billets, puis cliquer sur **« Commander maintenant »** (ou barre `sticky bottom-0` sur mobile) | `POST /api/orders` (`{ convoy_id, quantity }`) — tarif unique `event.price_xof`, réservation atomique des places pendant **2 heures** (`pending_payment`), génération anticipée des billets (`pending`) + Outbox notification |
| Consulter son historique de commandes | Page `/orders` (`OrdersList`) affichant le titre de l'événement, la commune de départ, le nombre de billets, le statut et le montant (mise à jour temps réel auto) | `GET /api/orders` |
| Suivre une commande & copier la référence | Page `/orders/[id]` (`OrderDetail`) avec titre de l'événement, commune, badge statut, compte à rebours 2h, copie 1-clic de la référence et rafraîchissement automatique en temps réel | `GET /api/orders/:id` |
| Payer via Wave | Sur `/orders/[id]`, cliquer sur **« Payer avec Wave »** ou scanner le **QR code de paiement** généré localement | Lien `https://pay.wave.com/m/<merchantId>/c/ci?amount=<total_amount_xof>` |
| Transmettre sa preuve de paiement Wave | Sur `/orders/[id]`, saisir l'**ID de transaction Wave**, déposer une **capture d'écran** (dropzone avec miniature d'aperçu, <= 5 Mo), ou les deux | `POST /api/orders/:id/proof` — stocke la capture dans R2 (`proofs/...`), passe la commande en `under_review`, **gèle l'expiration** et notifie en temps réel + Web Push les admins `payments:verify` |
| Consulter ses billets, afficher le QR & télécharger son reçu | Page `/tickets` (`TicketsWallet`) : billets perforés avec statut Aller/Retour (`Dispo` / `Scanné ✓` mis à jour en direct au scan), modale accessible **« Afficher QR »** (`Escape` / focus), et téléchargement reçu officiel en **Image PNG** ou **PDF** (`jspdf`) | `GET /api/tickets` — `qr_token` masqué tant que `status !== 'valid'` ; reçus PNG/PDF générés 100 % côté client (`0` requête serveur) |
| Recevoir ses notifications en direct & activer Web Push | Cloche **`NotificationBell`** dans la `Navbar` (badge non-lu, *Tout lu*, switch **Alertes Push sur cet appareil**) + bannière opt-in contextuelle sur `/orders/[id]` + PWA `/manifest.webmanifest` & `/sw.js` | `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `POST /api/notifications/read-all`, `GET /api/push/vapid-key`, `POST /api/push/subscribe`, `DELETE /api/push/subscribe`, `GET /api/realtime/ws` |

---

## 3. Administrateur (`role: "admin"`)

L'administrateur accède au back-office via le bouton **Admin** dans la barre de navigation (`/admin`). Toutes les mutations admin mettent à jour l'état local sans rechargement réseau redondant.

| Action | Comment (UI) | API correspondante & Permissions |
|---|---|---|
| Consulter les statistiques (KPIs) | Page `/admin` (`AdminDashboard`) : CA confirmé, paiements en attente/confirmés, commandes, billets générés/valides/utilisés, places convois | `GET /api/admin/dashboard` (filtrable par `?event_id=...`) |
| Gérer les catégories d'événements | Page `/admin/events`, onglet **`Catégories`** (ou bouton `+` inline à la création) : `Concert live`, `Séminaire`, `Festival`, `Excursion`, `Soirée`… | `GET /api/admin/event-categories`, `POST /api/admin/event-categories` (anti-doublon `409`) |
| Créer, publier, archiver ou supprimer un événement | Page `/admin/events` : bouton **`+ Nouvel événement`** (avec multi-départs initiaux et verrou anti double-publish `409`), actions **Publier / Passer brouillon**, **Archiver / Réactiver** (`archived`), et **Supprimer** (autorisé uniquement si aucune réservation/billet n'existe) | `GET /api/admin/events`, `POST /api/admin/events`, `PATCH /api/admin/events/:id`, `DELETE /api/admin/events/:id` (`409` si places réservées) |
| Gérer les photos d'un événement | Upload multiple à la création, ajout ou suppression (`×`) sur les événements existants | `POST /api/admin/events/:id/poster`, `DELETE /api/admin/events/:id/poster` |
| Gérer les départs par commune | Page `/admin/events`, onglet dédié **`Départs`** (sélection de l'événement + ajout rapide) ou bouton inline sur chaque carte d'événement | `POST /api/admin/events/:id/convoys`, `GET /api/admin/convoys/:id/passengers` |
| Consulter la file des paiements & recevoir les alertes Push | Page `/admin/payments` (`AdminPayments`) avec bouton **« Alertes Push nouveaux paiements »**, rafraîchissement temps réel automatique à chaque dépôt de preuve client, et aperçu de la capture R2 | `GET /api/admin/payments`, `GET /api/admin/payments/:id/proof` + WebSocket / Web Push `admin_proof_submitted` |
| **Valider un paiement Wave en 1 clic** | Sur `/admin/payments`, cliquer sur **« Valider le paiement »** *(nécessite `payments:verify`)* | `POST /api/admin/payments/:id/confirm` — active les billets (`valid`), vérifie l'unicité de `wave_transaction_ref`, écrit dans `audit_logs` et notifie le client en temps réel + Web Push |
| **Rejeter un paiement Wave** | Sur `/admin/payments`, saisir un motif et cliquer sur **« Rejeter »** *(nécessite `payments:verify`)* | `POST /api/admin/payments/:id/reject` — annule les billets, **restitue les places réservées**, écrit dans `audit_logs` et notifie le client en temps réel + Web Push |
| Scanner les QR codes (Aller & Retour) | Page `/admin/scanner` (`AdminScanner`) : sélecteur **« Contrôle Aller / Entrée »** vs **« Contrôle Retour (Convoi) »**, caméra (`BarcodeDetector`) ou saisie manuelle, vibration haptique et **historique de session** | `POST /api/admin/tickets/scan` (`{ qr_token, direction }`) — validation atomique en 2 temps (`outbound_used_at` puis `return_used_at`), journalisé dans `audit_logs` + signal temps réel `ticket_scanned` vers le client |

---

## 4. Super Administrateur (`role: "super_admin"`)

Le super administrateur dispose automatiquement de **tous les droits administrateur** (y compris `payments:verify`), plus :

| Action | Comment | Détails techniques |
|---|---|---|
| Initialisation du 1er Super Admin | Automatique à la première inscription ou connexion | Variable/secret `BOOTSTRAP_SUPER_ADMIN_EMAIL` dans `workers/api` : promeut l'email correspondant uniquement s'il n'existe encore aucun `super_admin` en base (`audit_logs`: `super_admin.bootstrap`) |
| Gérer les comptes, rôles et permissions | Page `/admin/users` (`AdminUsers`) — la propre ligne du Super Admin connecté est protégée (`Vous`) contre l'auto-rétrogradation ou l'auto-désactivation | `GET /api/super-admin/users`, `PATCH /api/super-admin/users/:id` (`role`, `permissions` dont `payments:verify`, `is_active`), journalisé dans `audit_logs` |
| Consulter les journaux d'audit | Page `/admin/users` (section *Journaux d'audit récents*) | `GET /api/super-admin/audit-logs` (100 dernières opérations sensibles) |

---

## 5. Automates système (Cron `*/5 * * * *` & Queue Cloudflare)

* **Rappel avant expiration (`T - 30 min`)** : `sendExpiringOrderReminders` (`workers/api/src/services/orders.ts`) détecte les commandes `pending_payment` expirant dans moins de 30 minutes (`expiry_reminder_sent_at IS NULL`), marque `expiry_reminder_sent_at` de façon atomique et envoie une alerte `order_expiring_soon` (in-app + WebSocket + Web Push).
* **Expiration des commandes non payées (`2h`)** : `expirePendingOrders` passe les commandes `pending_payment` échues (`expires_at <= now`) en `expired`, annule leurs billets `pending`, restitue les places réservées, écrit `order.expire` dans `audit_logs` et notifie le client (`order_expired`). Les commandes `under_review` restent gelées.
* **Rattrapage Transactional Outbox** : `flushNotificationOutbox` rejoue avec backoff exponentiel toute entrée `notification_outbox` restée en statut `pending`.
* **Livraison asynchrone Web Push (`workers/web-push`)** : consomme la Queue `push-notifications` (DLQ `push-notifications-dlq`), élague automatiquement de D1 les abonnements expirés (`404` / `410`) et réessaie sur `429` / `5xx`. Voir `dev/NOTIFICATIONS_REALTIME.md`.

---

## 6. Fonctionnalités implémentées (par module)

| Module | État | Détails de ce qui est en place |
|---|---|---|
| **Authentification & Rôles** | Implémenté | Better Auth (`emailAndPassword`) sur D1, champs `phone` (`409` explicite si doublon), `commune`, `role`, `permissions`, `is_active`, bootstrap auto du 1er `super_admin`, traduction française des erreurs et protection pré-hydratation sur `/auth`. |
| **Événements, Catégories & Favoris** | Implémenté | Catégories extensibles, prix unique `events.price_xof`, vues admin par onglets (`Événements`, `Catégories`, `Départs`, `Nouvel événement`), anti double-publish `409`, archivage (`archived`), suppression sécurisée (bloquée si réservations), liste de souhaits client (`/wishlist`). |
| **Départs par commune (Convois)** | Implémenté | Départ(s) obligatoire(s) à la création (`55` places par défaut), ajout via onglet dédié ou carte, tri déterministe de la grille et des puces selon la commune du client, distinction par `meeting_point` si plusieurs départs d'une même commune. |
| **Billetterie & Commandes** | Implémenté | Réservation atomique des capacités (`D1.batch` + rollback compensatoire), TTL 2h, persistance du panier dans `sessionStorage` avant connexion, barre mobile `sticky bottom-0` sans masquer le footer, détail événement/commune sur `/orders` et `/orders/[id]`. |
| **Paiements Wave & Vérification** | Implémenté | Lien `pay.wave.com/m/<id>/c/ci?amount=<montant>` + QR code Wave, preuve par ID Wave et/ou capture R2, validation admin en 1 clic ou rejet avec restitution des places, unicité de `wave_transaction_ref`. |
| **QR Codes, Reçus & Double Scan** | Implémenté | Billets perforés dans `/tickets` avec modale QR accessible (`role="dialog"`, `Escape`), téléchargement reçu officiel en **Image PNG** ou **PDF**, scanner `/admin/scanner` **Aller (1/2)** / **Retour (2/2)** atomique avec mise à jour live du portefeuille client. |
| **Notifications Temps Réel & Web Push** | Implémenté | Architecture 3 Workers (`web` → `api` → `web-push`), Transactional Outbox D1 (`007`), Durable Object `UserRealtimeHub` (WebSocket Hibernation), Cloudflare Queues `push-notifications` + DLQ (`web-push@4` + `nodejs_compat`), PWA `/manifest.webmanifest` + `/sw.js` (`BroadcastChannel`), cloche `NotificationBell`, rappel `T - 30 min`, désinscription auto au logout (`dev/NOTIFICATIONS_REALTIME.md`). |
| **Administration & Audit** | Implémenté | Dashboard KPIs, gestion des paiements en temps réel, événements/catégories/départs, scanner QR, gestion des rôles/permissions (`payments:verify`, auto-protection Super Admin) et `audit_logs`. |
| **Design System & Architecture** | Implémenté | Monorepo Bun, Service Bindings `API` et `WEB_PUSH` (`cloudflare:workers`), `packages/utils` (`tryCatch`, `Result`, `isUniqueConstraintError`), UI blanc pur / `slate-200` / vert émeraude responsive (`grid-cols-1 min-w-0`, cibles tactiles `≥ 44px`), police `Satoshi-Variable`, tests Vitest E2E. |
