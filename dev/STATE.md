# EVENTRIP-ABJ — État fonctionnel & Guide par acteur (`STATE.md`)

> Ce document décrit l'état actuel de l'application (**v1.3.0**) telle qu'elle est implémentée dans `packages/db`, `packages/utils`, `workers/api`, `workers/web-push`, `workers/mail` et `workers/web` : ce que chaque acteur peut faire, par quelles pages UI et via quelles routes API.

---

## 1. Visiteur (non authentifié)

| Action | Comment (UI) | API correspondante |
|---|---|---|
| Explorer & rechercher des événements | Page d'accueil `/` (`EventsCatalog`) : Hero 2 colonnes avec navette cartoon animée, barre de recherche segmentée (`Mot-clé` sur titre/lieu/description, `Commune de départ`, `Catégorie`), tri prioritaire de la grille selon la commune choisie, badges de catégorie flottants et bandeau défilant des départs (`42/55 dispo`) | `GET /api/events`, `GET /api/event-categories`, `GET /api/communes` |
| Voir les photos/affiches d'un événement | Carrousel multi-photos (`EventImageCarousel`) sur les cartes et sur la fiche événement (sans imbrication `<button>` dans `<a>`) | `GET /api/media/posters/:key` (avec cache `ETag` / `304`) |
| Consulter le détail d'un événement & ses départs | Page `/events/[slug]` (`EventCheckout`) : tarif unique de l'événement (convoi A/R inclus), départs triés de façon déterministe selon la commune préférée | `GET /api/events/:slug` |
| Préparer une réservation avant connexion | Sur `/events/[slug]`, choisir sa commune et sa quantité : détection préalable de session sans erreur `401`, mémorisation dans `sessionStorage` et restauration automatique après connexion | `GET /api/auth/get-session` + stockage local |
| Créer un compte ou se connecter | Page `/auth` (`AuthForm`) : nom, téléphone unique (erreur `409` explicite en français si déjà utilisé), commune préférée dynamique (`GET /api/communes`), email, mot de passe | `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email` |
| Réinitialiser un mot de passe oublié | Lien **« Mot de passe oublié ? »** sur `/auth` → `/forgot-password` (`ForgotPasswordForm`) → réception d'un email transactionnel Resend (`noreply@eventrip-abj.com`) → `/reset-password?token=...` (`ResetPasswordForm`) | `POST /api/auth/request-password-reset` (via Service Binding `MAIL`), `POST /api/auth/reset-password` (`revokeSessionsOnPasswordReset: true`, journalisé `auth.password_reset`) |

---

## 2. Client (`role: "client"`)

Le client dispose de toutes les capacités du visiteur, plus :

