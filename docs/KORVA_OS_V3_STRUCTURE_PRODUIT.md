# KORVA OS — Structure produit V3 (proposition)

> Statut : **proposition à valider**, rien n'est implémenté. Rédigée le 2026-10-19 à partir du code
> réel (`packages/types/src/plan-tiers.ts`, `verticals.ts`, `catalog.ts`, `booking.ts`,
> `storefront-themes.ts`, dashboard `apps/web`, vitrine `apps/storefront`).
> Chaque section se termine par les décisions qui restent à prendre.

---

## 0. Le problème de structure aujourd'hui

Le produit est riche, mais il est organisé selon **trois axes qui se superposent** :

| Axe | Où il vit | Problème |
|---|---|---|
| 11 modules techniques (`crm`, `catalog`, `booking`…) | `KORVA_MODULES` | Ce sont des briques de code, pas des choses qu'un commerçant comprend |
| 4 produits (CRM / Inventory / Website / AI) | `PRODUCT_MODULES` + `productOverrides` | Un second système de vente, parallèle aux plans |
| 4 plans (Gratuit → Business) | `MODULE_MIN_PLAN` | Ils empilent des modules, ils ne racontent pas un parcours métier |
| 17 métiers | `VERTICAL_TEMPLATES` | Ils ne pilotent que l'onboarding, puis disparaissent : le métier est deviné à partir d'un texte libre (`Organization.type`) |

Conséquence : un coiffeur et une boutique de vêtements reçoivent **le même formulaire catalogue**,
**la même logique de site**, et choisissent entre des plans qui parlent de « modules ».

**Principe directeur proposé : le métier décide QUOI, le plan décide COMBIEN.**

