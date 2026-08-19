# Multi-tenancy — KORVA OS

## Modèle

Shared database / shared collections / isolation par `organizationId`. Pas de base de données par tenant (coût opérationnel trop élevé au MVP).

## TenantContext

Chaque requête authentifiée résout, via un guard/middleware NestJS exécuté avant tout controller :

```
request.user           // utilisateur authentifié (JWT)
request.organization    // organisation active
request.membership      // membership user ↔ organization (contient le rôle)
request.permissions     // permissions résolues pour ce membership
```

Résolution :

```
JWT (userId) → memberships (userId, organizationId actif) → organization + role + permissions
```

`organizationId` n'est **jamais** accepté depuis le body, les query params ou les headers arbitraires envoyés par le client. Il est toujours dérivé du `TenantContext` côté serveur.

## Application de l'isolation

- Tout repository qui lit/écrit une collection tenant-aware injecte automatiquement `organizationId` depuis le `TenantContext` (pas de méthode de repository qui accepte un `organizationId` arbitraire venant du controller sans passer par le contexte).
- Un guard NestJS global rejette toute requête où le `TenantContext` ne peut pas être résolu.
- Les fichiers (FILES) sont eux aussi tenant-aware : toute URL/clé de stockage est vérifiée contre l'organisation active avant service.

## Tests obligatoires (dès Phase 1)

1. Un user ne peut lister/lire que les organisations dont il est membre.
2. Organization A ne peut jamais **lire** de données appartenant à Organization B (contacts, leads, offers, bookings, orders, invoices, fichiers, etc.).
3. Organization A ne peut jamais **modifier** des données de Organization B.
4. Organization A ne peut jamais **supprimer** des données de Organization B.
5. Organization A ne peut jamais accéder aux fichiers de Organization B (StorageProvider).
6. Une requête sans `TenantContext` résolu est rejetée (401/403), jamais silencieusement acceptée.

Ces tests sont écrits comme suite d'intégration dédiée (`tenant-isolation`) et doivent passer avant de considérer Phase 1 terminée (voir Definition of Done).

## Multi-organisation par utilisateur

Un utilisateur peut appartenir à plusieurs organisations (plusieurs `memberships`). L'organisation "active" pour une session/requête est déterminée explicitement (sélection côté client + validation serveur que le membership existe et est actif), jamais déduite implicitement.

## RBAC et tenant

Les rôles (`OWNER, ADMIN, MANAGER, SALES, FINANCE, STAFF` + rôles personnalisés) et permissions (`resource.action`) sont toujours résolus **dans le contexte d'un membership**, donc d'une organisation précise — un rôle OWNER dans l'organisation A n'a aucun effet dans l'organisation B.

Voir aussi [architecture.md](architecture.md) (module CORE / TenantContext) et [database.md](database.md) (index `organizationId`).
