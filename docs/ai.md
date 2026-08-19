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

## Mémoire

Trois niveaux, jamais mélangés entre organisations :
1. **Conversation memory** — historique de l'échange en cours.
2. **Business context** — données de l'organisation (catalogue, KPIs, config).
3. **Customer context** — historique propre au client concerné.

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

Voir aussi [architecture.md](architecture.md) et [multi-tenancy.md](multi-tenancy.md).
