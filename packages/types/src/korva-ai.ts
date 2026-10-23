import type { BusinessModel } from "./business-models.ts";

/**
 * KORVA IA: one assistant per type of activity. What the business sees — the assistant's name,
 * how it introduces itself and the questions it suggests to start with. Its instructions and the
 * tools it may use live with the API (apps/api/src/ai/korva-ai-trades.ts), because they are part
 * of what is sent to the model.
 */
export interface KorvaAiTradeAssistant {
  name: string;
  intro: string;
  suggestions: string[];
}

export const KORVA_AI_GENERIC_ASSISTANT: KorvaAiTradeAssistant = {
  name: "Assistant KORVA",
  intro: "Je connais vos clients, vos ventes et votre catalogue. Posez-moi une question ou demandez-moi une action.",
  suggestions: [
    "Fais-moi le point sur mon activité ce mois-ci.",
    "Quels clients n'ont rien acheté depuis 2 mois ?",
    "Quelles sont mes offres qui se vendent le moins ?",
    "Quelles actions me recommandes-tu cette semaine ?",
  ],
};

export const KORVA_AI_TRADE_ASSISTANTS: Record<BusinessModel, KorvaAiTradeAssistant> = {
  retail: {
    name: "Assistant KORVA Boutique",
    intro: "Je suis votre bras droit pour la boutique : ventes, stock, clients fidèles et réassort.",
    suggestions: [
      "Quels produits dois-je recommander avant d'être en rupture ?",
      "Quels articles ne se vendent plus depuis un mois ?",
      "Fais-moi le bilan des ventes de cette semaine.",
      "Rédige un message WhatsApp pour mes meilleures clientes.",
    ],
  },
  restaurant: {
    name: "Assistant KORVA Restauration",
    intro: "Je vous aide à suivre les commandes, les plats qui marchent et vos clients habitués.",
    suggestions: [
      "Quels plats se sont le plus vendus cette semaine ?",
      "Quels plats ne commande presque personne ?",
      "Combien de commandes avons-nous eues hier ?",
      "Prépare un message pour annoncer le plat du jour à mes clients.",
    ],
  },
  appointments: {
    name: "Assistant KORVA Rendez-vous",
    intro: "Je gère votre agenda avec vous : créneaux libres, rendez-vous et clients à relancer.",
    suggestions: [
      "Quels créneaux sont encore libres demain ?",
      "Quels clients ne sont pas revenus depuis 2 mois ?",
      "Quelle prestation est la plus demandée ce mois-ci ?",
      "Prépare un rappel pour les clients de samedi.",
    ],
  },
  lodging: {
    name: "Assistant KORVA Hébergement",
    intro: "Je vous aide à suivre vos séjours, vos chambres disponibles et vos clients.",
    suggestions: [
      "Quelles chambres sont libres ce week-end ?",
      "Combien de nuits avons-nous vendues ce mois-ci ?",
      "Quels clients arrivent cette semaine ?",
      "Rédige un message de bienvenue pour les prochains arrivants.",
    ],
  },
  training: {
    name: "Assistant KORVA Formation",
    intro: "Je vous aide à remplir vos sessions, suivre vos apprenants et vos inscriptions.",
    suggestions: [
      "Quelles sessions ont encore des places ?",
      "Quelles formations attirent le plus d'inscrits ?",
      "Quels apprenants relancer pour la prochaine session ?",
      "Fais-moi le bilan des inscriptions du mois.",
    ],
  },
  quotes: {
    name: "Assistant KORVA Devis & Chantiers",
    intro: "Je vous aide à suivre vos demandes, vos devis en attente et vos clients à relancer.",
    suggestions: [
      "Quels devis attendent encore une réponse ?",
      "Quelles demandes n'ont pas été traitées cette semaine ?",
      "Prépare un devis pour un nouveau client.",
      "Quels clients relancer aujourd'hui ?",
    ],
  },
  real_estate: {
    name: "Assistant KORVA Immobilier",
    intro: "Je vous aide à suivre vos biens, vos prospects et les visites à organiser.",
    suggestions: [
      "Quels prospects n'ont pas été recontactés depuis une semaine ?",
      "Quels biens suscitent le plus de demandes ?",
      "Quelles affaires sont proches de se conclure ?",
      "Rédige une relance pour les prospects d'hier.",
    ],
  },
  association: {
    name: "Assistant KORVA Association",
    intro: "Je vous aide à suivre vos membres, les adhésions et la vie de l'association.",
    suggestions: [
      "Combien de nouvelles adhésions ce mois-ci ?",
      "Quels membres n'ont pas renouvelé leur adhésion ?",
      "Prépare un message pour annoncer notre prochain événement.",
      "Fais-moi le point sur l'activité de l'association.",
    ],
  },
};

export function korvaAiAssistantFor(model: BusinessModel | undefined | null): KorvaAiTradeAssistant {
  return model ? KORVA_AI_TRADE_ASSISTANTS[model] : KORVA_AI_GENERIC_ASSISTANT;
}

/** GET /ai/status — whether the business's assistant can answer right now, and as whom. */
export interface KorvaAiStatus {
  /** false: no brain configured on the platform yet; messages are not counted. */
  available: boolean;
  /** true: the platform's monthly budget is used up; back on the 1st. */
  paused: boolean;
  assistant: KorvaAiTradeAssistant;
}

/** The administration's view (GET /platform/system → ai). */
export interface KorvaAiSystemStatus {
  configured: boolean;
  provider: string;
  model: string | null;
  /** Why it is not configured, in the administrator's words. */
  reason: string | null;
  monthlyBudgetUsd: number | null;
  spentThisMonthUsd: number;
  callsThisMonth: number;
  /** Calls whose model has no known price — the spend above then undercounts. */
  unpricedCalls: number;
  topOrganizations: { organizationId: string; name: string; costUsd: number; calls: number }[];
  /** Questions asked by businesses this month (the quota counter), not model calls. */
  messagesThisMonth: number;
  /** Businesses that asked at least one question this month. */
  activeOrganizationsThisMonth: number;
  /** The last 30 days, oldest first, every day present (zeros included). */
  daily: { day: string; calls: number; costUsd: number; organizations: number }[];
}
