import { Injectable } from '@nestjs/common';
import { korvaAiAssistantFor, type AiAgent } from '@korva/types';
import { OrganizationsService } from '../organizations/organizations.service';
import { KORVA_AI_RULES, KORVA_AI_TRADE_PROFILES } from './korva-ai-trades';
import { orgLocale } from '../shared/i18n';

function todayInWords(timeZone: string): string {
  const now = new Date();
  const words = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(now);
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  return `${words} (${iso})`;
}

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
    const locale = orgLocale(organization.language);
    const assistant = korvaAiAssistantFor(organization.businessModel, locale);
    const trade = organization.businessModel
      ? KORVA_AI_TRADE_PROFILES[organization.businessModel].instructions
      : 'Tu épaules une petite entreprise : ventes, clients, catalogue, rendez-vous, devis et factures.';

    return [
      ...KORVA_AI_RULES,
      // The business's language (shared/i18n.ts); the instructions stay French, the model follows.
      locale === 'en'
        ? "Tu réponds toujours en anglais : l'entreprise travaille en anglais. Si l'utilisateur t'écrit en français, réponds en français."
        : "Tu réponds toujours en français. Si l'utilisateur t'écrit en anglais, réponds en anglais.",
      '',
      `Tu es « ${assistant.name} » pour ${organization.name}.`,
      trade,
      ...(agent === 'general_assistant' ? [] : [AGENT_PERSONAS[agent]]),
      `Devise : ${organization.currency}. Fuseau horaire : ${organization.timezone}.`,
      // The weekday spelled out: given only "2026-10-23", a model computed "après-demain" right
      // but called a Sunday "samedi" (seen with a real model on 2026-10-23).
      `Aujourd'hui : ${todayInWords(organization.timezone)}.`,
    ].join('\n');
  }
}
