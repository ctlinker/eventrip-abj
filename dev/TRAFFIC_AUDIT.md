# EVENTRIP-ABJ — Audit complet des requêtes & du trafic utilisateur

> Analyse basée sur le code actuel de `workers/web` et `workers/api`.
> Rappel d'architecture : toute requête `/api/*` émise par le navigateur traverse **`workers/web`** (`src/pages/api/[...path].ts`) puis appelle **`workers/api`** via le Service Binding `API` (**1 appel `/api/*` = 1 invocation `web` + 1 invocation `api`**).

---

## 1. Requêtes effectuées à chaque navigation (chargement de page)

Le frontend utilise Astro en mode **SSR (`output: "server"`)** avec navigation multi-pages (`<a href="...">`).
À **chaque** chargement de page :
1. **Document HTML** : `1` requête SSR vers `workers/web`.
2. **Hydratation `Navbar` (`client:load`)** : `1` requête `GET /api/auth/get-session` (`1 web` + `1 api` + lookup session/user D1).
3. **Îlot de la page** : requêtes spécifiques listées ci-dessous.

*(Les bundles `/_astro/*.js|css` et la police `Satoshi-Variable.woff2` sont servis en statique par `ASSETS` avec cache navigateur.)*

| Page | HTML SSR (`web`) | Navbar (`api`) | Îlot page (`api`) | Médias R2 (`api`) | Total HTTP (hors cache) |
|---|---:|---:|---|---:|---:|
| `/` (`EventsCatalog`) | 1 | 1 (`get-session`) | `GET /api/events` (3 req D1) | `N` × `GET /api/media/posters/:key` *(cache 24h)* | **3 + N** |
| `/auth` (`AuthForm`) | 1 | 1 (`get-session`) | — | — | **2** |
| `/events/[slug]` (`EventCheckout`) | 1 | 1 (`get-session`) | `GET /api/events/:slug` (3 req D1) | `N` × `GET /api/media/posters/:key` *(souvent en cache depuis `/`)* | **3 + N** |
| `/orders` (`OrdersList`) | 1 | 1 (`get-session`) | `GET /api/orders` (auth + 1 SELECT D1) | — | **3** |
| `/orders/[id]` (`OrderDetail`) | 1 | 1 (`get-session`) | `GET /api/orders/:id` (auth + 5 SELECT D1) | — *(QR Wave généré en local JS)* | **3** |
| `/tickets` (`TicketsWallet`) | 1 | 1 (`get-session`) | `GET /api/tickets` (auth + 1 JOIN D1) | — *(QR billets générés en local JS)* | **3** |
| `/admin` (`AdminDashboard`) | 1 | 1 (`get-session`) | `GET /api/admin/dashboard` (auth + 3 SELECT D1) | — | **3** |
| `/admin/payments` (`AdminPayments`) | 1 | 1 (`get-session`) | `GET /api/admin/payments?status=pending` (auth + 1 JOIN D1) | — *(à la demande)* | **3** |
| `/admin/events` (`AdminEvents`) | 1 | 1 (`get-session`) | `GET /api/admin/events` (auth + 3 SELECT D1) | `M` miniatures R2 | **3 + M** |
| `/admin/scanner` (`AdminScanner`) | 1 | 1 (`get-session`) | — | — | **2** |
| `/admin/users` (`AdminUsers`) | 1 | 1 (`get-session`) | `GET /api/super-admin/users` + `GET /api/super-admin/audit-logs` | — | **4** |

---

## 2. Requêtes effectuées à chaque clic sur un bouton

### Actions sans aucune requête réseau (0 requête)
* Boutons `+` / `-` de sélection des quantités sur `/events/[slug]`.
* Flèches précédent/suivant et points du carrousel photo (`EventImageCarousel`).
* Clic sur **« Payer avec Wave »** (redirection externe vers `pay.wave.com`).
* Rendu des QR codes (paiement Wave et billets valides) : généré localement via `qrcode`.

### Actions déclenchant des requêtes

