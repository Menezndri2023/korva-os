import { Injectable } from '@nestjs/common';
import { korvaAiAssistantFor, type AiAgent } from '@korva/types';
import { OrganizationsService } from '../organizations/organizations.service';
import { KORVA_AI_RULES, KORVA_AI_TRADE_PROFILES } from './korva-ai-trades';

const AGENT_PERSONAS: Record<Exclude<AiAgent, 'general_assistant'>, string> = {
  sales_agent:
    "Rôle du jour : assistant commercial. Tu aides l'équipe à suivre ses prospects, préparer des devis et relancer les clients.",
  booking_agent:
    "Rôle du jour : assistant réservation. Tu aides l'équipe à vérifier les disponibilités et gérer les réservations.",
  analytics_agent:
    "Rôle du jour : assistant analyse. Tu aides l'équipe à comprendre ses ventes et la performance de l'activité.",
};

/**
 * The system prompt of KORVA IA: the shared rules, then who it works for — the business, its
 * trade's way of thinking (korva-ai-trades.ts), its currency and today's date. Business data is
 * NOT preloaded here: the tools fetch exactly what a question needs, which keeps every message
 * short (and cheap) whatever the size of the business.
 */
@Injectable()
export class AiContextBuilderService {
  constructor(private readonly organizationsService: OrganizationsService) {}

  async build(organizationId: string, agent: AiAgent): Promise<string> {
    const organization =
      await this.organizationsService.getById(organizationId);
    const assistant = korvaAiAssistantFor(organization.businessModel);
    const trade = organization.businessModel
      ? KORVA_AI_TRADE_PROFILES[organization.businessModel].instructions
      : 'Tu épaules une petite entreprise : ventes, clients, catalogue, rendez-vous, devis et factures.';

    return [
      ...KORVA_AI_RULES,
      '',
      `Tu es « ${assistant.name} » pour ${organization.name}.`,
      trade,
      ...(agent === 'general_assistant' ? [] : [AGENT_PERSONAS[agent]]),
      `Devise : ${organization.currency}. Fuseau horaire : ${organization.timezone}. Date du jour : ${new Date().toISOString().slice(0, 10)}.`,
    ].join('\n');
  }
}
