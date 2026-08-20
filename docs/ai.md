# AI Architecture — KORVA OS

## Principe fondamental

L'IA n'accède **jamais** directement à MongoDB. Elle passe exclusivement par des tools sécurisés qui appellent les mêmes services métier que le reste de l'application (mêmes vérifications de permissions, de tenant isolation, de validation).

## Pipeline

```
USER
 ↓
AI GATEWAY            (indépendant du fournisseur LLM)
 ↓
AI ORCHESTRATOR
 ↓
CONTEXT BUILDER
 ↓
MEMORY
 ↓
POLICY / PERMISSIONS
 ↓
LLM
 ↓
TOOL SELECTION
 ↓
PERMISSION CHECK
 ↓
ACTION
 ↓
AUDIT LOG
```

`AIProvider` est une abstraction — aucun couplage direct à un fournisseur LLM particulier dans le code métier.

## Agents

Initiaux (MVP, Phase 9) :
- `GENERAL_ASSISTANT`
- `SALES_AGENT`
- `BOOKING_AGENT`
- `ANALYTICS_AGENT`

Futurs : `SUPPORT_AGENT`, `COMMERCE_AGENT`, `OPERATIONS_AGENT`, `MARKETING_AGENT`.

## Tools (liste MVP)

```
search_contacts, get_customer, create_customer
search_leads, update_lead, create_task
search_offers, get_offer, get_availability
create_quote, get_quote
create_booking, cancel_booking
get_order, create_order
get_invoice, get_sales_report
send_email, send_whatsapp
```

Chaque tool réutilise le service métier existant du module concerné (CRM, Catalog, Booking, Commerce, Finance, Communication) — pas de logique dupliquée pour l'IA.

## Permissions

L'IA respecte, dans cet ordre, les mêmes contraintes qu'un utilisateur humain :
- isolation d'organisation (TenantContext)
- permissions de l'utilisateur qui déclenche l'action
- permissions de rôle
- permissions propres à l'agent
- permissions propres au tool
- limitations du plan (EntitlementService — `ai.use`, `ai.execute_sensitive_actions`)

Actions sensibles nécessitant une confirmation humaine explicite avant exécution (`AI_ACTION_REQUIRES_CONFIRMATION`) :
```
refund_payment
delete_customer
delete_order
cancel_large_booking
send_mass_campaign
```

**Implémentation Phase 9** : aucun de ces 5 tools n'existe littéralement dans la liste MVP (section "Tools" ci-dessus) — `refund_payment`/`delete_customer`/`delete_order`/`send_mass_campaign` ne sont pas des tools construits à ce stade. Seul `cancel_booking` (le plus proche de `cancel_large_booking`) est marqué `sensitive: true` : toute annulation de réservation par l'IA passe par une `AiPendingAction` et attend `POST /ai/actions/:id/confirm`, sans distinction de taille de réservation pour le MVP. Les autres tools s'exécutent directement (gate = permission métier du tool + `ai.use`), y compris les écritures (`create_task`, `create_quote`, `create_booking`, `create_order`, `send_email`, `send_whatsapp`) — cohérent avec le fait qu'un humain effectuant la même action ne demande pas non plus de confirmation supplémentaire pour celles-ci.

## Mémoire

Trois niveaux, jamais mélangés entre organisations :
1. **Conversation memory** — historique de l'échange en cours (implémenté : `ai_messages`, rejoué intégralement à chaque tour).
2. **Business context** — données de l'organisation (catalogue, KPIs, config). Implémenté sous une forme minimale : `AiContextBuilderService` injecte le nom/secteur de l'organisation et la date du jour dans le system prompt, plutôt que de précharger catalogue/KPIs à chaque tour.
3. **Customer context** — historique propre au client concerné. Servi à la demande via les tools (`get_customer`, `search_leads`, ...) plutôt que préchargé.

**Déviation assumée** : charger tout le contexte business/client à chaque tour ferait doublon avec le tool-calling (le modèle peut déjà interroger exactement la donnée dont il a besoin) et gonflerait inutilement chaque appel LLM. Voir `docs/architecture-decisions.md`.

## RAG (architecture-ready, non requis au MVP)

```
document → extraction → chunking → embeddings → vector storage → retrieval → réponse IA
```

Sources prévues : PDF, FAQ, conditions générales, catalogue, politiques internes. Le fournisseur vectoriel est abstrait (pas de verrouillage).

## Sales Agent — exemple d'usage cible

```
User: "Quels prospects dois-je relancer aujourd'hui ?"
→ Agent utilise search_leads (tool CRM)
→ Réponse : nom, dernier contact, valeur, statut, recommandation

User: "Prépare les messages de relance."
→ L'IA génère les messages
→ L'envoi peut nécessiter une confirmation selon les paramètres de l'organisation
```

## Audit

Chaque action IA (recherche incluse si elle touche des données sensibles, et systématiquement toute action de type `create/update/delete/payment`) est journalisée dans `audit_logs` avec l'action `AI_ACTION` (voir [database.md](database.md)).

