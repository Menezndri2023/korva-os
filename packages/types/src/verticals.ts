import type { KorvaModule } from "./organization.ts";
import type { SystemEvent, WorkflowAction } from "./workflow.ts";
import type { StorefrontTemplateKey } from "./storefront-themes.ts";

/**
 * Onboarding templates for common business verticals (Business OS brief §13-14,
 * docs/BUSINESS_OS_AUDIT.md roadmap item #7) — "un moteur business universel + des
 * configurations et workflows adaptés aux secteurs", not separate applications per vertical.
 * Purely data: picking one pre-fills Organization.type (still free-form — see
 * organization.schema.ts) and the onboarding module checkboxes, and creates one starter
 * Workflow using only already-existing triggers/actions. No backend change, no new schema,
 * no closed enum — "Autre" (no template) keeps today's free-text flow exactly as it was.
 *
 * MODULE COHERENCE, enforced by vertical-templates.spec.ts (apps/api) rather than by types —
 * TypeScript can only check that a module name is valid, not that a set of them makes sense
 * together. Three rules, each of which was violated by all or most templates until 2026-10-12:
 *   - every template suggests "website", because every template also names a
 *     `defaultStorefrontTemplate`, which is dead configuration without it. Worse than dead:
 *     POST /organizations enables every module the plan allows, and onboarding then PATCHes
 *     `suggestedModules` over that set — so picking a vertical actively REMOVED the storefront
 *     that a fresh organization had been given.
 *   - a template suggesting "booking" also suggests "communication", or
 *     BookingReminderSchedulerService has no channel to send its reminders through.
 *   - a template suggesting "marketing" also suggests "communication", for the same reason: a
 *     Campaign has to send somewhere.
 *   - a template carrying a `starterWorkflow` also suggests "workflow", or onboarding skips
 *     creating it and the configuration is dead (5 templates were in this state).
 *   - that workflow's own trigger belongs to a suggested module — `order.created` needs
 *     "commerce", `booking.created` needs "booking", `lead.created` needs "crm". Otherwise the
 *     workflow is created and then never fires (nonprofit_association was in this state: a
 *     membership workflow on `order.created` with no commerce module).
 *
 * Deliberately excludes any car/vehicle-rental vertical — kept out of this repo per standing
 * instruction (KORVA OS stays sector-agnostic and automotive-free; that vertical belongs to a
 * separate future product built on top of KORVA, never inside this repo).
 */
export interface VerticalStarterWorkflow {
  name: string;
  trigger: SystemEvent;
  action: WorkflowAction;
}

export interface VerticalTemplate {
  key: string;
  label: string;
  description: string;
  suggestedType: string;
  suggestedModules: KorvaModule[];
  starterWorkflow?: VerticalStarterWorkflow;
  /** Storefront visual template pre-selected for this vertical — see storefront-themes.ts.
   *  Still just a default: the owner can change it afterwards in Settings. */
  defaultStorefrontTemplate: StorefrontTemplateKey;
}

