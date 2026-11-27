# EVENTRIP-ABJ — Audit UX/UI & Draft de Redesign

> Basé sur l'analyse de l'application actuelle (`workers/web`) et aligné sur la direction artistique définie dans [assets/guide.md](../assets/guide.md) ainsi que les maquettes de référence `assets/1.jpg` et `assets/2.jpg`.

---

## 1. Audit de l'existant (UI & UX)

### 1.1. Identité visuelle & Hiérarchie (UI)
* **Surcharge de vert pâle ("mint wash")** : l'interface actuelle applique `border-green-100/200` et `bg-green-50/40` sur presque tous les conteneurs, champs de formulaire et pieds de page. Cela dilue le contraste au lieu d'offrir la base **blanc pur + gris ardoise subtil (`slate-100/200`) + accents vert franc (`#10b981` / `#16a34a`)** visible sur `1.jpg` et `2.jpg`.
* **Absence de signature graphique** : le hero actuel est un simple bloc de texte sur dégradé vert pâle, sans motifs géométriques (**bandes hachurées diagonales / sphères flottantes**) ni illustration vectorielle (**navette/bus cartoon graffiti**).
* **Anatomie des cartes d'événements perfectible** :
  * Le badge de catégorie (`Concert live`, `Séminaire`…) est actuellement placé dans le corps du texte à côté de la date, au lieu de **flotter à cheval sur le bord supérieur gauche de la carte** (cf. `2.jpg` : `OUTDOORS`, `MUSIC`, `TECH`).
  * Le bas de carte n'utilise qu'une petite flèche `→` au lieu d'un vrai bouton d'action explicite (**« Réserver »** / **« Prendre mon billet »**) face au prix mis en valeur (`2.jpg`).
  * Les puces de départ affichent `Cocody · 55/55` sans unité, ce qui prête à confusion (*55 restantes* vs *55 occupées*).