| Action | Comment (UI) | API correspondante & Règles |
|---|---|---|
| Consulter / modifier son profil & commune préférée | Menu du compte (`Navbar`) → `/settings` (`SettingsPage`, section *Profil & Commune préférée*) : mise à jour `name`, `phone` (`409` si doublon) et `commune` | `GET /api/me`, `PATCH /api/me` (`name`, `phone` unique, `commune`) |
| Changer son mot de passe (session active) | Menu du compte (`Navbar`) → `/settings` (`SettingsPage`, section *Mot de passe & Sécurité* / `ChangePasswordForm`) avec option de révocation des autres sessions | `POST /api/auth/change-password` (**0 email consommé**, journalisé `auth.password_change` dans `audit_logs`) |
| Gérer sa liste de souhaits (Favoris) | Bouton cœur sur les cartes de `/` et sur `/events/[slug]`, plus page dédiée `/wishlist` (`WishlistPage`) accessible depuis **Favoris** dans la `Navbar` | `GET /api/wishlists`, `POST /api/wishlists/:eventId`, `DELETE /api/wishlists/:eventId` (état initial inclus dans `GET /api/events` et `GET /api/events/:slug` sans requête supplémentaire) |
| Commander ses billets (événement + convoi A/R) | Sur `/events/[slug]`, sélectionner sa commune de départ et le nombre de billets, puis cliquer sur **« Commander maintenant »** (ou barre `sticky bottom-0` sur mobile) | `POST /api/orders` (`{ convoy_id, quantity }`) — tarif unique `event.price_xof`, réservation atomique des places pendant **2 heures** (`pending_payment`), génération anticipée des billets (`pending` avec `purchase_snapshot`) + Outbox notification |
| Consulter son historique de commandes | Page `/orders` (`OrdersList`) affichant le titre de l'événement, la commune de départ, le nombre de billets, le statut et le montant (mise à jour temps réel auto) | `GET /api/orders` |
| Suivre une commande & copier la référence | Page `/orders/[id]` (`OrderDetail`) avec titre de l'événement, commune, badge statut, compte à rebours 2h, copie 1-clic de la référence et rafraîchissement automatique en temps réel | `GET /api/orders/:id` |
| Payer via Wave | Sur `/orders/[id]`, cliquer sur **« Payer avec Wave »** ou scanner le **QR code de paiement** généré localement | Lien `https://pay.wave.com/m/<merchantId>/c/ci?amount=<total_amount_xof>` |
| Transmettre sa preuve de paiement Wave | Sur `/orders/[id]`, saisir l'**ID de transaction Wave**, déposer une **capture d'écran** (dropzone avec miniature d'aperçu, <= 5 Mo), ou les deux | `POST /api/orders/:id/proof` — stocke la capture dans R2 (`proofs/...`), passe la commande en `under_review`, **gèle l'expiration** et notifie en temps réel + Web Push les admins `payments:verify` |
| Consulter ses billets, voir les mises à jour, afficher le QR & télécharger son reçu | Page `/tickets` (`TicketsWallet`) : billets perforés avec statut Aller/Retour (`Dispo` / `Scanné ✓` mis à jour en direct au scan), badge `has_updates` en cas de révision d'horaire/lieu post-achat (avec conservation du `purchase_snapshot`), modale accessible **« Afficher QR »** (`Escape` / focus), et téléchargement reçu officiel en **Image PNG** ou **PDF** (`jspdf`) | `GET /api/tickets` — `qr_token` masqué tant que `status !== 'valid'` ; reçus PNG/PDF générés 100 % côté client (`0` requête serveur) |
| Recevoir ses notifications en direct & activer Web Push | Cloche **`NotificationBell`** dans la `Navbar` (badge non-lu, pastille d'alerte & bandeau ambre *Notifications push désactivées → Activer* quand inactif, *Tout lu*) + section dédiée dans `/settings` + bannière opt-in sur `/orders/[id]` + PWA `/manifest.webmanifest` & `/sw.js` | `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `POST /api/notifications/read-all`, `GET /api/push/vapid-key`, `POST /api/push/subscribe`, `DELETE /api/push/subscribe`, `GET /api/realtime/ws` |

---

## 3. Administrateur (`role: "admin"`)

L'administrateur accède au back-office via le bouton **Admin** dans la barre de navigation (`/admin`). Toutes les mutations admin mettent à jour l'état local sans rechargement réseau redondant.

| Action | Comment (UI) | API correspondante & Permissions |
|---|---|---|
| Consulter les statistiques (KPIs) | Page `/admin` (`AdminDashboard`) : CA confirmé, paiements en attente/confirmés, commandes, billets générés/valides/utilisés, places convois | `GET /api/admin/dashboard` (filtrable par `?event_id=...`) |
| Gérer les catégories d'événements & les communes | Page `/admin/events`, onglets **`Catégories`** et **`Communes`** (ou création rapide) | `GET /api/admin/event-categories`, `POST /api/admin/event-categories`, `POST /api/admin/communes` (anti-doublon `409`) |
| Créer, réviser, cloner/archiver ou supprimer un événement | Page `/admin/events` + `AdminRevisionModals` : création multi-départs, édition versionnée (`event_revisions`, prix verrouillé `409` dès qu'une commande existe, notification dédupliquée des acheteurs), **Clone & Archive** pour nouvelle phase tarifaire, suppression (uniquement si 0 réservation) | `GET /api/admin/events`, `POST /api/admin/events`, `PATCH /api/admin/events/:id`, `GET /api/admin/events/:id/revisions`, `POST /api/admin/events/:id/clone-archive`, `DELETE /api/admin/events/:id` |
| Gérer les photos d'un événement | Upload multiple à la création, ajout ou suppression (`×`) sur les événements existants | `POST /api/admin/events/:id/poster`, `DELETE /api/admin/events/:id/poster` |
| Gérer & réviser les départs par commune | Page `/admin/events`, onglet dédié **`Départs`** ou actions sur chaque convoi (édition versionnée `convoy_revisions` du point de rencontre / horaire avec notification des passagers) | `POST /api/admin/events/:id/convoys`, `PATCH /api/admin/convoys/:id`, `GET /api/admin/convoys/:id/passengers` |
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
| Configurer les quotas & suivre les envois d'emails (Resend) | Page `/admin/users` (section **Quotas & Service Mail (Resend)**) : jauges temps réel jour/mois (`100/jour`, `3 000/mois` par défaut), édition des plafonds, délai anti-spam par destinataire (`cooldown_minutes`), interrupteur d'activation et journal `mail_logs` filtrable par statut | `GET /api/super-admin/mail-quota`, `PATCH /api/super-admin/mail-quota` (journalisé `admin.mail_quota_update`), `GET /api/super-admin/mail-logs` + `GET http://internal/health` sur `workers/mail` |
| Inspecter les journaux d'audit système en détail | Page `/admin/users` (section **Journaux d'audit système**) : recherche textuelle, filtre par type d'entité (`user`, `mail_settings`, `payment`, `order`, `ticket`, `event`, `convoy`) et **lignes dépliables** exposant l'acteur complet, `old_state`, `new_state` et `metadata` | `GET /api/super-admin/audit-logs?q=...&entity_type=...&limit=...` (jointure `user` sur `actor_id`) |

---

## 5. Automates système & Services dédiés

* **Rappel avant expiration (`T - 30 min`, Cron `*/5 * * * *`)** : `sendExpiringOrderReminders` (`workers/api/src/services/orders.ts`) détecte les commandes `pending_payment` expirant dans moins de 30 minutes (`expiry_reminder_sent_at IS NULL`), marque `expiry_reminder_sent_at` de façon atomique et envoie une alerte `order_expiring_soon` (in-app + WebSocket + Web Push).
* **Expiration des commandes non payées (`2h`, Cron `*/5 * * * *`)** : `expirePendingOrders` passe les commandes `pending_payment` échues (`expires_at <= now`) en `expired`, annule leurs billets `pending`, restitue les places réservées, écrit `order.expire` dans `audit_logs` et notifie le client (`order_expired`). Les commandes `under_review` restent gelées.
* **Rattrapage Transactional Outbox (`Cron */5 * * * *`)** : `flushNotificationOutbox` rejoue avec backoff exponentiel toute entrée `notification_outbox` restée en statut `pending`.
* **Livraison asynchrone Web Push (`workers/web-push`)** : consomme la Queue `push-notifications` (DLQ `push-notifications-dlq`), élague automatiquement de D1 les abonnements expirés (`404` / `410`) et réessaie sur `429` / `5xx`. Voir `dev/NOTIFICATIONS_REALTIME.md`.
* **Envoi d'emails transactionnels & Garde-fous Quotas (`workers/mail`)** : expose `POST /send` et `GET /health` via Service Binding `MAIL`, vérifie en base D1 (`mail_settings` + `mail_logs`) l'activation du service, le cooldown par destinataire et les plafonds journalier/mensuel UTC avant d'appeler Resend (`noreply@eventrip-abj.com`).

---

## 6. Fonctionnalités implémentées (par module)

| Module | État | Détails de ce qui est en place |
|---|---|---|
| **Authentification, Récupération & Rôles** | Implémenté | Better Auth (`emailAndPassword`) sur D1, récupération de mot de passe par email (`/forgot-password` → `/reset-password`) avec révocation des sessions, changement de mot de passe authentifié sans email (`/settings`), champs `phone` (`409` explicite), `commune`, `role`, `permissions`, `is_active`, bootstrap auto du 1er `super_admin`. |
| **Worker Mail & Quotas Resend** | Implémenté | Worker dédié `workers/mail` (`resend`, `MAIL_FROM: "Eventrip <noreply@eventrip-abj.com>"`), migration `010_mail_quota_and_logs.sql`, quotas jour/mois + cooldown destinataire + kill-switch administrables depuis `/admin/users`, journal `mail_logs` sans fuite de secrets. |
| **Événements, Révisions, Communes & Favoris** | Implémenté | Catégories et communes extensibles (`008`), révisions versionnées `event_revisions` / `convoy_revisions` (`009`), immuabilité du prix après commande, **Clone & Archive** pour changements tarifaires, archivage, suppression sécurisée, favoris client (`/wishlist`). |
| **Départs par commune (Convois)** | Implémenté | Départ(s) obligatoire(s) à la création (`55` places par défaut), édition versionnée avec alerte aux passagers, tri déterministe selon la commune préférée du client. |
| **Billetterie & Commandes** | Implémenté | Réservation atomique des capacités (`D1.batch` + rollback compensatoire), TTL 2h, `purchase_snapshot` sur chaque billet, persistance du panier dans `sessionStorage` avant connexion. |
| **Paiements Wave & Vérification** | Implémenté | Lien `pay.wave.com/m/<id>/c/ci?amount=<montant>` + QR code Wave, preuve par ID Wave et/ou capture R2, validation admin en 1 clic ou rejet avec restitution des places, unicité de `wave_transaction_ref`. |
| **QR Codes, Reçus & Double Scan** | Implémenté | Billets perforés dans `/tickets` avec modale QR accessible (`role="dialog"`, `Escape`), indicateur `has_updates`, téléchargement reçu PNG/PDF côté client, scanner `/admin/scanner` **Aller (1/2)** / **Retour (2/2)** atomique. |
| **Notifications Temps Réel & Web Push** | Implémenté | Transactional Outbox D1 (`007`), Durable Object `UserRealtimeHub` (WebSocket Hibernation), Cloudflare Queues `push-notifications` + DLQ, PWA `/manifest.webmanifest` + `/sw.js`, cloche `NotificationBell`, rappel `T - 30 min`. |
| **Administration & Audit enrichi** | Implémenté | Dashboard KPIs, paiements temps réel, événements/catégories/communes/départs, scanner QR, gestion des rôles/permissions, quotas mail et inspecteur `audit_logs` dépliable (`old_state` / `new_state` / `metadata` / acteur). |
| **Design System & Architecture** | Implémenté | Monorepo Bun (4 Workers : `web`, `api`, `web-push`, `mail`), Service Bindings (`API`, `WEB_PUSH`, `MAIL`), `packages/utils` (`tryCatch`, `Result`, `isUniqueConstraintError`), identité Or & Bleu Nuit, police `Satoshi-Variable`, suites Vitest + audits Playwright headless. |
