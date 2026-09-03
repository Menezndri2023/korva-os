import { Types } from 'mongoose';
import { RecommendationsService } from './recommendations.service';
import type { RecommendationsRepository } from './recommendations.repository';
import type { AuditService } from '../audit/audit.service';

const ORG_ID = '507f1f77bcf86cd799439011';
const ENTITY_ID = '507f1f77bcf86cd799439022';

function buildService(overrides: { createIfNotExists?: jest.Mock } = {}) {
  const createIfNotExists =
    overrides.createIfNotExists ??
    jest.fn().mockResolvedValue({
      id: new Types.ObjectId().toString(),
      status: 'open',
      ruleKey: 'ai_suggestion',
    });
  const recommendationsRepository = {
    createIfNotExists,
  } as unknown as RecommendationsRepository;
  const auditService = {} as unknown as AuditService;

  const service = new RecommendationsService(
    recommendationsRepository,
    auditService,
  );

  return { service, createIfNotExists };
}

describe('RecommendationsService.propose', () => {
  it('rejects a malformed entityId before ever touching the repository', async () => {
    const { service, createIfNotExists } = buildService();

    await expect(
      service.propose(ORG_ID, {
        title: 'Relancer',
        description: 'Ce contact est inactif.',
        entityType: 'contact',
        entityId: 'not-an-object-id',
      }),
    ).rejects.toMatchObject({
      response: { code: 'RECOMMENDATION_INVALID_ENTITY_ID' },
    });
    expect(createIfNotExists).not.toHaveBeenCalled();
  });

  it("creates the recommendation under the fixed 'ai_suggestion' ruleKey, never one supplied by the caller", async () => {
    const { service, createIfNotExists } = buildService();

    await service.propose(ORG_ID, {
      title: 'Relancer',
      description: 'Ce contact est inactif.',
      entityType: 'contact',
      entityId: ENTITY_ID,
    });

    expect(createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({ ruleKey: 'ai_suggestion' }),
    );
  });

  it('surfaces the repository dedup outcome as RECOMMENDATION_ALREADY_EXISTS, not a silent no-op', async () => {
    const { service } = buildService({
      createIfNotExists: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.propose(ORG_ID, {
        title: 'Relancer',
        description: 'Ce contact est inactif.',
        entityType: 'contact',
        entityId: ENTITY_ID,
      }),
    ).rejects.toMatchObject({
      response: { code: 'RECOMMENDATION_ALREADY_EXISTS' },
    });
  });
});
