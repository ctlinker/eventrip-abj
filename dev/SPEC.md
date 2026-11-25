# EVENTRIP-ABJ
## Cahier des charges fonctionnel

**Version :** 0.2 — Cadrage fonctionnel  
**Type de produit :** Application web de billetterie et de gestion de convois  
**Périmètre :** Côte d'Ivoire

---

## 1. Présentation générale

EVENTRIP-ABJ est une plateforme web destinée à la commercialisation et à la gestion de tickets pour des événements, ainsi qu'à l'organisation de convois de transport associés à ces événements.

La plateforme permet aux utilisateurs de créer un compte, consulter les événements disponibles, commander des tickets, effectuer leur paiement et retrouver leurs billets depuis leur espace personnel.

Elle met également à disposition une interface d'administration permettant de gérer les événements, les commandes, les paiements, les tickets et les opérations de contrôle d'accès.

Une attention particulière est accordée à la vérification des paiements : contrairement à un système entièrement automatisé, EVENTRIP-ABJ repose sur un processus de validation manuelle effectué par des administrateurs disposant des autorisations nécessaires.

## 2. Objectifs du projet

Les objectifs principaux sont :

- Centraliser la vente de tickets pour différents événements.
- Simplifier le processus de commande et de paiement.
- Permettre le suivi des paiements et la vérification des justificatifs.
- Faciliter la gestion des convois et des points de rassemblement.
- Garantir l'authenticité et la traçabilité des tickets.
- Faciliter le contrôle d'accès grâce à un système de QR codes.
- Fournir aux administrateurs des outils de supervision et de gestion.

## 3. Acteurs et gestion des accès

La plateforme distingue trois catégories d'utilisateurs.

### 3.1. Client

Le client est un utilisateur disposant d'un compte personnel.

Il peut :

- Créer un compte et se connecter.
- Consulter les événements disponibles.
- Consulter les informations relatives aux événements.
- Sélectionner une catégorie de tickets.
- Commander un ou plusieurs tickets.
- Consulter les instructions de paiement.
- Effectuer son paiement.
- Transmettre une capture d'écran comme justificatif.
- Consulter le statut de ses paiements.
- Accéder à ses tickets et à leurs QR codes.
- Consulter son historique de commandes.

### 3.2. Administrateur

L'administrateur est un utilisateur disposant d'un accès à l'interface de gestion.

Les administrateurs travaillent à l'échelle de la plateforme et ne sont pas affectés individuellement à des événements.

Ils peuvent, selon leurs permissions :

- Créer et modifier des événements.
- Configurer les catégories de tickets et leurs tarifs.
- Consulter les commandes.
- Consulter les paiements.
- Examiner les justificatifs transmis par les clients.
- Vérifier les transactions reçues.
- Confirmer ou rejeter les paiements, si cette permission leur est accordée.
- Scanner les QR codes.
- Consulter les informations relatives aux tickets.
- Contrôler les entrées.
- Consulter l'historique de leurs opérations.

### 3.3. Super administrateur

Le super administrateur dispose des privilèges de gestion globale.

Il peut :

- Créer, modifier et désactiver les comptes administrateurs.
- Attribuer les permissions aux administrateurs.
- Autoriser ou retirer le droit de validation des paiements.
- Superviser les opérations financières.
- Consulter les statistiques générales.
- Consulter les journaux d'activité.
- Superviser les événements et les opérations de billetterie.

La validation des paiements constitue une permission spécifique et ne doit pas être accordée automatiquement à tous les administrateurs.

---

## 4. Gestion des événements

La création des événements est réservée aux administrateurs.

Chaque événement doit comporter les informations suivantes :

- Nom de l'événement.
- Description.
- Affiche ou image de présentation.
- Date et heure.
- Lieu de l'événement.
- Informations complémentaires.
- Catégories de tickets disponibles.
- Tarification.
- Quantité de tickets disponibles.

Un événement peut proposer plusieurs catégories de tickets, chacune possédant ses propres caractéristiques et son propre tarif.

L'administrateur doit pouvoir :

- Créer un événement.
- Modifier les informations d'un événement.
- Publier ou dépublier un événement.
- Définir les périodes de commercialisation.
- Configurer les quantités disponibles.
- Consulter les ventes associées à l'événement.

## 5. Gestion des commandes et de la billetterie

### 5.1. Création d'une commande

Le client sélectionne un événement, une catégorie de tickets et une quantité.

La plateforme crée une commande contenant notamment :

- Une référence unique.
- L'identité du client.
- L'événement concerné.
- La catégorie de tickets.
- Le nombre de tickets.
- Le montant total.
- La date de création.
- Le statut de la commande.

Une commande peut contenir plusieurs tickets.

### 5.2. Génération anticipée des tickets

Les tickets sont générés dès la création de la commande, avant la confirmation du paiement.

Chaque ticket possède :

