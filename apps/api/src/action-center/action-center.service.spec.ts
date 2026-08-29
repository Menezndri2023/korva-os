import { Types } from 'mongoose';
import { ActionCenterService } from './action-center.service';

function makeModel(
  overrides: {
    countDocuments?: jest.Mock;
    findResults?: unknown[];
  } = {},
) {
  return {
    countDocuments: overrides.countDocuments ?? jest.fn().mockResolvedValue(0),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(overrides.findResults ?? []),
        }),
      }),
    }),
  };
}

describe('ActionCenterService', () => {
  const ORG_ID = '507f1f77bcf86cd799439011';

  function buildService(
    overrides: {
      aiPendingActionModel?: ReturnType<typeof makeModel>;
      recommendationModel?: ReturnType<typeof makeModel>;
      workflowExecutionModel?: ReturnType<typeof makeModel>;
    } = {},
  ) {
    const aiPendingActionModel = overrides.aiPendingActionModel ?? makeModel();
    const recommendationModel = overrides.recommendationModel ?? makeModel();
    const workflowExecutionModel =
      overrides.workflowExecutionModel ?? makeModel();

    const service = new ActionCenterService(
      aiPendingActionModel as never,
      recommendationModel as never,
      workflowExecutionModel as never,
    );

    return {
      service,
      aiPendingActionModel,
      recommendationModel,
      workflowExecutionModel,
    };
  }

  describe('getSummary', () => {
    it('scopes every count to the requesting organization only', async () => {
      const {
        service,
        aiPendingActionModel,
        recommendationModel,
        workflowExecutionModel,
      } = buildService();

      await service.getSummary(ORG_ID);

      for (const model of [
        aiPendingActionModel,
        recommendationModel,
        workflowExecutionModel,
      ]) {
        expect(model.countDocuments).toHaveBeenCalled();
        for (const call of model.countDocuments.mock.calls as unknown[][]) {
          const filter = call[0] as { organizationId: Types.ObjectId };
          expect(filter.organizationId.toString()).toBe(ORG_ID);
        }
      }
    });

    it('counts AiPendingAction in both pending and confirming as pendingApprovals', async () => {
      const countDocuments = jest.fn().mockResolvedValue(3);
      const { service } = buildService({
        aiPendingActionModel: makeModel({ countDocuments }),
      });

      const summary = await service.getSummary(ORG_ID);

      expect(summary.pendingApprovals).toBe(3);
      const call = countDocuments.mock.calls[0] as unknown[];
      const filter = call[0] as {
        status: { $in: string[] };
      };
      expect(filter.status.$in).toEqual(['pending', 'confirming']);
    });

    it('counts only open Recommendations', async () => {
      const countDocuments = jest.fn().mockResolvedValue(7);
      const { service } = buildService({
        recommendationModel: makeModel({ countDocuments }),
      });

      const summary = await service.getSummary(ORG_ID);

      expect(summary.recommendations).toBe(7);
      const call = countDocuments.mock.calls[0] as unknown[];
      const filter = call[0] as { status: string };
      expect(filter.status).toBe('open');
    });

    it('counts success/failed WorkflowExecutions within the last 7 days as automatedThisWeek/failures', async () => {
      const countDocuments = jest
        .fn()
        .mockResolvedValueOnce(24)
        .mockResolvedValueOnce(2);
      const { service } = buildService({
        workflowExecutionModel: makeModel({ countDocuments }),
      });

      const summary = await service.getSummary(ORG_ID);

      expect(summary.automatedThisWeek).toBe(24);
      expect(summary.failures).toBe(2);
      const firstCall = countDocuments.mock.calls[0] as unknown[];
      const secondCall = countDocuments.mock.calls[1] as unknown[];
      const successFilter = firstCall[0] as {
        status: string;
        createdAt: { $gte: Date };
      };
      const failedFilter = secondCall[0] as {
        status: string;
      };
      expect(successFilter.status).toBe('success');
      expect(successFilter.createdAt.$gte.getTime()).toBeLessThan(Date.now());
      expect(failedFilter.status).toBe('failed');
    });
  });

  describe('getFeed', () => {
    it('merges items from all three sources and sorts them most-recent-first', async () => {
      const { service } = buildService({
        aiPendingActionModel: makeModel({
          findResults: [
            {
              id: 'pa-1',
              toolName: 'send_email',
              conversationId: new Types.ObjectId(),
              createdAt: new Date('2026-01-01T00:00:00Z'),
            },
          ],
        }),
        recommendationModel: makeModel({
          findResults: [
            {
              id: 'rec-1',
              title: 'Client inactif à relancer',
              description: 'desc',
              entityType: 'contact',
              entityId: new Types.ObjectId(),
              createdAt: new Date('2026-03-01T00:00:00Z'),
            },
          ],
        }),
        workflowExecutionModel: makeModel({
          findResults: [
            {
              id: 'exec-1',
              eventName: 'invoice.overdue',
              error: 'boom',
              workflowId: new Types.ObjectId(),
              createdAt: new Date('2026-02-01T00:00:00Z'),
            },
          ],
        }),
      });

      const feed = await service.getFeed(ORG_ID);

      expect(feed.map((item) => item.type)).toEqual([
        'recommendation',
        'workflow_failure',
        'pending_approval',
      ]);
      expect(feed[0]?.title).toBe('Client inactif à relancer');
      expect(feed[1]?.title).toBe(
        'Échec d\'automatisation pour l\'événement "invoice.overdue"',
      );
      expect(feed[2]?.title).toBe('Confirmation requise : send_email');
    });
  });
});
