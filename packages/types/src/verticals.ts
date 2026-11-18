import type { KorvaModule } from "./organization.ts";
import type { OfferType } from "./catalog.ts";
import type { SystemEvent, WorkflowAction } from "./workflow.ts";
import type { StorefrontTemplateKey } from "./storefront-themes.ts";
import type { BusinessModel } from "./business-models.ts";

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

/**
 * A catalogue line this trade is likely to sell, offered to the owner as a SUGGESTION in the
 * dashboard — never created automatically.
 *
 * No price, deliberately. A name ("Coloration") is a description of the trade; a price is a
 * commercial claim that belongs to the business, and writing one into their catalogue — let
 * alone publishing it on their public site — would put words in their mouth. The owner clicks a
 * suggestion, the creation form opens pre-filled with the name and type, and they set the price.
 *
 * Absent for the trades where it would be noise rather than help: generic "Commerce &
 * e-commerce", "Mode & habillement" and "Immobilier" sell things no list could usefully guess,
 * so they get none instead of something vague.
 */
export interface VerticalSuggestedOffer {
  name: string;
  type: OfferType;
}

export interface VerticalTemplate {
  key: string;
  label: string;
  description: string;
  suggestedType: string;
  /** The type of activity this trade belongs to — see business-models.ts. Stored on the
   *  organization at onboarding, so it survives an edit of the free-text `type`. */
  businessModel: BusinessModel;
  suggestedModules: KorvaModule[];
  starterWorkflow?: VerticalStarterWorkflow;
  /** Storefront visual template pre-selected for this vertical — see storefront-themes.ts.
   *  Still just a default: the owner can change it afterwards in Settings. */
  defaultStorefrontTemplate: StorefrontTemplateKey;
  /** Catalogue lines suggested to the owner, never created for them — see
   *  VerticalSuggestedOffer. Omitted where a guess would not help. */
  suggestedOffers?: VerticalSuggestedOffer[];
}