- Un identifiant unique.
- Un QR code.
- Une référence de commande.
- Les informations relatives à l'événement.
- Sa catégorie.
- Son statut.

Le ticket généré initialement possède un statut provisoire.

**Important :** la génération d'un ticket ne constitue pas une preuve de paiement et ne donne pas automatiquement accès à l'événement.

Le QR code reste inutilisable tant que le paiement n'a pas été confirmé.

### 5.3. Statuts des tickets

| Statut | Description |
|---|---|
| En attente | Ticket généré, paiement non confirmé |
| Valide | Paiement confirmé, ticket utilisable |
| Utilisé | Ticket déjà présenté à l'entrée |
| Annulé | Ticket invalidé |

---

## 6. Gestion des paiements

### 6.1. Principe général

Le paiement constitue une étape distincte de la création de la commande.

La plateforme prévoit l'utilisation de Wave comme moyen de paiement, notamment à travers les liens de paiement directs.

Cependant, le modèle opérationnel retenu pour cette première version repose sur une validation manuelle des paiements.

### 6.2. Parcours de paiement

1. Le client crée une commande.
2. La plateforme génère les tickets associés avec un statut provisoire.
3. La plateforme présente les instructions de paiement et le lien Wave correspondant, lorsque disponible.
4. Le client effectue le règlement.
5. Le client transmet une capture d'écran de la transaction.
6. Le paiement apparaît dans l'interface d'administration comme étant en attente de vérification.
7. Un administrateur disposant des autorisations nécessaires examine le justificatif.
8. L'administrateur vérifie la transaction et confirme ou rejette le paiement.
9. En cas de confirmation, les tickets associés passent au statut valide.

### 6.3. Vérification manuelle

L'interface d'administration doit proposer un espace dédié à la vérification des paiements.

Chaque paiement doit présenter :

- La référence de la commande.
- Le nom du client.
- Le montant attendu.
- La date de la commande.
- Le numéro de téléphone associé, si disponible.
- La capture d'écran du justificatif.
- Le statut de vérification.

L'administrateur doit pouvoir consulter le justificatif et effectuer les vérifications nécessaires.

La validation doit permettre de rattacher une transaction réelle à une commande.

Lorsqu'une transaction est confirmée, elle ne doit plus pouvoir être utilisée pour justifier un autre paiement.

### 6.4. Statuts des paiements

| Statut | Description |
|---|---|
| En attente | Paiement déclaré, non vérifié |
| Confirmé | Paiement vérifié et accepté |
| Rejeté | Paiement refusé après vérification |

Toute modification du statut doit être enregistrée dans l'historique des opérations.

### 6.5. Sécurité et traçabilité

La plateforme doit conserver :

- L'identité de l'administrateur ayant effectué la validation.
- La date et l'heure de l'opération.
- L'ancien et le nouveau statut.
- La référence de la transaction associée.
- Le motif du rejet, le cas échéant.

Une transaction déjà utilisée pour confirmer une commande ne doit pas pouvoir être réutilisée.

---

## 7. Gestion des convois

La plateforme doit également permettre la commercialisation et la gestion des places dans les convois organisés pour certains événements.

Un convoi représente un service de transport associé à un événement.

### 7.1. Informations d'un convoi

Un convoi peut comporter :

- Un événement associé.
- Un nom ou une désignation.
- Une date de départ.
- Un lieu de rassemblement.
- Une destination.
- Une indication de trajet (aller simple ou aller-retour).
- Un tarif.
- Une capacité maximale.
- Des informations complémentaires.

### 7.2. Commande d'une place

Le client peut sélectionner un convoi disponible et commander une ou plusieurs places.

La commande doit préciser :

- Le convoi choisi.
- Le nombre de places.
- Le type de trajet.
- Le point de rassemblement.
- Le montant total.

La commande suit le même processus de paiement et de validation que les tickets d'événements.

### 7.3. Gestion des places

L'administrateur doit pouvoir :

- Créer un convoi.
- Modifier les informations d'un convoi.
- Définir sa capacité.
- Consulter les réservations.
- Suivre les paiements associés.
- Consulter la liste des passagers.
- Consulter les tickets de transport.

La capacité d'un convoi ne doit pas être dépassée.

---

## 8. Contrôle d'accès et scanner QR

La plateforme doit intégrer un scanner accessible depuis l'interface d'administration.

Le scanner permet de lire les QR codes des tickets d'événements et des convois.

### 8.1. Processus de vérification

Lorsqu'un QR code est scanné :

1. L'application identifie le ticket.
2. Le serveur vérifie son existence.
3. Le serveur vérifie son statut.
4. Le serveur vérifie que le ticket n'a pas déjà été utilisé.
5. Le serveur enregistre la validation lorsque toutes les conditions sont réunies.
6. L'application affiche le résultat du contrôle.

### 8.2. Résultats possibles

