# EVENTRIP-ABJ — Notifications Temps Réel & Web Push (`NOTIFICATIONS_REALTIME.md`)

> Documentation technique et fonctionnelle du sous-système de notifications in-app, de synchronisation temps réel par WebSocket (Durable Objects) et de notifications système hors-ligne (Web Push / PWA).

---

## 1. Vue d’ensemble de l’architecture

Le système combine **quatre briques complémentaires** afin de garantir à la fois la durabilité métier, la réactivité instantanée lorsque l’application est ouverte, et la réception d’alertes système lorsque le navigateur ou le téléphone est en veille :

```
┌──────────────────┐   Service Binding   ┌───────────────────────┐   Service Binding   ┌──────────────────────────────┐
│   workers/web    │ ──────────────────► │      workers/api      │ ──────────────────► │       workers/web-push       │
│  Astro + Preact  │   /api/* + /ws      │  Hono + D1 + Outbox   │   WEB_PUSH (/ws,    │ Durable Object + Queue Cons. │
│  PWA + /sw.js    │ ◄────────────────── │  + Cron (*/5 * * * *) │   /publish, /vapid) │  UserRealtimeHub + web-push  │
└────────▲─────────┘     101 WebSocket   └───────────┬───────────┘                     └──────────────▲───────────────┘
         │                                           │                                                │
         │ Push RFC 8291 (FCM / APNs / Mozilla)      │ D1.batch (atomique)            Cloudflare Queue│
         │ + BroadcastChannel('eventrip-realtime')   ▼                                push-notifications (+ DLQ)
         │                                ┌──────────────────────┐                                    │
         └────────────────────────────────┤  D1 (eventrip-db)    ├────────────────────────────────────┘
                                          │ • notifications      │   Suppression auto sur 404 / 410
                                          │ • notification_outbox│
                                          │ • push_subscriptions │
                                          └──────────────────────┘
```

### Rôle de chaque composant

| Composant | Responsabilité |
|---|---|
| **D1 (`notifications`)** | Source de vérité des notifications in-app consultables depuis la cloche `NotificationBell`. |
| **D1 (`notification_outbox`)** | **Transactional Outbox** écrite dans le même `D1.batch(...)` que la mutation métier (`orders`, `payments`, `tickets`), empêchant toute perte d’événement entre commit SQL et publication réseau. |
| **D1 (`push_subscriptions`)** | Stockage des abonnements Web Push (`endpoint` unique, clés `p256dh` et `auth`) rattachés à chaque `user_id` (multi-appareils supporté). |
| **Worker `workers/api`** | Écrit dans l’Outbox, déclenche le flush non-bloquant via `executionCtx.waitUntil(...)`, expose les routes `/api/notifications*`, `/api/push/*` et proxifie l’upgrade `/api/realtime/ws` après authentification Better Auth. |
| **Worker `workers/web-push`** | Héberge le Durable Object **`UserRealtimeHub`** (1 instance par `user_id`, WebSocket Hibernation API) **et** le consumer de la Cloudflare Queue **`push-notifications`** (chiffrement VAPID / RFC 8291 via `web-push@4` + `fetch()` natif). |
| **Cron `*/5 * * * *` (`workers/api`)** | 1) Envoie le rappel `T - 30 min` avant expiration (`sendExpiringOrderReminders`), 2) expire les commandes `pending_payment` échues (`expirePendingOrders`), 3) rejoue les entrées `notification_outbox` restées en `pending` avec backoff exponentiel. |
| **PWA & Service Worker (`workers/web`)** | `manifest.webmanifest` + `/sw.js` : affiche la notification système OS, gère le clic (`notificationclick`), et relaye immédiatement le payload aux onglets ouverts via `BroadcastChannel('eventrip-realtime')` et `postMessage`. |

---

## 2. Schéma de données (`007_notifications_realtime_push.sql`)

Migration additive située dans `packages/db/migrations/007_notifications_realtime_push.sql` :

