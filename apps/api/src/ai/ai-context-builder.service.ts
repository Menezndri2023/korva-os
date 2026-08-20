import { Injectable } from '@nestjs/common';
import type { AiAgent } from '@korva/types';
import { OrganizationsService } from '../organizations/organizations.service';

const AGENT_PERSONAS: Record<AiAgent, string> = {
  general_assistant:
    "Tu es l'assistant général de KORVA OS. Tu aides l'équipe sur toutes les questions liées à leur activité (CRM, catalogue, réservations, commandes, facturation).",
  sales_agent:
    "Tu es l'assistant commercial de KORVA OS. Tu aides l'équipe à suivre ses prospects, préparer des devis et relancer les clients.",
  booking_agent:
    "Tu es l'assistant réservation de KORVA OS. Tu aides l'équipe à vérifier les disponibilités et gérer les réservations.",
  analytics_agent:
    "Tu es l'assistant analytique de KORVA OS. Tu aides l'équipe à comprendre les ventes et la performance de l'activité.",
};

/**
 * MVP scope: builds an org-level framing preamble for the system prompt (name, sector,
 * modules enabled, current date) rather than pre-fetching business/customer data — the
 * tool-calling loop already lets the model fetch exactly the data it needs on demand
 * (search_leads, get_customer, ...), so preloading a large context block on every turn
 * would be redundant. "Customer context" (docs/ai.md memory tier) is therefore satisfied
 * via tools, not via this builder. See docs/architecture-decisions.md.
 */
@Injectable()
export class AiContextBuilderService {
  constructor(private readonly organizationsService: OrganizationsService) {}

  async build(organizationId: string, agent: AiAgent): Promise<string> {
    const organization =
      await this.organizationsService.getById(organizationId);
    const today = new Date().toISOString().slice(0, 10);

    return [
      AGENT_PERSONAS[agent],
      '',
      `Organisation : ${organization.name} (secteur : ${organization.type}).`,
      `Date du jour : ${today}.`,
      "Utilise les outils à ta disposition pour consulter ou modifier des données réelles — ne jamais inventer d'informations sur les clients, prospects, devis, réservations ou commandes.",
      "Si une information nécessaire n'est pas disponible via un outil, dis-le clairement plutôt que de deviner.",
    ].join('\n');
  }
}
