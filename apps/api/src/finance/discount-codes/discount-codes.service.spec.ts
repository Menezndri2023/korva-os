import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DiscountCodesService } from './discount-codes.service';
import type { DiscountCodesRepository } from './discount-codes.repository';
import type { EventBusService } from '../../core/events/event-bus.service';

function buildService() {
  const findByCode = jest.fn();
  const reserveIfEligible = jest.fn();
  const release = jest.fn();
  const repository = {
    findByCode,
    reserveIfEligible,
    release,
  } as unknown as DiscountCodesRepository;

  const publish = jest.fn().mockResolvedValue(undefined);
  const eventBus = { publish } as unknown as EventBusService;

  const service = new DiscountCodesService(repository, eventBus);
  return { service, findByCode, reserveIfEligible, release, publish };
}

describe('DiscountCodesService.validateAndReserve', () => {
  it('throws DISCOUNT_CODE_NOT_FOUND when no code matches, normalized to uppercase/trimmed', async () => {
    const { service, findByCode } = buildService();
    findByCode.mockResolvedValue(null);

    await expect(
      service.validateAndReserve('org-1', '  save10  ', { offerIds: [] }),
    ).rejects.toThrow(NotFoundException);
    expect(findByCode).toHaveBeenCalledWith('org-1', 'SAVE10');
  });

  it('rejects with DISCOUNT_CODE_INELIGIBLE when scope is "offers" and none of the order offers match, without ever attempting to reserve', async () => {
    const { service, findByCode, reserveIfEligible } = buildService();
    findByCode.mockResolvedValue({
      scope: 'offers',
      offerIds: [{ toString: () => 'offer-a' }],
    });

    await expect(
      service.validateAndReserve('org-1', 'SAVE10', { offerIds: ['offer-b'] }),
    ).rejects.toThrow(BadRequestException);
    expect(reserveIfEligible).not.toHaveBeenCalled();
  });

  it('allows scope "offers" when at least one order offer matches', async () => {
    const { service, findByCode, reserveIfEligible, publish } = buildService();
    findByCode.mockResolvedValue({
      scope: 'offers',
      offerIds: [{ toString: () => 'offer-a' }],
    });
    reserveIfEligible.mockResolvedValue({
      id: 'dc-1',
      type: 'percentage',
      value: 10,
      redemptionsCount: 1,
      maxRedemptions: undefined,
    });

    const result = await service.validateAndReserve('org-1', 'SAVE10', {
      offerIds: ['offer-a', 'offer-b'],
    });

    expect(result).toEqual({
      discountCodeId: 'dc-1',
      resolved: { type: 'percentage', value: 10 },
    });
    expect(publish).toHaveBeenCalledWith('org-1', 'discount_code.redeemed', {
      discountCodeId: 'dc-1',
    });
  });

  it('throws DISCOUNT_CODE_EXHAUSTED when the atomic reservation finds no eligible match', async () => {
    const { service, findByCode, reserveIfEligible, publish } = buildService();
    findByCode.mockResolvedValue({ scope: 'all', offerIds: [] });
    reserveIfEligible.mockResolvedValue(null);

    await expect(
      service.validateAndReserve('org-1', 'SAVE10', { offerIds: [] }),
    ).rejects.toThrow(BadRequestException);
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes discount_code.exhausted in addition to .redeemed once the cap is reached', async () => {
    const { service, findByCode, reserveIfEligible, publish } = buildService();
    findByCode.mockResolvedValue({ scope: 'all', offerIds: [] });
    reserveIfEligible.mockResolvedValue({
      id: 'dc-1',
      type: 'fixed',
      value: 5,
      redemptionsCount: 3,
      maxRedemptions: 3,
    });

    await service.validateAndReserve('org-1', 'SAVE10', { offerIds: [] });

    expect(publish).toHaveBeenCalledWith('org-1', 'discount_code.redeemed', {
      discountCodeId: 'dc-1',
    });
    expect(publish).toHaveBeenCalledWith('org-1', 'discount_code.exhausted', {
      discountCodeId: 'dc-1',
    });
  });

  it('does not publish discount_code.exhausted while redemptions remain under the cap', async () => {
    const { service, findByCode, reserveIfEligible, publish } = buildService();
    findByCode.mockResolvedValue({ scope: 'all', offerIds: [] });
    reserveIfEligible.mockResolvedValue({
      id: 'dc-1',
      type: 'fixed',
      value: 5,
      redemptionsCount: 1,
      maxRedemptions: 3,
    });

    await service.validateAndReserve('org-1', 'SAVE10', { offerIds: [] });

    expect(publish).not.toHaveBeenCalledWith(
      'org-1',
      'discount_code.exhausted',
      expect.anything(),
    );
  });
});

describe('DiscountCodesService.releaseIfApplied', () => {
  it('is a no-op when no discountCodeId is given', async () => {
    const { service, release } = buildService();
    await service.releaseIfApplied('org-1', undefined);
    expect(release).not.toHaveBeenCalled();
  });

  it('forwards to the repository release when a discountCodeId is given', async () => {
    const { service, release } = buildService();
    release.mockResolvedValue({});
    await service.releaseIfApplied('org-1', 'dc-1');
    expect(release).toHaveBeenCalledWith('org-1', 'dc-1', undefined);
  });
});
