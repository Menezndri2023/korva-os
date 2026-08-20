import { Injectable, NotFoundException } from '@nestjs/common';
import type { KorvaModule } from '@korva/types';
import { KORVA_MODULES } from '@korva/types';
import { PlansRepository } from './plans.repository';
import { PlanDocument } from './schemas/plan.schema';

const ALL_MODULES = [...KORVA_MODULES] as KorvaModule[];
const STARTER_MODULES = ALL_MODULES.filter(
  (m) => m !== 'workflow' && m !== 'ai',
);

/**
 * Default plan catalog. Every new organization starts on "free": deliberately generous
 * (every module, small-but-usable limits) so onboarding never breaks for an org that hasn't
 * chosen a paid plan yet. "starter" exists specifically to demonstrate real module-tier
 * restrictions (excludes workflow/ai).
 */
const DEFAULT_PLANS = [
  {
    key: 'free',
    name: 'Free',
    priceAmount: 0,
    priceCurrency: 'EUR',
    interval: 'month' as const,
    modules: ALL_MODULES,
    limits: { seats: 3, ai_messages_per_month: 5 },
  },
  {
    key: 'starter',
    name: 'Starter',
    priceAmount: 29,
    priceCurrency: 'EUR',
    interval: 'month' as const,
    modules: STARTER_MODULES,
    limits: { seats: 10, ai_messages_per_month: 100 },
  },
  {
    key: 'pro',
    name: 'Pro',
    priceAmount: 99,
    priceCurrency: 'EUR',
    interval: 'month' as const,
    modules: ALL_MODULES,
    limits: { seats: 25, ai_messages_per_month: 1000 },
  },
  {
    key: 'business',
    name: 'Business',
    priceAmount: 299,
    priceCurrency: 'EUR',
    interval: 'month' as const,
    modules: ALL_MODULES,
    limits: { seats: -1, ai_messages_per_month: -1 },
  },
];

@Injectable()
export class PlansService {
  private seeded = false;

  constructor(private readonly plansRepository: PlansRepository) {}

  /**
   * Seeds lazily on first real access rather than in OnModuleInit: an app-boot hook runs
   * once, but e2e tests call `connection.dropDatabase()` in their own beforeAll AFTER boot
   * to reset tenant isolation between files — that would silently wipe a boot-time seed with
   * nothing to repopulate it. Seeding on first access is self-healing regardless of when the
   * database gets reset. See docs/architecture-decisions.md.
   */
  private async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    for (const plan of DEFAULT_PLANS) {
      await this.plansRepository.upsertByKey(plan.key, plan);
    }
    this.seeded = true;
  }

  async list(): Promise<PlanDocument[]> {
    await this.ensureSeeded();
    return this.plansRepository.findAll();
  }

  async getByKey(key: string): Promise<PlanDocument> {
    await this.ensureSeeded();
    const plan = await this.plansRepository.findByKey(key);
    if (!plan) {
      throw new NotFoundException({
        code: 'PLAN_NOT_FOUND',
        message: `Unknown plan "${key}"`,
      });
    }
    return plan;
  }

  async getById(id: string): Promise<PlanDocument> {
    await this.ensureSeeded();
    const plan = await this.plansRepository.findById(id);
    if (!plan) {
      throw new NotFoundException({
        code: 'PLAN_NOT_FOUND',
        message: 'Plan not found',
      });
    }
    return plan;
  }
}
