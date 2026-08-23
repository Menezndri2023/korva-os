# Sécurité — KORVA OS

Référencé depuis [api.md](api.md) (section "API keys") — créé en Phase 12 (Hardening). Complète [multi-tenancy.md](multi-tenancy.md) (isolation par organisation) et [architecture.md](architecture.md) (guards, abstractions de fournisseurs).

## Authentification

- **JWT** : access token (courte durée, `JWT_ACCESS_TTL`, 15 min par défaut) + refresh token rotatif (`JWT_REFRESH_TTL`, 30 jours par défaut) stocké haché en base (`sessions`), jamais en clair. Chaque `POST /auth/refresh` invalide l'ancien refresh token et en émet un nouveau (rotation) — un refresh token volé et réutilisé après rotation est détectable côté serveur.
- **Mots de passe** : hachés avec `argon2` (`apps/api/src/identity/users/users.service.ts`), jamais en clair, jamais loggués.
- **`api_keys`** (clés `test`/`live` pour accès serveur-à-serveur) : **non implémenté au MVP**, malgré le champ prévu dans `docs/database.md`/`docs/api.md`. C'est une lacune connue et documentée plutôt qu'une fonctionnalité à moitié câblée — brancher un mécanisme d'authentification par clé sur l'ensemble des guards existants (`JwtAuthGuard`, `TenantGuard`) sans casser l'audit trail (`userId` actuellement requis dans la plupart des services) est un chantier à part entière, jugé trop risqué pour être fait dans les mêmes proportions que le reste de la Phase 12 (voir `docs/IMPLEMENTATION_PLAN.md` Phase 12).

## Réinitialisation de mot de passe

Ajoutée par le Lot T (`0d1f289bc5337c26dfb636ae8eefb5aa8ae803dd`) :

- `POST /auth/forgot-password` / `POST /auth/reset-password` (`apps/api/src/identity/auth/auth.controller.ts`), publics, soumis au même `AUTH_THROTTLE` (30/min) que `/auth/login`/`/auth/register`.
- Token de reset : généré via `randomBytes(32)`, jamais stocké en clair — seul son hash SHA-256 (`identity/auth/token-hash.util.ts`, la même primitive que pour les refresh tokens) atteint MongoDB (`password_reset_tokens`, champ `tokenHash` en `select:false`).
- Expiration : 30 minutes. Usage unique, appliqué par une écriture MongoDB atomique (`findOneAndUpdate` filtrant sur `usedAt:null` et `expiresAt:{$gt:now}`). Une nouvelle demande de reset invalide implicitement tout token précédent non utilisé pour le même utilisateur (un seul document actif par `userId`, index unique).
- Le nouveau mot de passe est haché avec `argon2` (même primitive que `UsersService.create()`) **avant** que le token ne soit consommé — un token invalide/expiré/déjà utilisé ne peut jamais entraîner un changement de mot de passe.
- Après un reset réussi, toutes les sessions de l'utilisateur sont révoquées (`SessionsService.revokeAllForUser`, inchangé) — un attaquant en possession d'une session active existante est déconnecté.
- `POST /auth/forgot-password` répond de façon strictement identique (statut, corps) que l'email corresponde ou non à un compte existant — pas d'énumération de comptes.
- Le token n'apparaît jamais dans une réponse API ni dans un log applicatif.

**Limites connues (non bloquantes, cohérentes avec la section « Lacunes connues » ci-dessous) :**
- Différence de latence mesurable entre la branche « compte existant » et « compte inexistant » de `forgot-password` (timing side-channel), non corrigée.
- Pas de limite de taux spécifique par adresse email — seul le throttling par IP (`AUTH_THROTTLE`) s'applique, comme pour `login`/`register`.
- Fenêtre résiduelle étroite et auto-réparable entre la consommation du token et l'écriture du nouveau mot de passe (pas de transaction MongoDB multi-documents) — si l'écriture échoue juste après la consommation, le token est perdu mais le mot de passe reste inchangé ; l'utilisateur peut redemander un reset.
- Absence de page frontend `/reset-password` dans `apps/web` — le backend est fonctionnel et testé de bout en bout via l'API, mais aucune page ne consomme encore ce flux ; ce n'est pas une lacune de sécurité backend mais un travail frontend distinct.

## Multi-tenant / isolation

