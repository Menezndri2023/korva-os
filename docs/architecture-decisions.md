# Architecture Decisions — KORVA OS

Journal des décisions techniques importantes, au fil de l'implémentation (voir règle 13 du brief produit).

## ADR-001 — Packages partagés référencés en source TypeScript directe (pas de build intermédiaire)

**Contexte** : `packages/types`, `packages/validation`, `packages/ui` sont consommés directement via leur `src/*.ts` (le `package.json` pointe `main`/`types` sur le fichier source, pas sur un `dist/` compilé).

**Décision** : conserver cette approche (pas de step de build par package) pour la vitesse d'itération en développement — chaque app (Next.js, NestJS, worker) résout et type-check directement le code source des packages partagés.

**Conséquence découverte en Phase 1** : Node v26 exécute nativement les fichiers `.ts` (type-stripping) et applique, pour tout fichier utilisant la syntaxe `import`/`export`, une résolution de module de type ESM stricte — qui exige une extension explicite sur les imports relatifs (`./rbac.ts`, pas `./rbac`). Cela cassait `nest start --watch` (qui exécute `dist/main.js` via `node` nu, lequel `require()` en fait `@korva/types` → `packages/types/src/index.ts` en clair) avec `ERR_MODULE_NOT_FOUND`.

**Fix appliqué** :
- Tous les imports relatifs internes aux packages partagés utilisent désormais l'extension `.ts` explicite (`export * from "./rbac.ts"`).
- `allowImportingTsExtensions: true` activé sur les tsconfig des packages eux-mêmes (qui sont `noEmit: true`, condition requise par TypeScript pour ce flag).
- `rewriteRelativeImportExtensions: true` activé sur `apps/api/tsconfig.json` (a besoin d'un vrai `emit` — ce flag réécrit `.ts` → `.js` dans le JS compilé, satisfaisant à la fois Node au runtime et un build `tsc` réel).
- `allowImportingTsExtensions: true` activé sur `apps/web/tsconfig.json` et `apps/storefront/tsconfig.json` (`noEmit: true` chez Next.js, TypeScript n'y sert qu'au typecheck, le bundling réel est fait par Turbopack).

**À surveiller** : si un jour ces packages partagés passent à un vrai build (`dist/`), ces flags redeviennent inutiles et peuvent être retirés.

## ADR-002 — Cast explicite en `Types.ObjectId` pour toute query Mongoose sur un champ de référence

**Contexte** : dans cet environnement (Mongoose + Node v26), une query du type `Model.findOne({ organizationId: "<hex string>" })` sur un champ typé `Types.ObjectId` dans le schéma **ne cast pas automatiquement** la chaîne en `ObjectId` — la requête ne matche donc jamais aucun document, silencieusement (pas d'erreur, juste `null`/liste vide). Confirmé par un test isolé : le driver natif MongoDB avec un `ObjectId` explicite trouve le document ; le même `findOne` Mongoose avec une string ne le trouve pas, sur le même modèle/connexion.

**Impact** : ce n'est pas juste un bug fonctionnel — la chaîne de résolution du `TenantContext` (`MembershipsService.resolveTenantContext` → `MembershipsRepository.findByUserAndOrganization`) reposait sur ce même cast implicite. Le mode d'échec est heureusement "fail-closed" (accès refusé au lieu d'accepté), donc pas de faille de sécurité, mais l'isolation tenant elle-même ne fonctionnait pas du tout avant ce correctif.

**Décision** : dans tous les repositories, toute query Mongoose filtrant sur un champ de type `Types.ObjectId` avec une valeur reçue en `string` doit caster explicitement via `new Types.ObjectId(value)` — ne jamais compter sur le cast automatique de Mongoose dans ce projet. Les lookups par `_id` (`findById`, `findByIdAndUpdate`) restent inchangés (chemin de cast différent, vérifié fonctionnel).

**Tests de non-régression** : voir la suite d'isolation tenant (`docs/multi-tenancy.md`) — les tests d'accès croisé (organisation A ne peut pas lire/modifier/supprimer les données de l'organisation B) couvrent directement ce cas.

## ADR-003 — Suite e2e NestJS forcée en exécution séquentielle (`maxWorkers: 1`)

**Contexte** : chaque fichier `*.e2e-spec.ts` boote sa propre instance `NestApplication` mais tous partagent la **même** base MongoDB de test (`korva_test`, voir `apps/api/test/env.setup.ts`). Par défaut, Jest exécute les fichiers de test en parallèle dans des workers séparés.

**Problème observé** : avec l'exécution parallèle, un fichier appelant `connection.dropDatabase()` dans son `beforeAll` pouvait effacer les données qu'un AUTRE fichier de test venait de créer au même instant (ou ses index fraîchement construits), produisant des échecs non déterministes (`expected 201, got 403`, `text index required for $text query`, `Parse Error: Expected HTTP/...`).

**Décision** : `apps/api/test/jest-e2e.json` fixe `"maxWorkers": 1` — tous les fichiers e2e s'exécutent séquentiellement. En complément, chaque `beforeAll` qui appelle `dropDatabase()` reconstruit explicitement les index via `connection.modelNames().map(name => connection.model(name).syncIndexes())`, car `dropDatabase()` supprime aussi les index qu'autoIndex venait de construire à la connexion, et Mongoose ne les reconstruit pas automatiquement après coup.

**Deuxième cause trouvée en Phase 3** (`maxWorkers: 1` seul ne suffisait pas — un run à 4 fichiers e2e restait occasionnellement flaky avec `Parse Error: Expected HTTP/...` ou des 400 inattendus, alors que chaque fichier passait systématiquement en isolation) : chaque fichier crée sa propre `NestApplication` (donc son propre `http.Server` éphémère), mais tous tournent dans le **même processus Node** (un seul worker Jest). Le `http.globalAgent` de Node garde ses sockets en keep-alive par défaut — une socket ouverte pour le serveur éphémère d'un fichier pouvait être réutilisée par `supertest` pour une requête vers le serveur (différent) du fichier suivant après `app.close()`, produisant une réponse illisible/mal formée. Fix : `apps/api/test/env.setup.ts` force `globalAgent.keepAlive = false`, obligeant chaque requête à ouvrir une socket fraîche.

**Conséquence** : la suite e2e est plus lente (séquentielle, pas de keep-alive) mais fiable — 4 exécutions complètes consécutives à 30/30 tests stables, contre des échecs aléatoires et à symptômes différents à chaque fois auparavant. Si la suite grossit significativement, envisager soit une base de données dédiée par fichier de test (nom suffixé par le worker id), soit `mongodb-memory-server` pour une isolation complète par test.
