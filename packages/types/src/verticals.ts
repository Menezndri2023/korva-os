import type { KorvaModule } from "./organization.ts";
import type { SystemEvent, WorkflowAction } from "./workflow.ts";

/**
 * Onboarding templates for common business verticals (Business OS brief §13-14,
 * docs/BUSINESS_OS_AUDIT.md roadmap item #7) — "un moteur business universel + des
 * configurations et workflows adaptés aux secteurs", not separate applications per vertical.
 * Purely data: picking one pre-fills Organization.type (still free-form — see
 * organization.schema.ts) and the onboarding module checkboxes, and creates one starter
 * Workflow using only already-existing triggers/actions. No backend change, no new schema,
 * no closed enum — "Autre" (no template) keeps today's free-text flow exactly as it was.
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
  },
  {
    key: "professional_services",
    label: "Services professionnels",
    description: "Conseil, coaching, agences — suivi commercial et facturation.",
    suggestedType: "services professionnels",
    suggestedModules: ["crm", "catalog", "finance", "workflow", "ai"],
    starterWorkflow: {
      name: "Qualifier un nouveau prospect",
      trigger: "lead.created",
      action: {
        type: "create_task",
        config: { title: "Qualifier le prospect {{leadId}}" },
      },
    },
  },
  {
    key: "training",
    label: "Formation",
    description: "Sessions, ateliers et formations — réservations de places.",
    suggestedType: "formation",
    suggestedModules: ["crm", "catalog", "booking", "finance", "workflow", "ai"],
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
  },
  {
    key: "commerce",
    label: "Commerce & e-commerce",
    description: "Vente de produits, en boutique ou en ligne.",
    suggestedType: "commerce",
    suggestedModules: ["crm", "catalog", "commerce", "finance", "analytics", "ai"],
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
  },
];
