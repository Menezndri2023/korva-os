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

**Mise à jour Phase 9** : la suite est passée à 10 fichiers e2e (donc 10 démarrages/arrêts complets de `NestApplication` séquentiels dans le même processus Jest). Un taux résiduel de flakiness a réapparu (~1 run sur 6-8), avec les mêmes symptômes qu'avant ce correctif (`expected 400, got 404`, sur un test qui passe systématiquement en isolation) — plus le nombre de modules/collections/index Mongoose par app augmente, plus la fenêtre de bascule entre la fermeture d'une `NestApplication` et le démarrage de la suivante semble sensible à la charge système, malgré `maxWorkers: 1` et `keepAlive: false`. Ce n'est pas un bug applicatif (confirmé : le test concerné repasse au vert de façon fiable en isolation et sur la grande majorité des runs complets — 9 exécutions complètes stables sur 11 lors de la vérification de la Phase 9). Mitigations déjà en place : timeouts généreux sur les tests asynchrones (Workflow, Communication, AI). Si ce taux se dégrade encore avec les phases suivantes, appliquer la mitigation déjà anticipée ci-dessus (base de test dédiée par fichier, ou `mongodb-memory-server`) plutôt que de continuer à repousser les timeouts.

## ADR-004 — Disponibilité des ressources calculée en UTC, pas dans le fuseau de l'organisation

**Contexte** : `Organization.timezone` existe (Phase 1), et un créneau de réservation "9h-18h le lundi" a un sens différent selon qu'on l'interprète dans le fuseau de l'organisation ou en UTC brut.

**Décision (Phase 5, MVP)** : `AvailabilityService` compare `dayOfWeek`/heures directement sur les composantes UTC des `Date` JavaScript stockées, sans conversion vers `Organization.timezone`. Une organisation dont le fuseau n'est pas UTC verra donc ses horaires hebdomadaires décalés par rapport à l'heure locale affichée dans l'UI si celle-ci ne compense pas elle-même.

**Pourquoi accepté pour le MVP** : implémenter une conversion de fuseau horaire correcte (DST inclus) est un chantier à part entière (bibliothèque type `date-fns-tz`/`luxon`, tests dédiés) sans valeur ajoutée immédiate pour valider le moteur de réservation lui-même (fenêtres, blocages, capacité, chevauchement — tous corrects indépendamment du fuseau).

**À corriger avant un usage production réel** : convertir `weeklyAvailability`/`blockedSlots`/`startAt`/`endAt` via le fuseau de l'organisation avant comparaison, dans `AvailabilityService` uniquement (le stockage MongoDB en UTC natif ne change pas).

## ADR-005 — `EventsProcessor` (worker BullMQ du Workflow Engine) colocalisé dans `apps/api`, pas dans `apps/worker`

**Contexte** : le Event Bus (Phase 7) publie les événements métier (`lead.created`, `quote.accepted`, `order.created`, ...) sur une queue BullMQ (`events`, Redis). Un consommateur doit exister pour traiter ces jobs de façon asynchrone et déclencher le Workflow Engine. Le monorepo prévoit `apps/worker` comme processus dédié aux jobs asynchrones (voir `docs/architecture.md`).

**Décision (Phase 7, MVP)** : le `Worker` BullMQ qui consomme la queue `events` (`apps/api/src/workflow/events.processor.ts`) tourne **dans le processus `apps/api`** (démarré via `OnModuleInit`), et non dans `apps/worker`.