Voir [multi-tenancy.md](multi-tenancy.md) pour le modèle complet. Rappel des garanties clés :
- `organizationId` n'est **jamais** accepté depuis le body/les query params/un header arbitraire pour une route authentifiée — toujours dérivé du `TenantContext` résolu server-side (`TenantGuard`, JWT userId + header `X-Organization-Id` **revérifié** contre un membership réel).
- Toute query Mongoose sur un champ de référence caste explicitement en `Types.ObjectId` (voir [ADR-002](architecture-decisions.md#adr-002)) — sans ce cast, l'isolation tenant échouait silencieusement dans cet environnement.
- L'API publique (`/public/:organizationSlug/...`, Phase 11) est le seul endroit où `organizationId` est dérivé d'autre chose qu'un `TenantContext` (un slug d'URL) — elle ne touche jamais de données au-delà de ce que le slug résout, et revérifie l'organisation à chaque appel plutôt que de faire confiance à un identifiant mis en cache côté client.

## RBAC

Permissions `resource.action`, 6 rôles système (`OWNER`, `ADMIN`, `MANAGER`, `SALES`, `FINANCE`, `STAFF`), résolues dans le contexte d'un membership précis (jamais globalement). `PermissionsGuard` refuse par défaut toute route décorée avec `@RequirePermissions(...)` si la permission manque ; une route sans décorateur est accessible à tout membership authentifié dans l'organisation active (voir `apps/api/src/core/guards/permissions.guard.ts`).

## Réseau / HTTP

- **CORS** : allowlist explicite via `CORS_ORIGINS` (liste d'origines séparées par des virgules) — jamais `origin: true` avec `credentials: true`, qui refléterait n'importe quelle origine et permettrait à un site tiers de faire des requêtes authentifiées pour le compte d'un utilisateur connecté.
- **En-têtes de sécurité** : `helmet()` appliqué globalement (`apps/api/src/main.ts`).
- **Compression** : `compression()` middleware (gzip/brotli selon le client).
- **Rate limiting** : `ThrottlerModule` global (120 req/min/IP par défaut), resserré à 30 req/min sur `POST /auth/register`, `POST /auth/login`, `POST /auth/forgot-password` et `POST /auth/reset-password` (`@Throttle`, voir `apps/api/src/identity/auth/auth.controller.ts`) — surface la plus exposée au brute-force/credential-stuffing puisqu'elle ne requiert aucune authentification préalable.

## Secrets

- `JWT_SECRET`/`JWT_REFRESH_SECRET` : obligatoires (`validateEnv` refuse de démarrer sans eux), jamais commités (`.env` dans `.gitignore`, seul `.env.example` avec des valeurs placeholder est versionné).
- Clés de fournisseurs externes (Stripe, Resend, Anthropic, WhatsApp, ...) : jamais hardcodées dans le code — toujours lues via `ConfigService`, avec un provider par défaut sûr (`ManualPaymentProvider`, `LogEmailProvider`, `NullAIProvider`, `LogMessagingProvider`) quand la clé n'est pas configurée, plutôt que de planter ou de désactiver silencieusement la fonctionnalité (voir chaque `*.module.ts` utilisant une factory `useFactory` conditionnée sur la présence de la clé).
- Aucun secret n'est jamais retourné dans une réponse API ni loggué (mots de passe, refresh tokens, tokens de réinitialisation de mot de passe, clés de provider).

## Validation des entrées

Chaque endpoint d'écriture valide son body/query via un schéma Zod partagé (`packages/validation`, même schéma utilisé côté frontend et backend) appliqué par `ZodValidationPipe` — jamais de confiance aveugle dans un payload client. Les totaux financiers (`subtotal`/`taxTotal`/`total`) et les prix côté storefront public sont **systématiquement recalculés côté serveur**, jamais acceptés du client (voir [api.md](api.md) sections Finance et API publique).

## Audit

Toute action sensible (`CREATE`/`UPDATE`/`DELETE`/`LOGIN`/`LOGOUT`/`PAYMENT`/`REFUND`/`BOOKING`/`AI_ACTION`/`ROLE_CHANGE`/`SETTINGS_CHANGE`) est journalisée dans `audit_logs` avec l'acteur (`userId`, `undefined` pour les actions déclenchées par un visiteur anonyme via l'API publique — voir Phase 11), jamais supprimable via l'API.

## Dépendances

- `.github/dependabot.yml` (mises à jour de dépendances) et `.github/workflows/codeql.yml` (analyse statique) sont configurés depuis le commit `6c5897d` — cela ne signifie pas que toute vulnérabilité est automatiquement détectée ou corrigée, seulement qu'un scan automatisé existe et tourne en CI.
- `pnpm install --frozen-lockfile` utilisé partout (CI, Docker) — jamais de résolution de dépendances non verrouillée en dehors du développement local.

## Lacunes connues (MVP, non bloquantes pour l'usage prévu mais à traiter avant une mise en production à grande échelle)

- `api_keys` non implémenté (voir ci-dessus).
- Pas de verrouillage de compte / détection de brute-force au-delà du rate limiting par IP (pas de compteur d'échecs de connexion par compte).
- Pas de 2FA/MFA.
- Le gate de module (`EntitlementsService`, Phase 10) ne s'applique qu'à l'activation d'un module (`PATCH /organizations/me`), pas à chaque requête vers les routes de ce module — une organisation qui rétrograde de plan garde l'accès aux modules déjà activés tant qu'elle ne tente pas de les réactiver (voir `docs/IMPLEMENTATION_PLAN.md` Phase 10).
- Pas de politique de rotation automatique des secrets JWT.

## Divulgation responsable

Projet en développement (MVP), pas encore de programme de divulgation formalisé. En attendant, tout signalement de vulnérabilité doit être adressé directement aux mainteneurs du dépôt plutôt que publié dans une issue publique.
