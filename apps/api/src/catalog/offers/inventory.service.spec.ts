import { BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import type { OffersRepository } from './offers.repository';
import type { EventBusService } from '../../core/events/event-bus.service';

function buildService() {
  const findByIds = jest.fn();
  const decrementStockIfAvailable = jest.fn();
  const incrementStock = jest.fn();
  const repository = {
    findByIds,
    decrementStockIfAvailable,
    incrementStock,
  } as unknown as OffersRepository;

  const publish = jest.fn().mockResolvedValue(undefined);
  const eventBus = { publish } as unknown as EventBusService;

  const service = new InventoryService(repository, eventBus);
  return {
    service,
    findByIds,
    decrementStockIfAvailable,
    incrementStock,
    publish,
  };
}

const fakeSession = {} as import('mongoose').ClientSession;

describe('InventoryService.reserveStock', () => {
  it('is a no-op when no line item references an offer', async () => {
    const { service, findByIds, decrementStockIfAvailable } = buildService();

    await service.reserveStock(
      'org-1',
      [{ offerId: undefined, quantity: 2 }],
      fakeSession,
    );

    expect(findByIds).not.toHaveBeenCalled();
    expect(decrementStockIfAvailable).not.toHaveBeenCalled();
  });

  it('skips offers with trackStock: false entirely', async () => {
    const { service, findByIds, decrementStockIfAvailable } = buildService();
    findByIds.mockResolvedValue([{ id: 'offer-1', trackStock: false }]);

    await service.reserveStock(
      'org-1',
      [{ offerId: 'offer-1', quantity: 2 }],
      fakeSession,
    );

    expect(decrementStockIfAvailable).not.toHaveBeenCalled();
  });

  it('sums quantities for the same offerId across multiple line items before reserving once', async () => {
    const { service, findByIds, decrementStockIfAvailable } = buildService();
    findByIds.mockResolvedValue([{ id: 'offer-1', trackStock: true }]);
    decrementStockIfAvailable.mockResolvedValue({
      stockOnHand: 5,
    });

    await service.reserveStock(
      'org-1',
      [
        { offerId: 'offer-1', quantity: 2 },
        { offerId: 'offer-1', quantity: 3 },
      ],
      fakeSession,
    );

    expect(decrementStockIfAvailable).toHaveBeenCalledTimes(1);
    expect(decrementStockIfAvailable).toHaveBeenCalledWith(
      'org-1',
      'offer-1',
      5,
      fakeSession,
    );
  });

  it('throws INSUFFICIENT_STOCK when the repository reports no match, and never publishes an event', async () => {
    const { service, findByIds, decrementStockIfAvailable, publish } =
      buildService();
    findByIds.mockResolvedValue([{ id: 'offer-1', trackStock: true }]);
    decrementStockIfAvailable.mockResolvedValue(null);

    await expect(
      service.reserveStock(
        'org-1',
        [{ offerId: 'offer-1', quantity: 10 }],
        fakeSession,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes offer.stock_depleted only when the decrement brings stockOnHand to exactly 0', async () => {
    const { service, findByIds, decrementStockIfAvailable, publish } =
      buildService();
    findByIds.mockResolvedValue([{ id: 'offer-1', trackStock: true }]);
    decrementStockIfAvailable.mockResolvedValue({
      stockOnHand: 0,
    });

    await service.reserveStock(
      'org-1',
      [{ offerId: 'offer-1', quantity: 5 }],
      fakeSession,
    );

    expect(publish).toHaveBeenCalledWith('org-1', 'offer.stock_depleted', {
      offerId: 'offer-1',
    });
  });

  it('does not publish offer.stock_depleted when stock remains above 0', async () => {
    const { service, findByIds, decrementStockIfAvailable, publish } =
      buildService();
    findByIds.mockResolvedValue([{ id: 'offer-1', trackStock: true }]);
    decrementStockIfAvailable.mockResolvedValue({
      stockOnHand: 3,
    });

    await service.reserveStock(
      'org-1',
      [{ offerId: 'offer-1', quantity: 2 }],
      fakeSession,
    );

    expect(publish).not.toHaveBeenCalled();
  });
});

describe('InventoryService.restockItems', () => {
  it('is a no-op when no line item references an offer', async () => {
    const { service, incrementStock } = buildService();

    await service.restockItems('org-1', [{ offerId: undefined, quantity: 2 }]);

    expect(incrementStock).not.toHaveBeenCalled();
  });

  it('sums quantities for the same offerId before restocking once', async () => {
    const { service, incrementStock } = buildService();
    incrementStock.mockResolvedValue({});

    await service.restockItems('org-1', [
      { offerId: 'offer-1', quantity: 2 },
      { offerId: 'offer-1', quantity: 3 },
    ]);

    expect(incrementStock).toHaveBeenCalledTimes(1);
    expect(incrementStock).toHaveBeenCalledWith(
      'org-1',
      'offer-1',
      5,
      undefined,
    );
  });
});