### 1.2. Parcours & Frictions d'usage (UX)
* **Découverte & Filtrage éclatés (`/`)** :
  * Pas de recherche textuelle (nom d'événement / lieu).
  * Les filtres (catégories + commune) sont dans un encadré séparé sous le hero au lieu d'une **barre de recherche unifiée segmentée** dans le hero (`[ Rechercher… | Commune ▾ | Catégorie ▾ | Rechercher ]` comme sur `1.jpg` et `2.jpg`).
* **Tunnel de commande sur mobile (`/events/[slug]`)** :
  * Sur smartphone (`< 1024px`), le récapitulatif et le bouton **« Commander maintenant »** tombent tout en bas de la page après la description et toutes les communes. Il manque une **barre d'action collante en bas d'écran (sticky bottom CTA)** sur mobile.
  * **Perte de sélection à la connexion** : un visiteur non connecté qui choisit sa commune et 3 billets puis clique sur « Commander » est redirigé vers `/auth`, mais perd son choix de commune et sa quantité au retour.
* **Suivi & Paiement Wave (`/orders/[id]`)** :
  * Les champs `<input type="file">` (justificatif Wave client et photos admin) utilisent le rendu natif brut sans zone de dépôt claire ni prévisualisation miniature avant envoi.
  * Pas de bouton « Copier » sur la référence de commande ou le code billet.
* **Portefeuille « Mes billets » (`/tickets`)** :
  * Tous les QR codes sont affichés en grand simultanément, ce qui allonge fortement la page dès 3–4 billets. Une présentation en **billet perforé compact** avec ouverture du QR plein écran au clic (+ boutons `Image` / `PDF`) est plus lisible et conforme au principe *No Clutter* de `guide.md`.
* **Back-office Admin (`/admin/*`)** :
  * `/admin/payments` affiche encore le statut technique brut `under_review` / `pending_payment` au lieu de libellés lisibles.
  * `/admin/scanner` manque d'un historique des 5 derniers scans de la session et d'un retour haptique (`navigator.vibrate`) utile sur le terrain lors de l'embarquement d'un car de 55 places.
  * Plusieurs champs de formulaire admin n'ont pas d'attributs `id` / `name` associés à leurs `<label>`.

---

## 2. Draft du Redesign (aligné sur `assets/guide.md`, `1.jpg` & `2.jpg`)

### 2.1. Système de Design (Tokens & Motifs)
* **Couleurs** :
  * Surface principale : `#FFFFFF` (blanc pur).
  * Surfaces secondaires : `#F8FAFC` (`slate-50`) pour le bandeau des départs sous l'image et les fonds neutres.
  * Bordures : `#E2E8F0` (`slate-200/80`) au repos ; `#16A34A` (`green-600`) au focus / élément sélectionné.
  * Accent primaire (Vert pur) : `#10B981` → `#16A34A` (boutons CTA, puce commune du client, indicateurs actifs).
  * Texte : `#0F172A` (`slate-900`) pour les titres/prix, `#64748B` (`slate-500`) pour les métadonnées.
* **Typographie (`Satoshi-Variable`)** :
  * Titre Hero : `font-extrabold tracking-tight` (`36px` mobile → `52px` desktop).
  * Prix carte : `text-xl font-extrabold text-slate-900`.
  * Badges catégories flottants : `text-[11px] font-bold uppercase tracking-wider`.
* **Motifs hachurés diagonaux ("bandes hachurées" style Tailwind)** :
  * Classe utilitaire `.bg-hatched-green` (`repeating-linear-gradient(-45deg, rgba(22,163,74,0.09) 0 1.5px, transparent 1.5px 10px)`).
  * Utilisée dans :
    1. **Sphères décoratives flottantes** (`rounded-full bg-hatched-green`) en arrière-plan du Hero et des sections.
    2. **Séparateur de section fin** (`h-3 w-full border-y border-slate-100 bg-hatched-green`) entre le Hero et la grille d'événements.

---

### 2.2. Nouveau Hero & Navette Cartoon en boucle (`/` — `index.astro`)

```text
+-----------------------------------------------------------------------------------+
|  [BusIcon] EVENTRIP-ABJ         Explorer   Mes commandes   Mes billets   [Sign In]|
+-----------------------------------------------------------------------------------+
|  (sphère hachurée)                                            (sphère hachurée)   |
|   Votre billet pour la                     ,-----------------------------.         |
|  prochaine aventure.                     |  [o] [o] [o] [o]  |¯\       |         |
|  Événement + convoi aller-retour,        |   GO!  [ FEST ]   |  \______|         |
|  réservés au même endroit.               '--((O))--------------((O))---'         |
|                                         ~~~~~~~~ route verte animée ~~~~~~~~      |
|  [ 🔍 Rechercher... | 📍 Départ (Commune) ▾ | 🏷️ Catégorie ▾ | ( Rechercher ) ]  |
+-----------------------------------------------------------------------------------+
|///////////////////////// séparateur bande hachurée ///////////////////////////////|
+-----------------------------------------------------------------------------------+
```

* **Barre de navigation épurée** :
  * Logo `EVENTRIP-ABJ` (accent vert pur + icône navette minimaliste), liens centrés avec état actif souligné/coloré, bouton `Connexion` vert plein à droite (`1.jpg` / `2.jpg`).
* **Barre de recherche unifiée flottante** (`rounded-2xl bg-white p-2 shadow-lg shadow-slate-200/60 border border-slate-200`) :
  * Segment 1 : Recherche texte (`Titre ou lieu…`).
  * Segment 2 : Sélecteur `Commune de départ` (pré-rempli avec la commune préférée du client).
  * Segment 3 : Sélecteur `Catégorie` (`Toutes`, `Concert live`, `Séminaire`…).
  * Bouton vert `Explorer` (filtre instantané côté client, `0` requête réseau supplémentaire).
* **Illustration SVG 2D « Cartoon Event Shuttle »** :
  * Navette vectorielle compacte avec stickers graphiques statiques (`FEST`, `ABJ`, `225`, éclaboussures colorées maîtrisées) posée sur une arche verte (`1.jpg`).
  * **Animation CSS légère et continue (60 fps, GPU-only)** : rotation douce des roues + léger rebond de suspension (`translateY` 2px) + défilement subtil des tirets de route, désactivée automatiquement si `prefers-reduced-motion`.

---

### 2.3. Nouvelle Carte d'Événement (`EventsCatalog.tsx`)

Inspirée directement de `2.jpg` + `guide.md` §3 :

```text
     .------------.
   .-| CONCERT    |--------------------------------------.  <-- Badge flottant à cheval (-top-3 left-4)
   | '------------'                                      |
   |              [ Image / Carrousel 16:10 ]            |
   |                                                     |
   |-----------------------------------------------------|
   | [📍 Cocody • 13/55 rés.] [📍 Yopougon • 0/55 rés.]  |  <-- Bandeau départs (slate-50, puces rectangulaires)
   |-----------------------------------------------------|
   |  Abidjan Music Night                                |
   |  20 déc. 2026 • Assinie-Mafia                       |
   |                                                     |
   |  15 000 FCFA                        [  Réserver  ]  |  <-- Prix fort à gauche + CTA vert à droite
   '-----------------------------------------------------'
```

1. **Badge de catégorie flottant hors-cadre** : positionné en `absolute -top-3 left-4 z-20`, fond blanc, bordure `slate-200`, ombre légère, typographie majuscule `tracking-wider`.
2. **Bandeau des départs sous l'image** (`bg-slate-50 border-y border-slate-100`) :
   * Puces rectangulaires arrondies (`rounded-lg`) affichant clairement la commune et le ratio de places (`42/55 dispo` — ou vert plein si c'est la commune sélectionnée par le client), avec défilement doux si plusieurs communes.
3. **Pied de carte orienté conversion** :
   * Prix en gras à gauche (`15 000 FCFA`) et bouton vert `Réserver` à droite.

---

### 2.4. Améliorations UX ciblées sur les autres écrans

1. **Fiche Événement (`/events/[slug]`)** :
   * Ajout d'une **barre fixe mobile en bas d'écran** (`fixed bottom-0 inset-x-0 lg:hidden`) affichant `Départ choisi + Total FCFA + bouton Commander`.
   * Sauvegarde automatique `{ slug, convoyId, quantity }` dans `sessionStorage` avant redirection vers `/auth` pour restaurer le panier immédiatement après connexion.
2. **Commande & Paiement Wave (`/orders/[id]`)** :
   * Zone d'upload stylisée (dropzone pointillée + aperçu miniature de la capture Wave sélectionnée avant envoi).
   * Bouton « Copier la référence » en 1 clic.
3. **Mes Billets (`/tickets`)** :
   * Design « Billet d'accès » épuré avec encoches latérales et ligne pointillée : résumé clair par défaut, bouton **« Afficher le QR »** (modale plein écran haute luminosité pour le contrôle d'accès) + actions directes **« Image »** et **« PDF »**.
4. **Back-office Admin (`/admin/*`)** :
   * Harmonisation des bordures en `slate-200` (vert réservé aux états actifs et CTA principaux).
   * Traduction des statuts bruts dans `/admin/payments` (`En revue`, `En attente`, `Confirmée`, `Rejetée`).
   * Ajout d'un compteur/historique des derniers scans dans `/admin/scanner` + vibration mobile sur validation/erreur.

---

## 3. Découpage proposé pour l'implémentation

* **Étape A — Fondations visuelles & Hero + Catalogue (`/`)** :
  * Tokens CSS + `.bg-hatched-green`, refonte `Navbar` + `Layout`, composant `CartoonShuttle.tsx` animé en boucle, Hero avec barre de recherche segmentée, et nouvelles cartes d'événements à badges flottants (`2.jpg`).
* **Étape B — Tunnel Client (`/events/[slug]`, `/auth`, `/orders`, `/tickets`)** :
  * Barre mobile sticky + persistance du panier à la connexion, dropzone avec aperçu sur `/orders/[id]`, billets perforés avec modale QR sur `/tickets`.
* **Étape C — Polish Back-office Admin (`/admin/*`)** :
  * Surfaces neutres `slate`, statuts traduits sur `/admin/payments`, labels accessibles `id`/`for`, et historique de session sur `/admin/scanner`.