**Implémentation Phase 9** : les lectures pures (`search_*`, `get_*`) ne sont volontairement pas auditées (bruit inutile, cohérent avec le reste de l'app — un `GET /leads` humain n'est pas non plus audité) ; toute exécution de tool qui modifie un état (y compris via confirmation d'une action sensible) l'est, avec `metadata: { tool, input }`.

## Statut d'implémentation — Phase 9

Livré et validé (typecheck + lint + build + tests unitaires/e2e sur tout le monorepo — 92/92 tests e2e stables sur la grande majorité des exécutions complètes, voir addendum Phase 9 dans `docs/architecture-decisions.md` ADR-003 ; plus vérification manuelle via curl contre les serveurs de dev réels) :

- **`AIProvider`** (`apps/api/src/ai/providers/`) : `AnthropicAIProvider` (appelle réellement `https://api.anthropic.com/v1/messages`, tool-calling natif Anthropic) si `AI_API_KEY` est configuré, sinon `NullAIProvider` par défaut (réponse fixe "IA non configurée", aucun tool jamais appelé — même rôle que `LogEmailProvider`/`ManualPaymentProvider`).
- **Orchestrateur** (`AiOrchestratorService`) : boucle complète trigger → conditions → (tool-calling jusqu'à 5 itérations) → action → audit. Chaque tour utilisateur est persisté (`ai_conversations`, `ai_messages`), les tool calls/résultats sont rejoués dans l'historique envoyé au modèle au tour suivant.
- **19 tools MVP** (`apps/api/src/ai/tools/`), chacun un wrapper fin sur un service métier déjà construit (jamais d'accès Mongo direct) : `search_contacts`, `get_customer`, `create_customer`, `search_leads`, `update_lead`, `create_task`, `search_offers`, `get_offer`, `get_availability`, `create_quote`, `get_quote`, `create_booking`, `cancel_booking` (sensible), `get_order`, `create_order`, `get_invoice`, `get_sales_report`, `send_email`, `send_whatsapp`. `get_sales_report` fait une agrégation Mongo réelle sur `orders` (chiffre d'affaires, nombre de commandes, top 5 offres) — pas de module Analytics complet (hors phase numérotée du brief).
- **4 agents** (`general_assistant`, `sales_agent`, `booking_agent`, `analytics_agent`), chacun avec son propre sous-ensemble de tools autorisés (`AiToolsRegistryService`), en plus du filtrage par permissions réelles de l'utilisateur appelant.
- **Confirmation humaine** : `AiPendingAction` créée au lieu d'exécuter directement un tool `sensitive`, endpoints `GET /ai/conversations/:id/pending-actions`, `POST /ai/actions/:id/confirm`, `POST /ai/actions/:id/reject`.
- **RBAC** : `ai.use`/`ai.execute_sensitive_actions` existaient déjà (posés en Phase 1) — aucun changement nécessaire, seule confirmation qu'ils étaient bien exploitables tels quels.
- **Frontend** : `/dashboard/ai` — sélection d'agent, historique de conversations, fil de messages (bulles utilisateur/assistant, indicateurs d'appel de tool), cartes de confirmation pour les actions en attente.
- **Tests** : `apps/api/test/ai.e2e-spec.ts` — un `AIProvider` scripté (`.overrideProvider(AI_PROVIDER)`) déterministe décidant quel tool appeler à partir du seul historique de messages (donc sans jamais appeler un vrai LLM), exerçant pour de vrai toute la boucle : exécution d'un tool réel, filtrage par agent, tool inconnu, dépassement du nombre max d'itérations, action sensible différée puis confirmée/rejetée, isolation tenant ; plus un test séparé du chemin par défaut `NullAIProvider` (sans override) confirmant le comportement "IA non configurée".

Deux ajustements de câblage trouvés en cours de route (pas des ADR à part entière, juste des exports de module manquants) : `LeadsService`, `AvailabilityService`, `QuotesService`, `OrdersService`, `ConversationsService` n'étaient pas exportés par leurs modules respectifs (personne n'en avait eu besoin depuis un autre module jusqu'ici) — ajoutés à chaque `exports:`.

Non fait volontairement en Phase 9 (hors scope, cohérent avec "architecture-ready" du brief) : RAG (aucune source de documents/embeddings/vector store à ce stade), `MessagingProvider` WhatsApp réel (toujours `LogMessagingProvider`, en attendant une vraie clé WhatsApp Business API), `EntitlementService`/limitations de plan sur l'usage IA (arrive avec la Phase 10 Subscriptions — `ai.use`/`ai.execute_sensitive_actions` restent pour l'instant de simples permissions RBAC, pas encore de quota), les 5 tools nommés dans le brief pour les actions sensibles (`refund_payment`, `delete_customer`, `delete_order`, `send_mass_campaign` — n'existent pas comme tools, voir section Permissions ci-dessus), agents `SUPPORT_AGENT`/`COMMERCE_AGENT`/`OPERATIONS_AGENT`/`MARKETING_AGENT` (prévus "futurs" dans le brief, non MVP).

Voir aussi [architecture.md](architecture.md) et [multi-tenancy.md](multi-tenancy.md).