export const VERTICAL_TEMPLATES: VerticalTemplate[] = [
  {
    key: "beauty_wellness",
    label: "Salon & bien-être",
    description: "Coiffure, esthétique, spa — réservations et suivi client.",
    suggestedType: "beauté",
    suggestedModules: [
      "crm",
      "catalog",
      "booking",
      "finance",
      "workflow",
      "communication",
      "ai",
      "website",
      "marketing",
    ],
    starterWorkflow: {
      name: "Confirmation de réservation",
      trigger: "booking.created",
      action: {
        type: "internal_notification",
        config: {
          title: "Nouvelle réservation",
          body: "Réservation {{bookingId}} créée.",
        },
      },
    },
    defaultStorefrontTemplate: "salon",
  },
  {
    key: "restaurant",
    label: "Restaurant",
    description: "Commandes, préparation et suivi client.",
    suggestedType: "restauration",
    suggestedModules: [
      "crm",
      "catalog",
      "commerce",
      "finance",
      "workflow",
      "communication",
      "ai",
      "website",
      "marketing",
    ],
    starterWorkflow: {
      name: "Nouvelle commande",
      trigger: "order.created",
      action: {
        type: "internal_notification",
        config: {
          title: "Nouvelle commande",
          body: "Commande {{orderId}} à préparer.",
        },
      },
    },
    defaultStorefrontTemplate: "table",
  },
  {
    key: "professional_services",
    label: "Services professionnels",
    description: "Conseil, coaching, agences — suivi commercial et facturation.",
    suggestedType: "services professionnels",
    suggestedModules: [
      "crm",
      "catalog",
      "finance",
      "workflow",
      "ai",
      "website",
    ],
    starterWorkflow: {
      name: "Qualifier un nouveau prospect",
      trigger: "lead.created",
      action: {
        type: "create_task",
        config: { title: "Qualifier le prospect {{leadId}}" },
      },
    },
    defaultStorefrontTemplate: "vitrine",
  },
  {
    key: "training",
    label: "Formation",
    description: "Sessions, ateliers et formations — réservations de places.",
    suggestedType: "formation",
    suggestedModules: [
      "crm",
      "catalog",
      "booking",
      "communication",
      "finance",
      "workflow",
      "ai",
      "website",
      "marketing",
    ],
    starterWorkflow: {
      name: "Nouvelle inscription",
      trigger: "booking.created",
      action: {
        type: "internal_notification",
        config: {
          title: "Nouvelle inscription",
          body: "Réservation {{bookingId}} confirmée.",
        },
      },
    },
    defaultStorefrontTemplate: "academie",
  },
  {
    key: "commerce",
    label: "Commerce & e-commerce",
    description: "Vente de produits, en boutique ou en ligne.",
    suggestedType: "commerce",
    suggestedModules: [
      "crm",
      "catalog",
      "commerce",
      "finance",
      "analytics",
      "ai",
      "website",
      "workflow",
    ],
    starterWorkflow: {
      name: "Nouvelle commande",
      trigger: "order.created",
      action: {
        type: "internal_notification",
        config: {
          title: "Nouvelle commande",
          body: "Commande {{orderId}} reçue.",
        },
      },
    },
    defaultStorefrontTemplate: "boutique",
  },
  {
    key: "health_practice",
    label: "Santé & bien-être (non médical)",
    description: "Kinésithérapie, ostéopathie, coaching santé, nutrition — rendez-vous et suivi.",
    suggestedType: "santé",
    suggestedModules: [
      "crm",
      "catalog",
      "booking",
      "communication",
      "finance",
      "workflow",
      "ai",
      "website",
      "marketing",
    ],
    starterWorkflow: {
      name: "Confirmation de rendez-vous",
      trigger: "booking.created",
      action: {
        type: "internal_notification",
        config: { title: "Nouveau rendez-vous", body: "Réservation {{bookingId}} créée." },
      },
    },
    defaultStorefrontTemplate: "salon",
  },
  {
    key: "trades_construction",
    label: "Artisanat & BTP",
    description: "Plomberie, électricité, menuiserie, peinture — devis et interventions.",
    suggestedType: "artisanat",
    suggestedModules: [
      "crm",
      "catalog",
      "finance",
      "workflow",
      "ai",
      "website",
    ],
    starterWorkflow: {
      name: "Qualifier une nouvelle demande",
      trigger: "lead.created",
      action: {
        type: "create_task",
        config: { title: "Rappeler le prospect {{leadId}}" },
      },
    },
    defaultStorefrontTemplate: "vitrine",
  },
  {
    key: "real_estate",
    label: "Immobilier",
    description: "Agences immobilières, syndics, gestion locative — suivi des dossiers.",
    suggestedType: "immobilier",
    suggestedModules: [
      "crm",
      "catalog",
      "finance",
      "workflow",
      "ai",
      "website",
    ],
    starterWorkflow: {
      name: "Qualifier un nouveau contact",
      trigger: "lead.created",
      action: {
        type: "create_task",
        config: { title: "Qualifier le contact {{leadId}}" },
      },
    },
    defaultStorefrontTemplate: "vitrine",
  },
  {
    key: "hospitality",
    label: "Hôtellerie & tourisme",
    description: "Gîtes, chambres d'hôtes, hébergements — réservations de séjours.",
    suggestedType: "hôtellerie",
    suggestedModules: [
      "crm",
      "catalog",
      "booking",
      "finance",
      "workflow",
      "communication",
      "ai",
      "website",
      "marketing",
    ],
    starterWorkflow: {
      name: "Confirmation de séjour",
      trigger: "booking.created",
      action: {
        type: "internal_notification",
        config: { title: "Nouvelle réservation", body: "Séjour {{bookingId}} confirmé." },
      },
    },
    defaultStorefrontTemplate: "salon",
  },
  {
    key: "fashion_retail",
    label: "Mode & habillement",
    description: "Prêt-à-porter, accessoires, chaussures — vente en boutique ou en ligne.",
    suggestedType: "mode",
    suggestedModules: [
      "crm",
      "catalog",
      "commerce",
      "finance",
      "analytics",
      "ai",
      "website",
      "workflow",
    ],
    starterWorkflow: {
      name: "Nouvelle commande",
      trigger: "order.created",
      action: {
        type: "internal_notification",
        config: { title: "Nouvelle commande", body: "Commande {{orderId}} reçue." },
      },
    },
    defaultStorefrontTemplate: "boutique",
  },
  {
    key: "food_retail",
    label: "Épicerie & alimentation",
    description: "Épiceries, primeurs, boulangeries — vente au détail et sur commande.",
    suggestedType: "alimentation",
    suggestedModules: [
      "crm",
      "catalog",
      "commerce",
      "finance",
      "analytics",
      "ai",
      "website",
      "workflow",
    ],
    starterWorkflow: {
      name: "Nouvelle commande",
      trigger: "order.created",
      action: {
        type: "internal_notification",
        config: { title: "Nouvelle commande", body: "Commande {{orderId}} reçue." },
      },
    },
    defaultStorefrontTemplate: "boutique",
  },
  {
    key: "fitness_sport",
    label: "Sport & fitness",
    description: "Salles de sport, coachs sportifs, cours collectifs — réservations de séances.",
    suggestedType: "sport",
    suggestedModules: [
      "crm",
      "catalog",
      "booking",
      "communication",
      "finance",
      "workflow",
      "ai",
      "website",
      "marketing",
    ],
    starterWorkflow: {
      name: "Confirmation de séance",
      trigger: "booking.created",
      action: {
        type: "internal_notification",
        config: { title: "Nouvelle séance", body: "Réservation {{bookingId}} créée." },
      },
    },
    defaultStorefrontTemplate: "salon",
  },
  {
    key: "digital_agency",
    label: "Informatique & agence digitale",
    description: "Développement, marketing, design — suivi commercial et facturation de projets.",
    suggestedType: "agence digitale",
    suggestedModules: [
      "crm",
      "catalog",
      "finance",
      "workflow",
      "ai",
      "website",
    ],
    starterWorkflow: {
      name: "Qualifier un nouveau prospect",
      trigger: "lead.created",
      action: {
        type: "create_task",
        config: { title: "Qualifier le prospect {{leadId}}" },
      },
    },
    defaultStorefrontTemplate: "vitrine",
  },
  {
    key: "events_creative",
    label: "Événementiel & création",
    description: "Photographes, traiteurs événementiels, DJ, décorateurs — devis et prestations.",
    suggestedType: "événementiel",
    suggestedModules: [
      "crm",
      "catalog",
      "booking",
      "communication",
      "finance",
      "workflow",
      "ai",
      "website",
      "marketing",
    ],
    starterWorkflow: {
      name: "Qualifier une nouvelle demande",
      trigger: "lead.created",
      action: {
        type: "create_task",
        config: { title: "Rappeler le prospect {{leadId}}" },
      },
    },
    defaultStorefrontTemplate: "vitrine",
  },
  {
    key: "nonprofit_association",
    label: "Association & ONG",
    description: "Associations, ONG — adhésions, dons et suivi des membres.",
    suggestedType: "association",
    suggestedModules: [
      "crm",
      "catalog",
      "finance",
      "communication",
      "ai",
      "website",
      "marketing",
      "workflow",
      "commerce",
    ],
    starterWorkflow: {
      name: "Nouvelle adhésion",
      trigger: "order.created",
      action: {
        type: "internal_notification",
        config: { title: "Nouvelle adhésion", body: "Commande {{orderId}} reçue." },
      },
    },
    defaultStorefrontTemplate: "vitrine",
  },
  {
    key: "childcare_personal_services",
    label: "Garde d'enfants & services à la personne",
    description: "Garde d'enfants, aide à domicile, ménage — planification d'interventions.",
    suggestedType: "services à la personne",
    suggestedModules: [
      "crm",
      "catalog",
      "booking",
      "communication",
      "finance",
      "workflow",
      "ai",
      "website",
      "marketing",
    ],
    starterWorkflow: {
      name: "Confirmation d'intervention",
      trigger: "booking.created",
      action: {
        type: "internal_notification",
        config: { title: "Nouvelle intervention", body: "Réservation {{bookingId}} créée." },
      },
    },
    defaultStorefrontTemplate: "salon",
  },
  {
    key: "agriculture_direct_sale",
    label: "Agriculture & vente directe",
    description: "Producteurs, fermes, vente directe — commandes et paniers.",
    suggestedType: "agriculture",
    suggestedModules: [
      "crm",
      "catalog",
      "commerce",
      "finance",
      "ai",
      "website",
      "workflow",
    ],
    starterWorkflow: {
      name: "Nouvelle commande",
      trigger: "order.created",
      action: {
        type: "internal_notification",
        config: { title: "Nouvelle commande", body: "Commande {{orderId}} reçue." },
      },
    },
    defaultStorefrontTemplate: "boutique",
  },
];