1. **`orders.expiry_reminder_sent_at` (`TEXT NULL`)** : horodatage garantissant l’idempotence stricte du rappel envoyé dans les 30 dernières minutes avant expiration d’une commande `pending_payment`.
2. **`push_subscriptions`** :
   - `id` (`TEXT PRIMARY KEY`), `user_id` (`REFERENCES "user"("id") ON DELETE CASCADE`),
   - `endpoint` (`TEXT UNIQUE NOT NULL`), `p256dh` (`TEXT NOT NULL`), `auth` (`TEXT NOT NULL`),
   - `user_agent`, `created_at`, `updated_at`, index `push_subscriptions_user_idx ("user_id")`.
   - En cas de réutilisation d’un même navigateur par un autre compte, `ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id` réattribue proprement l’appareil.
3. **`notification_outbox`** :
   - `id`, `user_id`, `notification_id` (`NULL` autorisé pour les signaux temps réel purs sans entrée boîte de réception),
   - `event_type`, `payload` (JSON), `push_enabled` (`0` ou `1`),
   - `status` (`'pending' | 'dispatched' | 'failed'`), `attempts`, `next_attempt_at`, `last_error`, `dispatched_at`, `created_at`.
   - Index `notification_outbox_pending_idx ("status", "next_attempt_at")`.

---

## 3. Matrice des événements et canaux déclenchés

| `event_type` | Destinataire | Déclencheur | Cloche In-App (`notifications`) | Temps réel WS (`UserRealtimeHub`) | Web Push OS (`PUSH_QUEUE`) | Action UI automatique |
|---|---|---|:---:|:---:|:---:|---|
| `order_created` | Client acheteur | `POST /api/orders` | Oui | Oui | Non *(utilisateur actif à l’écran)* | Badge `NotificationBell` |
| `proof_submitted` | Client acheteur | `POST /api/orders/:id/proof` | Oui | Oui | Non *(action directe du client)* | Badge `NotificationBell` |
| `admin_proof_submitted` | Admins actifs `super_admin` ou `payments:verify` | `POST /api/orders/:id/proof` | Oui | Oui | **Oui** | Recharge la file `/admin/payments` en direct |
| `payment_confirmed` | Client acheteur | `POST /api/admin/payments/:id/confirm` | Oui | Oui | **Oui** | Recharge `/orders/[id]`, `/orders` et `/tickets` (active les QR) |
| `payment_rejected` | Client acheteur | `POST /api/admin/payments/:id/reject` | Oui | Oui | **Oui** | Recharge `/orders/[id]` (affiche le motif), `/orders`, `/tickets` |
| `order_expiring_soon` | Client acheteur | Cron `*/5 * * * *` (`expires_at <= now + 30m`) | Oui | Oui | **Oui** | Recharge `/orders/[id]` + alerte mobile/desktop |
| `order_expired` | Client acheteur | Cron `*/5 * * * *` (`expires_at <= now`) | Oui | Oui | **Oui** | Recharge `/orders/[id]`, `/orders`, `/tickets` |
| `ticket_scanned` | Client porteur du billet | `POST /api/admin/tickets/scan` | Non *(signal pur)* | Oui | Non | Met à jour `Aller : Scanné ✓` / `Retour : Scanné ✓` en direct sur `/tickets` |

---

## 4. Endpoints API & Communication Inter-Workers

### Routes exposées par `workers/api` (toutes protégées par `requireAuth`)
- `GET /api/notifications` : liste les 50 dernières notifications de l’utilisateur connecté.
- `PATCH /api/notifications/:id/read` : marque une notification comme lue.
- `POST /api/notifications/read-all` : marque toutes les notifications non lues de l’utilisateur comme lues.
- `GET /api/push/vapid-key` : retourne `{ publicKey, enabled }` (via variable locale ou `WEB_PUSH -> GET /vapid-key`).
- `POST /api/push/subscribe` : valide et enregistre/met à jour `{ endpoint, keys: { p256dh, auth } }` dans `push_subscriptions`.
- `DELETE /api/push/subscribe` : supprime l’abonnement `{ endpoint }` de l’utilisateur courant (appelé notamment au logout).
- `GET /api/realtime/ws` : vérifie la session Better Auth et l’en-tête `Upgrade: websocket`, puis transfère la requête vers `WEB_PUSH` (`http://internal/ws?userId=<user.id>`).
  - **Point critique Hono** : cette route est montée **avant** le middleware `cors()` (et `cors()` ignore `Upgrade: websocket`) afin qu’Hono ne ré-enveloppe jamais la `Response` `101 Switching Protocols` (ce qui perdrait la propriété Cloudflare `.webSocket`).

