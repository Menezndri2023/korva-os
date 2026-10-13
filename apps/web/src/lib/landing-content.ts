import type { KorvaModule } from "@korva/types";
import type { SystemEvent, WorkflowAction } from "@korva/types";

/**
 * Copy for the pre-auth pages. Everything structural on the landing page (which trades exist,
 * which modules each one gets, which starter automation is created, which storefront template
 * is pre-selected) is read from packages/types at render time — VERTICAL_TEMPLATES and
 * STOREFRONT_TEMPLATES — so the page cannot drift from what signing up actually does. This file
 * only holds the prose that has no home in the type package.
 */

/**
 * Prospect-facing descriptions of each module.
 *
 * Deliberately NOT reusing MODULE_LABELS from the onboarding and settings pages. Those are
 * *labels*: short nouns that name a navigation item for someone who has already bought ("Clients
 * & Prospects (CRM)", "Statistiques"). These are *claims*: full phrases telling someone who has
 * never seen the product what they will be able to do. "(CRM)" is a useful disambiguator in a
 * settings checkbox and pure jargon on a landing page. Same eleven keys, different audience,
 * different register — so this is a separate artifact rather than a third copy of the same map.
 */
export const MODULE_PROMISES: Record<KorvaModule, string> = {
  crm: "Toutes vos fiches clients, avec leur historique",
  catalog: "Votre catalogue de prestations et de produits",
  booking: "Un carnet de réservations que votre équipe partage",
  commerce: "Les commandes suivies, du panier à la livraison",
  finance: "Devis, factures et relances de paiement",
  workflow: "Des automatisations qui tournent sans vous",
  communication: "Messages et rappels envoyés par email",
  analytics: "Votre chiffre d'affaires, à jour",
  ai: "Un assistant qui rédige et résume à votre place",
  website: "Un site public, en ligne le premier jour",
  marketing: "Des campagnes pour faire revenir vos clients",
};

/**
 * Plain-language rendering of a starter workflow's trigger. Only the three events actually used
 * by VERTICAL_TEMPLATES are mapped — a `Partial` with a fallback at the call site, rather than a
 * full `Record<SystemEvent, string>`, because the other events are never reachable from this
 * page and inventing prospect-facing copy for them would be copy nobody reads and nobody
 * maintains.
 */
export const TRIGGER_SENTENCES: Partial<Record<SystemEvent, string>> = {
  "booking.created": "Dès qu'un client réserve",
  "order.created": "Dès qu'une commande arrive",
  "lead.created": "Dès qu'un prospect vous contacte",
};

/** Same scoping rationale as TRIGGER_SENTENCES: only the two action types the templates use. */
export const ACTION_SENTENCES: Partial<Record<WorkflowAction["type"], string>> = {
  internal_notification: "votre équipe est prévenue, sans que vous y pensiez",
  create_task: "une tâche de suivi est créée pour ne pas le perdre",
};

/**
 * The before/after that does the actual selling. Written as the owner's own description of their
 * week, not as feature bullets — someone keeping a paper appointment book recognises the left
 * column immediately, and that recognition is what a feature list never achieves.
 */
export const REPLACES: ReadonlyArray<{ today: string; korva: string }> = [
  {
    today: "Un carnet de rendez-vous que vous seul savez relire",
    korva: "Un planning partagé, que votre équipe consulte depuis son téléphone",
  },
  {
    today: "Des commandes notées entre deux messages WhatsApp",
    korva: "Chaque commande enregistrée, avec son statut et son client",
  },
  {
    today: "Un stock que vous comptez de tête, et qui vous surprend",
    korva: "Un stock qui se décrémente à chaque vente",
  },
  {
    today: "Des factures retapées une par une le dimanche soir",
    korva: "Des factures générées, envoyées, puis relancées toutes seules",
  },
  {
    today: "Un numéro de téléphone en guise de vitrine",
    korva: "Un site public avec vos horaires, vos prestations et vos tarifs",
  },
  {
    today: "Un chiffre d'affaires que vous reconstituez en fin de mois",
    korva: "Vos chiffres à jour, chaque matin",
  },
];

/**
 * The non-module things a tier unlocks. Modules are NOT listed here — the pricing section
 * derives those from MODULE_MIN_PLAN in @korva/types, so the page cannot claim a module the
 * plan does not grant. These are the gates that live elsewhere in the code, each paired with
 * what enforces it, so a line here can always be checked against a real check:
 *
 *   free     sector template      -> STOREFRONT_TEMPLATES[*].minPlan, via
 *                                    assertStorefrontThemeAllowed
 *   starter  custom domain        -> EntitlementsService.assertCustomDomainAllowed
 *   pro      palette + fonts      -> STOREFRONT_TEMPLATES[*].refinedChoiceMinPlan
 *   business brand accent colour  -> STOREFRONT_TEMPLATES[*].customAccentMinPlan
 *
 * Seats and the AI allowance are not here either: they are read from PLAN_LIMITS directly.
 */
export const PLAN_PERKS: Record<string, readonly string[]> = {
  free: [
    "Votre site public sur korvasuite.com",
    "Le modèle de site de votre métier",
  ],
  starter: ["Votre propre nom de domaine"],
  pro: ["Couleurs et typographies de votre site au choix"],
  business: ["Votre couleur de marque sur votre site"],
};

/** One line per tier, saying who it is for. */
export const PLAN_AUDIENCE: Record<string, string> = {
  free: "Pour démarrer seul, sans carte bancaire",
  starter: "Pour une activité qui tourne déjà",
  pro: "Pour une équipe qui veut arrêter le travail manuel",
  business: "Pour un réseau ou une activité multi-sites",
};
