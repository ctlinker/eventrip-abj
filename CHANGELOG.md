# Changelog — EVENTRIP-ABJ

Toutes les évolutions notables de ce projet sont documentées dans ce fichier.
Le format suit les conventions [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le versionnage sémantique (`SemVer`).

---

## [1.3.0] — 2026-11-27

### Ajouté
- **Worker Mail transactionnel (`workers/mail`)** :
  - Nouveau Cloudflare Worker dédié à l'envoi d'emails via **Resend** (`MAIL_FROM: "Eventrip <noreply@eventrip-abj.com>"`), relié à `workers/api` par Service Binding (`MAIL`) et partageant la base D1 (`DB`).
  - Migration `010_mail_quota_and_logs.sql` introduisant `mail_settings` (plafonds configurables, `100/jour` et `3 000/mois` par défaut, cooldown anti-spam de `5 min` par destinataire, interrupteur d'activation) et `mail_logs` (historique de délivrabilité sans stockage de jeton ni lien sensible).
  - Endpoints internes `GET /health` et `POST /send` bloquant automatiquement les dépassements de quota (`429 MAIL_QUOTA_EXCEEDED`), le spam répété par destinataire (`429 MAIL_COOLDOWN`) et les envois lorsque le service est suspendu (`503 MAIL_DISABLED`).
- **Récupération & changement de mot de passe (`packages/db`, `workers/api`, `workers/web`)** :
  - Intégration des hooks Better Auth `sendResetPassword` (`revokeSessionsOnPasswordReset: true`) et `onPasswordReset` avec prise en charge multi-origines (`eventrip-abj.com`, `*.app.github.dev`).
  - Nouvelles pages `/forgot-password` (`ForgotPasswordForm`) et `/reset-password` (`ResetPasswordForm`) ainsi que le lien **« Mot de passe oublié ? »** sur `/auth`.
  - Nouvelle page `/settings` (`SettingsPage` regroupant *Profil & Commune préférée* via `GET/PATCH /api/me`, *Mot de passe & Sécurité* via `ChangePasswordForm`, et *Notifications Push*) accessible depuis le menu compte de la `Navbar` (desktop & mobile) sans consommer de quota email Resend.
  - Amélioration de `NotificationBell` avec un bandeau d'avertissement ambre (*Notifications push désactivées* + bouton *Activer*) et une pastille indicatrice lorsque les alertes Push sont désactivées.
  - Traçabilité dans `audit_logs` des opérations `auth.password_reset` et `auth.password_change`.
- **Gestion des quotas mail & Inspecteur d'audit enrichi (`workers/api`, `workers/web`)** :
  - Nouvelles routes Super Admin : `GET /api/super-admin/mail-quota`, `PATCH /api/super-admin/mail-quota` (journalisé sous `admin.mail_quota_update`) et `GET /api/super-admin/mail-logs`.
  - Enrichissement de `GET /api/super-admin/audit-logs` avec jointure acteur (`actor_name`, `actor_email`, `actor_role`), recherche textuelle (`q`) et filtre par type d'entité (`entity_type`).
  - Refonte de `/admin/users` (`AdminUsers.tsx`) : jauges temps réel des quotas journalier/mensuel Resend, formulaire d'édition des plafonds, journal d'envoi d'emails filtrable et lignes d'audit dépliables affichant le diff JSON `old_state` / `new_state` et `metadata`.
- **Outillage & Documentation** :
  - Documentation de l'audit UI headless avec Playwright dans `AGENTS.md`.
  - Suite de tests unitaires et d'intégration dédiée aux quotas mail (`workers/mail/test/index.spec.ts`) et au parcours complet de réinitialisation (`workers/api/test/index.spec.ts`).

---

## [1.2.0] — 2026-11-26

### Ajouté
- **Révisions immuables d'événements et de convois (`009_event_convoy_revisions.sql`)** :
  - Historisation complète des modifications (`event_revisions`, `convoy_revisions`) et conservation du snapshot d'achat sur les billets existants (`purchase_snapshot`, indicateur `has_updates`).
  - Verrouillage de l'immutabilité du tarif (`price_xof`) dès qu'une commande existe sur l'événement.
  - Fonctionnalité **Clone & Archive** (`POST /api/admin/events/:id/clone-archive`) permettant de publier une nouvelle phase tarifaire en reportant automatiquement la capacité restante sans dupliquer les réservations actives.
  - Notifications automatiques aux détenteurs de billets lors de la mise à jour d'un lieu ou d'un horaire de rendez-vous.

---

## [1.1.0] — 2026-11-26

### Ajouté
- **Gestion dynamique des communes (`008_communes.sql`)** :
  - Table `communes` administrable depuis `/admin/events` (`POST /api/admin/communes`, anti-doublon `409`) et exposée publiquement via `GET /api/communes`.
- **Contenu Web** :
  - Mise à jour éditoriale de la section Hero de la page d'accueil.

---

## [1.0.0] — 2026-11-26

### Ajouté
- **Socle Billetterie & Convois EVENTRIP-ABJ** :
  - Catalogue d'événements, catégories personnalisables, favoris (`/wishlist`), départs par commune et réservation atomique avec TTL 2h (`packages/db`, `workers/api`, `workers/web`).
  - Paiement Wave assisté (lien profond + QR code, dépôt de justificatif R2 / référence Wave, gel d'expiration en `under_review`, validation/rejet admin avec permission `payments:verify`).
  - Portefeuille de billets QR perforés (`/tickets`), génération client de reçus PNG/PDF et scanner double contrôle Aller/Retour (`/admin/scanner`).
  - Notifications temps réel & Web Push (`workers/web-push`, Durable Object `UserRealtimeHub`, Cloudflare Queue `push-notifications` + Outbox transactionnelle D1, rappels `T - 30 min`).
  - Identité visuelle Or & Bleu Nuit, navigation mobile responsive avec compteur de preuves en attente et contact rapide WhatsApp (`CONTACT_NUM`).