- **Valide :** le ticket est accepté et marqué comme utilisé.
- **En attente :** le paiement n'a pas été confirmé.
- **Déjà utilisé :** le ticket a déjà été présenté.
- **Invalide :** le ticket n'existe pas ou a été annulé.

La validation doit être atomique côté serveur afin d'empêcher qu'un ticket soit accepté plusieurs fois, y compris lors de scans simultanés.

---

## 9. Interface d'administration

L'interface d'administration doit centraliser les opérations de gestion.

### 9.1. Tableau de bord

Le tableau de bord doit présenter :

- Nombre total de commandes.
- Nombre de paiements en attente.
- Nombre de paiements confirmés.
- Montant total des paiements confirmés.
- Nombre de tickets générés.
- Nombre de tickets valides.
- Nombre de tickets utilisés.
- Nombre de places vendues dans les convois.

Les statistiques doivent pouvoir être consultées globalement et, lorsque pertinent, par événement.

### 9.2. Gestion des paiements

Une page dédiée doit permettre de consulter les paiements sous forme de liste.

Chaque entrée doit présenter les informations essentielles :

- Date et référence.
- Événement ou convoi.
- Client.
- Montant.
- Statut.
- Justificatif.
- Actions disponibles selon les permissions.

### 9.3. Gestion des utilisateurs

L'interface doit permettre de consulter les comptes clients et administrateurs.

Pour les administrateurs, elle doit également permettre de gérer les permissions.

---

## 10. Gestion des notifications

La plateforme doit informer les utilisateurs des événements importants.

### Notifications clients

- Confirmation de création de commande.
- Instructions de paiement.
- Confirmation de réception d'un justificatif.
- Confirmation ou rejet du paiement.
- Disponibilité des tickets.

### Notifications administrateurs

- Nouvelle commande.
- Nouveau justificatif de paiement.
- Paiement en attente de vérification.
- Événement nécessitant une intervention administrative.

Les notifications pourront être intégrées à l'application, avec des canaux complémentaires à définir.

---

## 11. Exigences non fonctionnelles

### Sécurité

- Authentification des utilisateurs.
- Gestion des rôles et permissions.
- Protection des opérations sensibles.
- Validation des données côté serveur.
- Protection contre la réutilisation des transactions.
- Journalisation des opérations administratives.

### Fiabilité

- Cohérence des commandes et des paiements.
- Prévention des doubles validations.
- Gestion des erreurs lors des opérations de paiement.
- Conservation de l'historique des transactions.

### Accessibilité

- Interface responsive.
- Compatibilité avec les navigateurs mobiles.
- Utilisation simple sur smartphone.
- Interface de scan adaptée aux appareils mobiles.

### Performance

- Chargement rapide des pages.
- Consultation fluide des listes de commandes.
- Réponse rapide du scanner.
- Gestion efficace des images et justificatifs.

---

## 12. Règles métier fondamentales

Les règles suivantes constituent les invariants fonctionnels de la plateforme.

1. Une commande doit posséder une référence unique.
2. Une commande peut contenir plusieurs tickets.
3. Chaque ticket doit posséder un identifiant unique.
4. Un ticket peut être généré avant le paiement, mais ne peut être utilisé sans confirmation.
5. Seul un administrateur autorisé peut confirmer ou rejeter un paiement.
6. Une transaction confirmée ne peut pas être réutilisée pour une autre commande.
7. Un ticket ne peut être utilisé qu'une seule fois.
8. Toute validation de ticket doit être enregistrée.
9. Toute opération administrative sensible doit être traçable.
10. Le nombre de places vendues ne doit jamais dépasser la capacité configurée.

---

## 13. Périmètre fonctionnel de la première version

La première version doit se concentrer sur les fonctionnalités suivantes :

| Module | Fonctionnalités |
|---|---|
| Comptes | Inscription, connexion, profil |
| Événements | Création, modification, publication |
| Billetterie | Commandes, tickets, QR codes |
| Paiements | Wave, justificatifs, validation manuelle |
| Convois | Création, réservations, capacités |
| Scanner | Lecture et validation des QR codes |
| Administration | Tableau de bord, gestion des opérations |
| Permissions | Administrateurs et super administrateur |
| Notifications | Suivi des commandes et paiements |

---

## 14. Évolutions envisageables

Après la mise en production de la première version, plusieurs améliorations pourront être envisagées :

- Confirmation automatique des paiements via une intégration API Wave adaptée.
- Gestion de plusieurs moyens de paiement.
- Génération de reçus téléchargeables.
- Gestion avancée des organisateurs.
- Gestion des remboursements.
- Statistiques financières avancées.
- Gestion des manifestes de passagers.
- Attribution des places dans les véhicules.
- Application mobile dédiée aux contrôleurs.

---

**Fin du document — Cahier des charges fonctionnel EVENTRIP-ABJ, version 0.2.**