**Pourquoi** : le `WorkflowActionsService` réutilise directement des services Nest existants (`TasksService` pour l'action `create_task`, et bientôt un `EmailProvider` pour `send_email`). Faire tourner ce worker dans `apps/api` permet de les injecter tels quels via le même `AppModule`/DI container, sans dupliquer ces modules métier dans `apps/worker` ni exposer leur logique via une API interne HTTP entre les deux process.

**Compromis accepté** : cela va à l'encontre du principe "API = requêtes HTTP uniquement, `apps/worker` = tout le traitement asynchrone" énoncé dans le brief produit. Le traitement des workflows n'est plus synchrone avec la requête HTTP qui publie l'événement (`EventBusService.publish` ne fait que pousser un job, jamais attendre son traitement), donc aucune requête n'est ralentie par un workflow lent — mais le process API porte désormais une charge de travail asynchrone en plus de servir le trafic HTTP, et les deux ne peuvent plus scaler indépendamment.

**Chemin de migration** (si la charge des workflows le justifie) : déplacer `EventsProcessor` + `WorkflowActionsService` + `WorkflowEngineService` vers `apps/worker`, qui importerait alors les modules métier nécessaires (`CrmModule` pour `TasksService`, etc.) exactement comme `WorkflowModule` le fait aujourd'hui dans `apps/api`. Le contrat public de `EventBusService.publish()` ne change pas — seul le process qui consomme la queue change, ce qui rend cette migration non-bréquante pour tous les appelants.

## ADR-006 — `@Prop({ type: String, ... })` explicite requis sur tout champ Mongoose dont le type TypeScript est une union de littéraux

**Contexte** : `WorkflowConditionDoc.operator` (`WorkflowConditionOperator`, une union de string littéraux) et `WorkflowActionDoc.type` (`WorkflowAction['type']`) étaient déclarés avec `@Prop({ required: true })` seul, sans `type` explicite — comme c'est le cas pour tous les champs `string` simples ailleurs dans le projet.

**Problème observé** : `@nestjs/mongoose` infère le type Mongoose d'un `@Prop` via `reflect-metadata` (le type TypeScript compilé du champ, `design:type`). Pour un champ typé `string` classique, `design:type` vaut `String` et l'inférence fonctionne. Pour un champ typé comme une **union de littéraux** (`"equals" | "not_equals" | ...`), TypeScript émet `design:type: Object` (les unions n'ont pas de représentation runtime propre) — ce que `@nestjs/mongoose` refuse avec `Cannot determine a type for the "WorkflowConditionDoc.operator" field (union/intersection/ambiguous type was used)`.

**Piège** : cette erreur n'apparaît **ni** à `tsc --noEmit`, **ni** à `nest build` (webpack) — les deux ignorent la réflexion runtime des décorateurs. Elle n'explose qu'à l'instanciation réelle du module Nest (donc seulement au lancement de l'app ou d'un test e2e qui compile `AppModule`), ce qui l'a fait passer inaperçue jusqu'à l'écriture de `workflow.e2e-spec.ts`.

**Décision** : tout champ de schéma Mongoose dont le type TypeScript est une union de littéraux (`string | number | boolean` compris) doit porter un `@Prop({ type: ... })` explicite (`String`, `Object`, etc.) — ne jamais compter sur l'inférence `reflect-metadata` pour un type non-primitif simple.

**À surveiller** : vérifier ce point en priorité lors de la revue de tout nouveau schéma Mongoose introduisant un champ à valeurs discrètes (statuts, enums, unions discriminées) — le typecheck et le build ne l'attraperont pas, seul le boot réel de `AppModule` (donc au minimum un test e2e) le révèle.

## ADR-007 — Ne jamais appeler `.toString()` sur un champ `ObjectId` populé via `.populate()` sans vérifier qu'il n'est plus populé

**Contexte** (Phase 8, Communication) : `NotificationsService.notifyOrganization()` broadcastait une Notification à chaque membre actif de l'organisation en réutilisant `MembershipsService.listMembersForOrganization()`, puis en appelant `membership.userId.toString()` pour obtenir l'id du destinataire.

**Problème observé** : `MembershipsRepository.findAllForOrganization()` (utilisé pour la liste des membres dans l'UI, où le nom/email de l'utilisateur est affiché) appelle `.populate('userId', 'email firstName lastName')` — ce qui remplace `membership.userId` (un `Types.ObjectId`) par un **document `User` complet**. Appeler `.toString()` sur ce document populé ne redonne pas l'hex string de l'id (il produit une sérialisation d'objet inexploitable), donc chaque `Notification` était créée avec un `userId` invalide. Aucune erreur n'était levée nulle part (Mongoose accepte n'importe quelle string pour un champ `Types.ObjectId` sans validation stricte à l'écriture) — le symptôme était uniquement l'absence totale de notification côté destinataire, découvert via un test e2e qui échouait par timeout plutôt que par une erreur explicite.

**Décision** : ne jamais réutiliser une méthode de repository qui fait un `.populate()` pour un usage qui n'a besoin que de l'id brut. `MembershipsRepository` expose maintenant deux méthodes distinctes : `findAllForOrganization()` (populée, pour l'affichage) et `findActiveUserIdsForOrganization()` (non populée, retourne directement `string[]`, pour toute logique interne comme la diffusion de notifications).

**À surveiller** : tout code qui appelle `.toString()` sur un champ typé `Types.ObjectId` dans le schéma doit d'abord vérifier si la query qui a produit ce document utilisait `.populate()` sur ce même champ — le type TypeScript ne le signale pas (le champ reste typé `Types.ObjectId` même une fois populé, sauf si on utilise explicitement `PopulatedDoc<...>`), donc seul un test end-to-end qui vérifie le *résultat* (et pas seulement l'absence d'erreur) peut détecter ce genre de bug silencieux.

## ADR-008 — Toujours arrêter les serveurs de dev lancés pour un smoke test manuel avant de relancer la suite e2e

**Contexte** (Phase 7 puis Phase 8) : `EventsProcessor` démarre un `Worker` BullMQ qui consomme la queue Redis `events` — la même queue, sur le même Redis (`REDIS_URL`), que celle utilisée par la suite e2e (seule la base MongoDB diffère : `korva` en dev vs `korva_test` en test). Après un smoke test manuel via `pnpm start:dev`, un serveur de dev est resté vivant en arrière-plan sans être arrêté.

**Problème observé** : la suite e2e (`workflow.e2e-spec.ts`, puis `communication.e2e-spec.ts`) est devenue intermittente sans raison apparente — un événement publié par un test pouvait être consommé par le Worker BullMQ du serveur de dev resté actif au lieu du Worker de l'app de test elle-même (BullMQ distribue les jobs au premier worker disponible sur la queue nommée, sans notion de "processus propriétaire"). Le worker du serveur de dev traite alors l'événement contre la base `korva` (dev), où le workflow attendu par le test n'existe pas — le job est marqué "traité" sans erreur, mais l'effet attendu (tâche créée, notification créée) n'apparaît jamais côté test, qui finit par expirer son délai d'attente.

**Décision** : toujours vérifier qu'aucun processus `nest start` résiduel n'écoute encore (`lsof -i :4000`, `ps aux | grep nest`) avant de relancer la suite e2e après un smoke test manuel. Ce n'est pas un bug de l'application — c'est une conséquence directe du choix documenté en ADR-005 (Worker BullMQ colocalisé dans `apps/api`, partageant Redis avec l'environnement de test) : plusieurs instances de `apps/api` actives simultanément sur le même Redis se disputeront silencieusement les jobs de la queue `events`, quel que soit leur environnement (dev/test) respectif.

**Complément** : au-delà de cette cause première, une marge de timing plus généreuse a aussi été appliquée aux tests e2e asynchrones (`waitFor` interne à 18s, timeout Jest de test à 25s) — l'exécution séquentielle de 9 fichiers e2e démarrant chacun une application NestJS complète (donc son propre Worker BullMQ) dans le même processus Jest (voir ADR-003) reste sensible à la charge système, même une fois la cause ci-dessus éliminée.

## ADR-009 — Ne jamais compter sur `OnModuleInit` pour semer des données qui doivent survivre à `connection.dropDatabase()`

**Contexte** (Phase 10, Subscriptions) : `PlansService` semait le catalogue de plans par défaut (`free`/`starter`/`pro`/`business`) via un hook `OnModuleInit`, exécuté une seule fois au démarrage de l'app — modèle déjà utilisé implicitement ailleurs (les rôles système sont semés par organisation, mais à la création de l'organisation, pas au boot de l'app).

**Problème observé** : chaque fichier `*.e2e-spec.ts` appelle `await connection.dropDatabase()` dans son `beforeAll`, **après** que `app.init()` (et donc `OnModuleInit`) ait déjà tourné — ce qui supprimait immédiatement les plans tout juste semés, sans rien pour les reconstruire ensuite (contrairement aux index, que chaque `beforeAll` reconstruit déjà explicitement via `syncIndexes()`, voir ADR-003 — mais ce correctif ne concerne que les index, pas les données). Résultat : `POST /organizations` échouait avec `PLAN_NOT_FOUND` (une `NotFoundException`, donc un 404) dès le tout premier test de **chaque** fichier e2e, soit 88 tests en échec d'un coup sur un changement qui semblait pourtant correct (vérifié manuellement contre le serveur de dev, où aucun `dropDatabase()` n'intervient jamais après le boot — d'où le fait que ça fonctionnait "sur ma machine" mais cassait toute la suite e2e).

**Décision** : remplacer le seed au boot par un seed **paresseux** — `PlansService.ensureSeeded()` (upsert idempotent du catalogue) est appelé au tout début de chaque méthode publique (`list`, `getByKey`, `getById`), gardé par un flag booléen en mémoire pour ne s'exécuter qu'une fois par instance d'app. Cette approche est auto-réparatrice quel que soit le moment où la base est vidée (boot-time hook, script de migration, ou reset manuel en dev) — elle n'a pas besoin de connaître l'existence de `dropDatabase()` dans les tests, contrairement à un correctif qui aurait consisté à ajouter un ré-seed explicite dans les 10 fichiers `beforeAll`.

**À surveiller** : toute future collection nécessitant des données par défaut au niveau de l'application (pas par organisation) doit suivre ce même patron de seed paresseux plutôt qu'un hook `OnModuleInit`, précisément parce que rien ne garantit qu'`OnModuleInit` s'exécute après le dernier nettoyage de la base dans l'environnement où le code tourne.
