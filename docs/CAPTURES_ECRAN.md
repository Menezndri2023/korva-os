# Captures d'écran automatiques

Photographie chaque écran principal (tableau de bord par métier et par formule, administration,
sites publics) en **clair**, **sombre** et **téléphone**, et relève au passage les pages qui
affichent une erreur ou en écrivent une dans la console du navigateur. À relancer après un
changement visuel, avant de dire qu'un écran est prêt.

Tout se passe en local, sur une base de démonstration séparée : `korva_screens`. Le script de
remplissage refuse toute autre base.

## 1. Démarrer la pile locale

MongoDB et Redis : `pnpm docker:up`. Puis les builds de production :

```
pnpm --filter api build && pnpm --filter web build && pnpm --filter storefront build
```

L'API sur la base de démonstration. L'adresse de la base est lue dans `apps/api/.env` et n'est
jamais tapée en ligne de commande :

```
cd apps/api && PORT=4000 PLATFORM_ADMIN_EMAILS=admin@screens.korva.test \
  DISABLE_BACKGROUND_WORKERS=true STOREFRONT_URL=http://localhost:3001 node -e "
const fs=require('fs');
const line=fs.readFileSync('.env','utf8').split('\n').find(l=>l.startsWith('MONGODB_URI='));
process.env.MONGODB_URI=line.slice(12).trim().replace('/korva?','/korva_screens?');
require('./dist/main.js');"
```

Le tableau de bord et les sites : `pnpm --filter web exec next start -p 3000` et
`pnpm --filter storefront exec next start -p 3001`.

## 2. Remplir la base de démonstration

Base vide d'abord (`korva_screens` uniquement), puis, depuis `apps/api`, avec la même
`MONGODB_URI` réécrite : `CREDENTIALS_FILE=/chemin/creds.json pnpm seed:screenshots`.

Une entreprise par métier : un salon et un hôtel en Pro, une boutique en Business avec deux
établissements et le thème premium Jade + Prestige, un restaurant, une académie, une agence
immobilière et une association en Starter, un cabinet de conseil en Gratuit, plus un
administrateur. Pour repartir d'une base vide : API arrêtée, `RESET=1` (même commande), puis API
démarrée et remplissage normal. Les mots de passe sont écrits dans `CREDENTIALS_FILE` (droits 0600), jamais
affichés.

## 3. Prendre les captures

Depuis `apps/web` : `CREDENTIALS_FILE=/chemin/creds.json OUT_DIR=/chemin/captures pnpm screenshots`

Résultat : `OUT_DIR/index.html` (planche de toutes les captures), un dossier par variante, et
`report.json` (les problèmes relevés). Le parcours atteint aussi une page de site par un **clic**,
pas seulement par un chargement direct : c'est ainsi que le blocage CSP des navigations côté client
a été trouvé le 2026-10-21.

L'API limite chaque adresse à 120 requêtes par minute ; le parcours attend et recharge la page
quand il atteint cette limite, d'où une durée de dix minutes environ.

## 4. Rejouer le parcours d'un client sur chaque site

Depuis `apps/web` : `CREDENTIALS_FILE=/chemin/creds.json OUT_DIR=/chemin/parcours node scripts/customer-journeys.mjs`

Sur le site de chaque entreprise, comme un client : trouver « Se connecter » dans l'en-tête
(ordinateur et téléphone), créer un compte, ouvrir chaque rubrique de l'espace client, se
déconnecter, se reconnecter, demander un nouveau mot de passe. Un site en formule Gratuit ne doit
proposer aucun compte. `ONLY=hotel,formation` rejoue seulement ces entreprises ; une pause de
20 s sépare deux sites (`PAUSE_MS`) pour rester sous la limite de requêtes de l'API.