- Le **métier** (via un *type d'activité*) détermine le type de site, le canal de vente principal,
  les champs du catalogue et les outils affichés.
- Le **plan** détermine le niveau : volume, paiement en ligne, automatisation, IA, équipe, marque.
- Les **4 produits** restent un langage marketing (pages du site korvasuite.com), pas un second
  système de facturation.

---

## 1. Modèle économique

### 1.1 Recommandation : freemium + abonnement + revenus d'usage

| Source de revenu | Rôle | Statut dans le code |
|---|---|---|
| **Abonnement mensuel/annuel** (4 plans) | Revenu principal, prévisible | Existe (4 plans × 5 devises) |
| **Facturation annuelle** (2 mois offerts) | Trésorerie + rétention | À ajouter |
| **Commission sur paiements en ligne** des clients finaux | Revenu qui grandit avec le succès du client | `Settlement` existe (étape 1), **non branché** au paiement |
| **Options payantes** : sièges supplémentaires, pack IA, pack SMS/WhatsApp, établissement supplémentaire | Monétiser sans forcer un changement de plan | `productOverrides` existe, aucun prix ni encaissement |
| **Mise en place assistée** (création du catalogue, photos, configuration) — forfait unique | Très demandé en Afrique de l'Ouest et au Maroc, finance l'acquisition | À créer (offre de service, pas de code) |

### 1.2 Ce qu'il ne faut PAS facturer

- **Le nombre de réservations ou de commandes.** Plafonner les ventes revient à punir le client qui
  réussit. Mieux vaut une commission, qui grandit avec lui.
- **Les sièges au prix fort.** Un siège ne coûte rien à KORVA. C'est un levier de montée en gamme,
  pas un centre de coût : il faut des paliers raisonnables et un siège supplémentaire à petit prix.
- **L'IA en illimité.** Déjà correctement plafonnée (`ai_messages_per_month`), à conserver.

### 1.3 Commission proposée (à valider une fois le paiement Flow B branché)

| Plan | Commission sur un paiement en ligne |
|---|---|
| Gratuit | pas de paiement en ligne (espèces / sur place / virement) |
| Starter | 1,5 % |
| Pro | 0,75 % |
| Business | 0 % |

C'est un argument de montée en gamme concret : « passez en Pro, vous payez moins de commission ».

**Décisions à prendre :** taux de commission ; annuel avec 2 mois offerts, oui ou non ; prix de la
mise en place assistée par marché.

---

## 2. Les types d'activité : le métier décide du site et des outils

Les 17 métiers actuels se regroupent en **8 types d'activité**. C'est le type d'activité, et non le
métier, qui pilote le produit. Le métier reste utile pour les suggestions (offres, textes, workflow
de départ).

| # | Type d'activité | Métiers actuels | **Type de site** | Canal de vente principal |
|---|---|---|---|---|
| A | **Boutique** | Commerce & e-commerce, Mode, Épicerie, Agriculture & vente directe | **Site e-commerce** (panier, paiement, livraison/retrait) | Commande |
| B | **Restauration** | Restaurant (+ traiteur) | **Menu en ligne + commande** (à emporter, livraison, sur place) + réservation de table | Commande + réservation de table |
| C | **Rendez-vous** | Salon & bien-être, Santé non médicale, Sport & fitness, Garde d'enfants & services à la personne | **Vitrine + prise de rendez-vous** | Réservation |
| D | **Hébergement** | Hôtellerie & tourisme | **Vitrine + réservation de séjours** (dates d'arrivée/départ) | Réservation multi-jours |
| E | **Formation** | Formation | **Académie** (catalogue de formations, sessions, inscriptions, espace apprenant) | Inscription |
| F | **Services sur devis** | Services professionnels, Artisanat & BTP, Agence digitale, Événementiel | **Vitrine + demande de devis** | Devis → facture |
| G | **Immobilier** | Immobilier | **Site d'annonces** (fiches biens + demande de visite) | Demande de visite / lead |
| H | **Association** | Association & ONG | **Vitrine + adhésion et dons** | Adhésion / don |

### 2.1 Règles

1. **Le type d'activité est un champ stocké** (`Organization.businessModel`, liste fermée des 8
   valeurs), choisi à l'onboarding. Aujourd'hui le métier est retrouvé par comparaison exacte du
   texte libre `Organization.type` (`verticalForOrganizationType`) : si le propriétaire modifie ce
   texte, son métier est perdu.
2. **Le type d'activité fixe le site par défaut** (template + sections affichées) et **le canal
   principal** mis en avant sur la page d'accueil du site.
3. **Un canal secondaire peut s'activer** sans changer de type d'activité. Exemples : un salon qui
   vend aussi des produits capillaires active « Boutique » ; un restaurant active « Réservation de
   table ». Le site garde alors son canal principal en tête et ajoute l'autre en section.
4. **Le dashboard n'affiche que les outils du type d'activité et des canaux activés.** Un artisan ne
   voit pas « Cuisine » ; un restaurant ne voit pas « Formations ». C'est déjà partiellement le cas
   via `enabledModules`, mais « Cuisine » et « Formations » sont des liens à part dans
   `dashboard/layout.tsx`.

### 2.2 Outils par type d'activité

✅ = activé par défaut · ➕ = activable · — = non pertinent

| Outil | A Boutique | B Resto | C RDV | D Héberg. | E Formation | F Devis | G Immo | H Asso |
|---|---|---|---|---|---|---|---|---|
| Catalogue | ✅ produits | ✅ menu | ✅ prestations | ✅ hébergements | ✅ formations | ✅ services | ✅ biens | ✅ adhésions/dons |
| Commandes & panier | ✅ | ✅ | ➕ | ➕ | ➕ | — | — | ✅ |
| Livraison / retrait | ✅ | ✅ | ➕ | — | — | — | — | — |
| Réservation | ➕ | ✅ table | ✅ | ✅ séjours | ✅ sessions | ➕ RDV | ✅ visites | ➕ |
| Cuisine (écran de préparation) | — | ✅ | — | — | — | — | — | — |
| Stock | ✅ | ➕ | ➕ | — | — | ➕ | — | — |
| Fournisseurs & bons de commande | ✅ | ✅ | ➕ | ➕ | — | ➕ | — | — |
| Devis | ➕ | ➕ traiteur | ➕ | ➕ groupes | ➕ entreprises | ✅ | ➕ | — |
| Factures | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ reçus |
| Projets & suivi du temps | — | — | — | — | — | ✅ | — | ➕ |
| Espace client (compte, historique) | ✅ | ✅ | ✅ | ✅ | ✅ apprenant | ✅ | ➕ | ✅ membre |
| Avis clients | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| Retours produits | ✅ | — | — | — | — | — | — | — |
| CRM (contacts, leads, affaires) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ pipeline | ✅ pipeline | ✅ membres |
| Campagnes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tickets support | ➕ | ➕ | ➕ | ➕ | ➕ | ✅ | ➕ | ➕ |

**Décisions à prendre :** valider les 8 types d'activité (fusionner Immobilier dans « Devis » ?) ;
liste des canaux secondaires autorisés par type.

---

## 3. Le catalogue : une fiche complète, adaptée au type d'offre

### 3.1 Constat dans le code (vérifié)

- **Les photos ne peuvent pas être ajoutées depuis le dashboard.** Le formulaire de création envoie
  `images: []` en dur (`apps/web/src/app/dashboard/catalog/page.tsx:68` et `:90`) et la fiche
  détail n'a aucun champ photo. Pourtant le site public **affiche** les photos
  (`BoutiqueTemplate`, `catalogue-client`, `offer-detail-client`) et l'upload existe déjà pour le
  logo (`uploadFile`, page Paramètres). **C'est le manque le plus visible du produit.**
- `attributes`, `isBundle`/`bundleItems`, `customFields` et `Category.attributeKeys` existent côté
  API mais **ne sont pas dans le formulaire**.
- **Une prestation n'a pas de durée.** `Offer` n'a aucun champ `durationMinutes` : c'est le client
  qui envoie `endAt` lors de la réservation. Une « Coupe femme — 45 min » ne peut pas être configurée
  comme telle.
- Pas de prix barré/promotionnel sur une offre (les codes promo existent au niveau de la commande).

### 3.2 Structure proposée : un socle commun + un bloc par type d'offre

**Socle commun à toutes les offres**

| Champ | Détail |
|---|---|
| Nom, description courte, description longue | La courte sert aux cartes du site, la longue à la fiche |
| **Photos** (plusieurs, réordonnables, une principale) | Upload direct, recadrage carré pour les cartes |
| Catégorie | Avec les attributs suggérés par la catégorie (`attributeKeys`) |
| Prix, devise, TVA | Existe |
| **Prix barré** (prix avant promotion) | Nouveau |
| Statut (brouillon / en ligne / archivé) | Existe |
| Visible sur le site · Mis en avant | Nouveau : distinguer « actif en interne » de « publié en ligne » |
| Lien de la fiche (slug) | Nouveau, pour le SEO |

**Blocs spécifiques, affichés selon le type d'offre**

| Type d'offre | Champs spécifiques |
|---|---|
| **Produit physique** (Boutique) | Référence (SKU), code-barres, marque, **variantes** (taille/couleur…) avec photo, prix et stock propres, suivi du stock + seuil d'alerte, **poids/dimensions** (frais de livraison), coût d'achat (marge), fournisseur principal |
| **Plat / article de menu** (Restauration) | **Options et suppléments** (cuisson, taille, ingrédients en plus, avec prix), **allergènes**, régime (végétarien, halal, sans gluten), niveau d'épice, temps de préparation, disponibilité (midi / soir / jours) |
| **Prestation sur rendez-vous** (Rendez-vous) | **Durée**, temps de battement avant/après, personnel qui la réalise, ressource nécessaire (cabine, salle), **acompte** (montant ou %), capacité (cours collectif), délai d'annulation gratuit |
| **Hébergement** | Capacité (adultes/enfants), prix par nuit, **séjour minimum**, heures d'arrivée/départ, équipements, nombre d'unités identiques |
| **Formation** | Programme (modules — existe dans `Course`), durée totale, niveau, prérequis, sessions/cohortes, places, format (présentiel / en ligne) |
| **Service sur devis** | Unité de prix (heure, jour, forfait, m²), mention « à partir de », zone d'intervention, délai indicatif |
| **Bien immobilier** | Vente / location, type de bien, surface, pièces, chambres, localisation (quartier, ville), loyer/prix + charges, disponibilité, galerie photos |
| **Adhésion / abonnement / don** | Périodicité, avantages inclus, montant libre (don), reçu automatique |
| **Produit numérique** | Fichier à télécharger ou lien d'accès, limite de téléchargements |
| **Pack / lot** | Offres incluses (`bundleItems`), **décrément du stock des composants** (absent aujourd'hui) |

**Mise en œuvre conseillée :** des champs typés pour ce qui pilote un comportement (durée, acompte,
séjour minimum, options de plat, poids), et `attributes`/`customFields` pour ce qui est purement
descriptif (marque, équipements, caractéristiques d'un bien). Le formulaire n'affiche que les blocs
du type d'offre choisi, et les types proposés dépendent du type d'activité.

**Décisions à prendre :** quels champs deviennent typés (proposition : durée, battement, acompte,
séjour minimum, options/suppléments, poids, prix barré, visible en ligne) ; nombre maximum de photos
par offre.

---

## 4. Les systèmes de vente : ce que « complet » veut dire

### 4.1 Réservation

| Fonction | État |
|---|---|
| Ressources (personne, salle, équipement), horaires hebdomadaires, indisponibilités, calendrier externe | ✅ existe |
| Statuts, rappels automatiques, présence, liste d'attente, capacité (séance collective) | ✅ existe |
| Statut de paiement (non payé / acompte / payé) | ✅ existe |
| **Durée portée par la prestation** | ❌ à ajouter (voir §3.1) |
| **Choix du personnel par le client** (« avec Awa ») | à vérifier côté site |
| **Politique d'annulation** (délai, acompte conservé) | ❌ |
| **Réservation sur plusieurs jours** (hébergement) | ❌ **bloquée** : `isWithinWeeklyWindows` refuse tout créneau qui passe minuit |
| **Réservation de table** (nombre de couverts, service midi/soir) | ❌ |
| Fermetures exceptionnelles et jours fériés au niveau de l'établissement | à vérifier |

### 4.2 Commande

| Fonction | État |
|---|---|
| Panier, commande, suivi public, retours, codes promo, liste d'envies, compte client | ✅ existe |
| Écran cuisine (restauration) | ✅ existe |
| Livraison | ⚠️ un seul tarif fixe (`shippingFlatRate`) |
| **Modes de réception** : livraison / retrait / sur place, chacun activable | ❌ |
| **Zones de livraison** avec frais et minimum de commande par zone | ❌ |
| **Créneaux de retrait ou de livraison** | ❌ |
| Options et suppléments dans le panier (restauration) | ❌ |
| Paiement en ligne des clients finaux | ⚠️ Paystack / Flutterwave branchés ; commission (`Settlement`) non branchée |

### 4.3 Facturation

Devis, factures, paiements et rappels existent. À ajouter : **reçus pour les associations** (dons,
cotisations) et **numérotation légale par pays** (FR, MA, zone UEMOA), à vérifier dans `finance`.

---

## 5. Les utilisateurs : séparer « qui se connecte » de « qui est réservé »

### 5.1 Constat

Aujourd'hui : 1 / 5 / 15 / illimité sièges. Un siège = un compte qui se connecte au dashboard.
Un salon de 4 coiffeurs en plan Gratuit est bloqué alors que seule la gérante utilise le dashboard,
parce que le personnel réservable et les comptes utilisateurs ne sont pas clairement distingués.

### 5.2 Proposition : trois notions distinctes

| Notion | Définition | Facturé ? |
|---|---|---|
| **Utilisateur** | Personne qui se connecte au dashboard (gérant, vendeur, comptable) | Oui, c'est le siège |
| **Membre de l'équipe** | Personne visible et réservable sur le site (coiffeur, coach, formateur) **sans compte** | Non (ressource) |
| **Accès limité** | Compte qui ne voit que son planning ou l'écran cuisine | Compté comme ½ siège, ou gratuit jusqu'à N |

C'est déjà techniquement possible (`Resource.membershipId` est **optionnel**). Il faut le rendre
explicite dans l'interface et dans la grille tarifaire.

### 5.3 Paliers proposés

| | Gratuit | Starter | Pro | Business |
|---|---|---|---|---|
| Utilisateurs inclus | 1 | 3 | 10 | 25 |
| Membres de l'équipe réservables (sans compte) | 3 | illimité | illimité | illimité |
| Utilisateur supplémentaire | — | 5 € / 1 500 XOF / 39 MAD | idem | idem |
| Établissements | 1 | 1 | 1 | 3 (+ supplément) |

Pourquoi Business passe d'illimité à 25 + supplément : « illimité » empêche de vendre à un réseau
de 80 personnes au juste prix, et ne coûte rien à retirer tant qu'aucun client n'est sur ce plan.

**Décisions à prendre :** paliers de sièges ; prix du siège supplémentaire par devise ; faut-il le
multi-établissement en Business.

---

## 6. Les plans, rangés par parcours

Chaque plan répond à une question du commerçant, dans l'ordre où il se la pose.

| | **Gratuit — Être visible** | **Starter — Vendre** | **Pro — Développer** | **Business — Piloter** |
|---|---|---|---|---|
| Promesse | « Mon activité en ligne en 10 minutes » | « Je me fais payer et je fais revenir mes clients » | « Je gagne du temps et je vends plus » | « Je gère plusieurs équipes ou plusieurs sites » |
| Prix EUR / XOF / MAD / CAD | 0 | 29 / 9 900 / 199 / 39 | 79 / 24 900 / 499 / 109 | 199 / 59 900 / 1 299 / 279 |

### 6.1 Contenu par famille d'outils

| Famille | Gratuit | Starter | Pro | Business |
|---|---|---|---|---|
| **Site** | Site du type d'activité, sous-domaine `sites.korvasuite.com/…`, mention « Propulsé par KORVA » | + **domaine personnalisé**, sans mention KORVA | + choix des palettes et polices, SEO avancé | + couleur de marque, plusieurs sites (établissements) |
| **Catalogue** | Fiche complète avec photos, **jusqu'à 30 offres** | Illimité, variantes, prix barré | + packs avec décrément de stock | idem |
| **Canal de vente** (réservation / commande selon le type d'activité) | Inclus, **paiement sur place uniquement** | + **paiement en ligne**, acomptes | + canal secondaire (ex. boutique pour un salon) | idem |
| **Clients (CRM)** | Contacts, historique, notes | + leads, affaires, pipeline | + scoring, attribution automatique, tickets | idem |
| **Facturation** | — | Devis, factures, relances | + abonnements récurrents clients | + multi-devises, export comptable |
| **Marketing** | — | Campagnes e-mail/WhatsApp, segments | + avis clients mis en avant, fidélité | idem |
| **Stock** | Suivi simple (quantité, alerte) | idem | + **multi-entrepôts, fournisseurs, bons de commande**, valorisation | idem |
| **Automatisations** | Le workflow de départ du métier | 5 workflows | Illimités | + webhooks, API |
| **IA** | — | — | 500 messages / mois | 2 000 messages / mois |
| **Équipe** | 1 utilisateur | 3 | 10 | 25 + supplément |
| **Commission paiement en ligne** | — | 1,5 % | 0,75 % | 0 % |
| **Support** | Centre d'aide | E-mail | E-mail + WhatsApp | Prioritaire + mise en place offerte |

### 6.2 Écarts avec la grille actuelle

| Changement | Aujourd'hui | Proposé | Raison |
|---|---|---|---|
| Limite d'offres au catalogue | aucune | 30 en Gratuit | Seul levier de volume qui ne pénalise pas les ventes |
| Mention « Propulsé par KORVA » | aucune | Gratuit uniquement | Acquisition gratuite, motive le passage en Starter |
| Paiement en ligne | indépendant du plan | à partir de Starter | Lie le premier euro payé au premier euro encaissé par le client |
| Multi-entrepôts / fournisseurs / BC | Gratuit (module `catalog`) | Pro | Fonction de structure plus grande, aujourd'hui donnée gratuitement |
| Nombre de workflows | illimité partout | 1 / 5 / illimité | `plan-tiers.ts` signale lui-même ce plafond comme manquant |
| Sièges | 1 / 5 / 15 / ∞ | 1 / 3 / 10 / 25 + supplément | Voir §5 |

**Point technique important :** `plan-tiers.ts` pose une règle saine qu'il faut garder : *aucune
limite n'est affichée si le code ne l'applique pas*. Chaque nouvelle limite (offres, workflows,
mention KORVA, paiement en ligne par plan) exige son contrôle côté API **avant** d'apparaître sur la
page tarifs. Et un abaissement de limite touche des clients existants : il faut un traitement
pour les organisations déjà au-dessus (conserver l'existant, bloquer seulement les ajouts).

---

## 7. Feuille de route conseillée

Ordre guidé par ce qui débloque des ventes, pas par la taille du chantier.

| Ordre | Chantier | Pourquoi d'abord |
|---|---|---|
| 1 | **Photos dans le catalogue** (upload, ordre, photo principale) | Le site les affiche déjà ; sans elles, aucune boutique n'est crédible |
| 2 | **Formulaire catalogue par type d'offre** (§3.2) + durée des prestations | Rend chaque métier réellement utilisable |
| 3 | **Type d'activité stocké** (`businessModel`) + site et dashboard pilotés par lui | La colonne vertébrale du reste |
| 4 | **Commande complète** : modes de réception, zones, créneaux, options de plat | Boutique et restauration, les deux types les plus nombreux |
| 5 | **Utilisateurs vs membres réservables** + nouvelle grille de sièges | Débloque les salons et salles de sport en Gratuit |
| 6 | **Nouvelle grille de plans** avec les contrôles API correspondants | Une fois les fonctionnalités en place |
| 7 | **Réservation multi-jours** (hébergement) et **réservation de table** | Débloque 2 métiers aujourd'hui mal servis |
| 8 | **Commission sur paiements en ligne** (brancher `Settlement`) | Second revenu, dépend d'un PSP plateforme actif |

---

## 8. Récapitulatif des décisions

**Validé le 2026-10-19 :**
- L'ensemble de la proposition (principe directeur, 8 types d'activité, fiche catalogue, sièges,
  plans par parcours, feuille de route).
- Les 4 produits **restent vendables à la carte** en plus des plans (on garde `productOverrides`,
  il faudra lui donner un prix et un encaissement).
- Le **paiement en ligne est réservé aux plans payants**.
- **Commission par plan** : 1,5 % Starter, 0,75 % Pro, 0 % Business.
- **Multi-entrepôts et fournisseurs / bons de commande passent en Pro.**

**Plan Gratuit resserré (validé le 2026-10-19)** — il sert à se montrer et à recevoir des
demandes ; encaisser, organiser et fidéliser relèvent des plans payants :

| Reste en Gratuit | Passe en Starter |
|---|---|
| Site du métier sur sous-domaine, mention « Propulsé par KORVA » | Domaine personnalisé, sans mention |
| Catalogue de 30 offres avec photos | Catalogue illimité, variantes, prix barré |
| Un seul canal : celui du type d'activité | Canal secondaire |
| Paiement sur place uniquement | Paiement en ligne |
| Contacts clients + historique | Leads, affaires, pipeline |
| Rappels de rendez-vous automatiques | Campagnes, segments |
| Workflow de départ du métier, non modifiable | Création de workflows |
| Tableau de bord simple | Statistiques complètes |
| — | Espace client du site (compte, historique, avis, liste d'envies, retours) |
| — | Écran cuisine |
| 1 utilisateur, 3 membres réservables | 3 utilisateurs, membres illimités |

**Essai Pro de 14 jours à l'inscription (validé)**, puis retour en Gratuit sans paiement. Rien
n'est effacé au retour : seuls les ajouts au-delà des limites sont bloqués. Même règle pour les
organisations existantes (dont `freeworld` en production) au moment du resserrement.

**Encore ouvert :** le prix du siège supplémentaire par devise, l'annuel et la mise en place
assistée.

Liste initiale :

1. Valider le principe « le métier décide quoi, le plan décide combien » et les **8 types d'activité**.
2. Les 4 produits deviennent-ils **uniquement un langage marketing** (fin des `productOverrides`
   vendus séparément), ou garde-t-on la vente à la carte en option ?
3. **Paliers de sièges** et prix du siège supplémentaire.
4. **Limite d'offres** en Gratuit (30 ?) et mention « Propulsé par KORVA ».
5. **Paiement en ligne réservé aux plans payants**, oui ou non.
6. **Taux de commission** par plan.
7. **Multi-entrepôts / fournisseurs** déplacés en Pro, oui ou non.
8. Facturation **annuelle** et prix de la **mise en place assistée**.