| Écran | Bouton / Action | Requêtes déclenchées | Total appels API |
|---|---|---|---:|
| `/auth` | **Se connecter** / **Créer un compte** | `POST /api/auth/sign-in` ou `sign-up` + redirection `/` *(recharge `/` : +2 API)* | **1** (+2 après redirect) |
| `Navbar` | **Se déconnecter** | `POST /api/auth/sign-out` + redirection `/` *(recharge `/` : +2 API)* | **1** (+2 après redirect) |
| `/events/[slug]` | **Commander maintenant** | `POST /api/orders` *(réservation atomique `D1.batch` + insert order/items/tickets/payment + notif)* + redirection `/orders/[id]` *(+2 API)* | **1** (+2 après redirect) |
| `/orders/[id]` | **Soumettre pour validation** | `POST /api/orders/:id/proof` *(1 écriture R2 si capture + update D1)* + `load()` (`GET /api/orders/:id`) | **2** |
| `/admin/events` | **Publier l'événement** | `POST /api/admin/events` + `POST .../categories` + (`POST .../poster` si photos) + `load()` (`GET /api/admin/events`) | **3 à 4** |
| `/admin/events` | **Publié / Brouillon** | `PATCH /api/admin/events/:id` + `load()` (`GET /api/admin/events`) | **2** |
| `/admin/events` | **Ajouter** (catégorie) | `POST /api/admin/events/:id/categories` + `load()` (`GET /api/admin/events`) | **2** |
| `/admin/events` | **Ajouter photos** / **Supprimer photo (`×`)** | `POST` ou `DELETE /api/admin/events/:id/poster` + `load()` (`GET /api/admin/events`) | **2** |
| `/admin/payments` | Filtres (`En attente`, `Confirmés`, etc.) | `GET /api/admin/payments?status=...` | **1** |
| `/admin/payments` | **Voir justificatif** | `GET /api/admin/payments/:id/proof` *(1 lecture R2, cache privé 5 min)* | **1** |
| `/admin/payments` | **Valider le paiement** / **Rejeter** | `POST .../confirm` ou `reject` *(update D1 + `audit_logs` + notif)* + `load()` (`GET /api/admin/payments`) | **2** |
| `/admin/scanner` | **Vérifier** (ou détection caméra QR) | `POST /api/admin/tickets/scan` *(UPDATE atomique D1 + `audit_logs`)* | **1** |
| `/admin/users` | Changement rôle / permission / actif | `PATCH /api/super-admin/users/:id` + `load()` (`GET users` + `GET audit-logs`) | **3** |

---

## 3. État du trafic généré par UN seul utilisateur

### A. Parcours client complet (de la visite jusqu'au billet valide)
Scénario : Accueil `/` → Inscription `/auth` → Fiche événement `/events/[slug]` → Commande → Page `/orders/[id]` + Envoi justificatif Wave → Consultation `/tickets` (après validation).

| Ressource | Volume pour 1 utilisateur | Détail |
|---|---:|---|
| **Pages HTML SSR (`workers/web`)** | **6 requêtes** | `/`, `/auth`, `/`, `/events/[slug]`, `/orders/[id]`, `/tickets` |
| **Appels API via `/api/[...path]`** | **14 requêtes** | 6× `get-session`, 1× `sign-up`, 2× `events` (liste+détail), 1× `POST orders`, 2× `GET orders/:id`, 1× `POST proof`, 1× `GET tickets` |
| **Invocations totales `workers/web`** | **~20 + N** | 6 HTML + 14 proxy API + `N` proxys d'images R2 (1ère visite) |
| **Invocations totales `workers/api`** | **~14 + N** | 14 appels API + `N` lectures d'affiches R2 (hors cache navigateur) |
| **Opérations R2** | **N lectures + 1 écriture** | `N` affiches sur `/` (cachées 24h ensuite) + 1 capture justificatif |
| **Requêtes D1** | **~30–35 requêtes** | ~6 lookups session, 4 auth/requireAuth, 6 catalogue, 2 batches commande, 7 suivi/tickets |

### B. Parcours admin type (création 1 événement + validation 10 paiements + scan 10 tickets)
* **Création événement + photos + 2 catégories** : ~8 appels API.
* **Validation de 10 paiements** : `1` chargement liste + `10` vues justificatifs + `10 × 2` (confirm + reload liste) = **~31 appels API**.
* **Scan de 10 tickets à l'entrée** : `1` chargement `/admin/scanner` + `10` scans = **11 appels API**.

---

## 4. Pistes d'optimisation concrètes (si le trafic augmente)

1. **Éviter le double saut `web → api` sur `/api/*` en production** :
   Actuellement chaque `/api/*` consomme 1 invocation `workers/web` + 1 invocation `workers/api`. En production, configurer une Route Cloudflare directe `eventrip.ci/api/* → worker api` supprime 100 % des invocations `workers/web` liées à l'API et aux médias.
2. **Mettre les affiches publiques sur un bucket/domaine R2 public (ou Cache API)** :
   Évite qu'une image d'événement (`GET /api/media/posters/:key`) ne déclenche des invocations Worker à chaque nouveau visiteur.
3. **Éviter le `load()` complet après mutation (`AdminPayments`, `AdminEvents`, `AdminUsers`)** :
   Mettre à jour l'élément concerné dans le state Preact à partir de la réponse `200 OK` divise par 2 les appels API sur les actions d'administration.
4. **Passer la session depuis Astro SSR vers `Navbar`** :
   Évite l'appel `GET /api/auth/get-session` côté client à chaque navigation (économie de **1 appel API par page vue**).