### Routes internes de `workers/web-push` (appelées uniquement via Service Binding `WEB_PUSH`)
- `GET /health` : diagnostic santé du worker.
- `GET /vapid-key` : expose la clé publique VAPID configurée sur `web-push`.
- `GET /ws?userId=...` : ouvre une session WebSocket hibernable dans `USER_REALTIME_HUB.idFromName(userId)` (`setWebSocketAutoResponse('ping', 'pong')` géré à l’edge Cloudflare sans réveiller le DO).
- `POST /publish` : réveille le DO de `userId` et diffuse l’événement JSON à tous ses onglets connectés.
- `queue(batch, env)` : consomme `push-notifications` par lots de 25 max (`max_retries: 5`, `retry_delay: 60`, DLQ `push-notifications-dlq`) :
  - `2xx` : `msg.ack()`,
  - `404` / `410` : supprime l’`endpoint` mort de `push_subscriptions` dans D1 + `msg.ack()`,
  - `429` / `5xx` : `msg.retry({ delaySeconds })` avec backoff,
  - autres `4xx` : `msg.ack()`.

---

## 5. Sécurité, Confidentialité & Contraintes Navigateurs

- **Zéro secret métier dans les payloads Push/WS** : aucun `qr_token` ni donnée sensible n’est inclus dans `notification_outbox.payload` ; les écrans réactifs (`TicketsWallet`, `OrderDetail`, `AdminPayments`) utilisent le signal temps réel uniquement comme déclencheur pour relancer leur `GET` authentifié habituel.
- **Déconnexion propre (`Navbar.tsx`)** : un clic sur **Déconnexion** appelle `disableWebPush(false)` (`DELETE /api/push/subscribe`) et `disconnectRealtime()` avant `/api/auth/sign-out`, évitant toute fuite de notifications sur un navigateur partagé.
- **Opt-in contextuel (jamais au chargement de `/`)** : l’activation Web Push est proposée uniquement sur action explicite :
  1. dans le menu de la cloche `NotificationBell` (barre de navigation),
  2. sur `/orders/[id]` lorsqu’une commande est en `pending_payment` ou `under_review`,
  3. sur `/admin/payments` pour les vérificateurs Wave.
- **Particularité iOS / iPadOS (Safari 16.4+)** : Apple exige que l’application soit ajoutée à l’écran d’accueil (`display: "standalone"` via `/manifest.webmanifest`) avant d’autoriser `PushManager`. Le helper `isIosStandaloneRequired()` détecte ce cas et affiche une consigne dédiée en français.

---

## 6. Développement local & Déploiement Production

### En local (3 processus)
Les fichiers `.dev.vars` locaux (ignorés par Git, voir `workers/api/.dev.vars.example` et `workers/web-push/.dev.vars.example`) contiennent la paire VAPID de développement. `workers/web-push` partage l’état D1 local de `workers/api` via `--persist-to ../api/.wrangler/state` :

```bash
# 1. Worker Web Push + Durable Object UserRealtimeHub (:8788)
bun run --cwd workers/web-push dev

# 2. Worker API Hono + Outbox + Cron (:8787)
bun run --cwd workers/api dev --port 8787

# 3. Frontend Astro + proxy Vite HTTP/WS (:4321)
bun run --cwd workers/web dev
```

Pour simuler manuellement l’exécution du Cron (`T - 30 min`, expiration et rattrapage Outbox) en local :
```bash
curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"
```

### Déploiement Cloudflare (`eventrip-abj`)
Les Queues `push-notifications` et `push-notifications-dlq` sont créées sur le compte Cloudflare. Lors d’une mise en production :

```bash
# 1. Appliquer la migration 007 sur D1 distant
bun run --cwd packages/db db:migrate:prod

# 2. Configurer les secrets VAPID sur le worker web-push (1 seule fois)
bunx --cwd workers/web-push wrangler secret put VAPID_PUBLIC_KEY
bunx --cwd workers/web-push wrangler secret put VAPID_PRIVATE_KEY

# 3. Déployer dans l'ordre : web-push -> api -> web
bun run --cwd workers/web-push deploy
bun run --cwd workers/api deploy
bun run --cwd workers/web deploy
```