export const VERTICAL_TEMPLATES: VerticalTemplate[] = [
  {
    key: "beauty_wellness",
    label: "Salon & bien-être",
    description: "Coiffure, esthétique, spa — réservations et suivi client.",
    suggestedType: "beauté",
    businessModel: "appointments",
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
    suggestedOffers: [
      { name: "Coupe femme", type: "booking" },
      { name: "Coupe homme", type: "booking" },
      { name: "Coloration", type: "booking" },
      { name: "Brushing", type: "booking" },
      { name: "Soin du visage", type: "booking" },
      { name: "Manucure", type: "booking" },
    ],
    defaultStorefrontTemplate: "salon",
  },
  {
    key: "restaurant",
    label: "Restaurant",
    description: "Commandes, préparation et suivi client.",
    suggestedType: "restauration",
    businessModel: "restaurant",
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
    suggestedOffers: [
      { name: "Plat du jour", type: "product" },
      { name: "Entrée", type: "product" },
      { name: "Dessert", type: "product" },
      { name: "Menu midi", type: "package" },
      { name: "Boisson", type: "product" },
    ],
    defaultStorefrontTemplate: "table",
  },
  {
    key: "professional_services",
    label: "Services professionnels",
    description: "Conseil, coaching, agences — suivi commercial et facturation.",
    suggestedType: "services professionnels",
    businessModel: "quotes",
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
    suggestedOffers: [
      { name: "Premier rendez-vous", type: "booking" },
      { name: "Audit", type: "service" },
      { name: "Accompagnement mensuel", type: "subscription" },
      { name: "Formation sur mesure", type: "service" },
    ],
    defaultStorefrontTemplate: "vitrine",
  },
  {
    key: "training",
    label: "Formation",
    description: "Sessions, ateliers et formations — réservations de places.",
    suggestedType: "formation",
    businessModel: "training",
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
    suggestedOffers: [
      { name: "Séance découverte", type: "booking" },
      { name: "Atelier d'une journée", type: "booking" },
      { name: "Formation complète", type: "package" },
      { name: "Accompagnement individuel", type: "booking" },
    ],
    defaultStorefrontTemplate: "academie",
  },
  {
    key: "commerce",
    label: "Commerce & e-commerce",
    description: "Vente de produits, en boutique ou en ligne.",
    suggestedType: "commerce",
    businessModel: "retail",
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
    businessModel: "appointments",
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
    suggestedOffers: [
      { name: "Première consultation", type: "booking" },
      { name: "Séance de suivi", type: "booking" },
      { name: "Bilan complet", type: "booking" },
    ],
    defaultStorefrontTemplate: "salon",
  },
  {
    key: "trades_construction",
    label: "Artisanat & BTP",
    description: "Plomberie, électricité, menuiserie, peinture — devis et interventions.",
    suggestedType: "artisanat",
    businessModel: "quotes",
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
    suggestedOffers: [
      { name: "Visite technique et devis", type: "booking" },
      { name: "Dépannage urgent", type: "service" },
      { name: "Intervention à l'heure", type: "service" },
    ],
    defaultStorefrontTemplate: "vitrine",
  },
  {
    key: "real_estate",
    label: "Immobilier",
    description: "Agences immobilières, syndics, gestion locative — suivi des dossiers.",
    suggestedType: "immobilier",
    businessModel: "real_estate",
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
    defaultStorefrontTemplate: "agence",
  },
  {
    key: "hospitality",
    label: "Hôtellerie & tourisme",
    description: "Gîtes, chambres d'hôtes, hébergements — réservations de séjours.",
    suggestedType: "hôtellerie",
    businessModel: "lodging",
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
    suggestedOffers: [
      { name: "Nuitée", type: "booking" },
      { name: "Petit-déjeuner", type: "product" },
      { name: "Séjour deux nuits", type: "package" },
    ],
    defaultStorefrontTemplate: "sejour",
  },
  {
    key: "fashion_retail",
    label: "Mode & habillement",
    description: "Prêt-à-porter, accessoires, chaussures — vente en boutique ou en ligne.",
    suggestedType: "mode",
    businessModel: "retail",
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
    businessModel: "retail",
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
    suggestedOffers: [
      { name: "Panier de saison", type: "product" },
      { name: "Vente au kilo", type: "product" },
      { name: "Commande sur mesure", type: "service" },
    ],
    defaultStorefrontTemplate: "boutique",
  },
  {
    key: "fitness_sport",
    label: "Sport & fitness",
    description: "Salles de sport, coachs sportifs, cours collectifs — réservations de séances.",
    suggestedType: "sport",
    businessModel: "appointments",
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
    suggestedOffers: [
      { name: "Séance d'essai", type: "booking" },
      { name: "Cours collectif", type: "booking" },
      { name: "Coaching individuel", type: "booking" },
      { name: "Abonnement mensuel", type: "subscription" },
    ],
    defaultStorefrontTemplate: "salon",
  },
  {
    key: "digital_agency",
    label: "Informatique & agence digitale",
    description: "Développement, marketing, design — suivi commercial et facturation de projets.",
    suggestedType: "agence digitale",
    businessModel: "quotes",
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
    suggestedOffers: [
      { name: "Audit et cadrage", type: "service" },
      { name: "Site vitrine", type: "package" },
      { name: "Maintenance mensuelle", type: "subscription" },
    ],
    defaultStorefrontTemplate: "vitrine",
  },
  {
    key: "events_creative",
    label: "Événementiel & création",
    description: "Photographes, traiteurs événementiels, DJ, décorateurs — devis et prestations.",
    suggestedType: "événementiel",
    businessModel: "quotes",
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
    suggestedOffers: [
      { name: "Reportage photo", type: "service" },
      { name: "Prestation sur événement", type: "service" },
      { name: "Forfait mariage", type: "package" },
    ],
    defaultStorefrontTemplate: "vitrine",
  },
  {
    key: "nonprofit_association",
    label: "Association & ONG",
    description: "Associations, ONG — adhésions, dons et suivi des membres.",
    suggestedType: "association",
    businessModel: "association",
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
    suggestedOffers: [
      { name: "Adhésion annuelle", type: "subscription" },
      { name: "Don libre", type: "product" },
    ],
    defaultStorefrontTemplate: "vitrine",
  },
  {
    key: "childcare_personal_services",
    label: "Garde d'enfants & services à la personne",
    description: "Garde d'enfants, aide à domicile, ménage — planification d'interventions.",
    suggestedType: "services à la personne",
    businessModel: "appointments",
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
    suggestedOffers: [
      { name: "Garde à l'heure", type: "booking" },
      { name: "Ménage deux heures", type: "booking" },
      { name: "Aide aux devoirs", type: "booking" },
    ],
    defaultStorefrontTemplate: "salon",
  },
  {
    key: "agriculture_direct_sale",
    label: "Agriculture & vente directe",
    description: "Producteurs, fermes, vente directe — commandes et paniers.",
    suggestedType: "agriculture",
    businessModel: "retail",
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
    suggestedOffers: [
      { name: "Panier hebdomadaire", type: "subscription" },
      { name: "Vente au kilo", type: "product" },
      { name: "Commande groupée", type: "service" },
    ],
    defaultStorefrontTemplate: "boutique",
  },
];

/**
 * The vertical template an organization belongs to, matched on `Organization.type`.
 *
 * `type` is free-form by design (see organization.schema.ts), so this is a best-effort match and
 * returns undefined for an owner who typed their own sector. Extracted here because
 * PublicService#resolveStorefrontTheme did this find() inline and the dashboard now needs the
 * same answer to show a trade's catalogue suggestions — two copies of "which trade is this?"
 * would drift the moment `suggestedType` changed.
 */
export function verticalForOrganizationType(
  type: string | undefined,
): VerticalTemplate | undefined {
  if (!type) return undefined;
  return VERTICAL_TEMPLATES.find((template) => template.suggestedType === type);
}
