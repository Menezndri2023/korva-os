import { BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import type { OffersRepository } from './offers.repository';
import type { StockMovementsRepository } from './stock-movements.repository';
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

  const createMovement = jest.fn().mockResolvedValue({});
  const stockMovementsRepository = {
    create: createMovement,
  } as unknown as StockMovementsRepository;

  const publish = jest.fn().mockResolvedValue(undefined);
  const eventBus = { publish } as unknown as EventBusService;

  const service = new InventoryService(
    repository,
    stockMovementsRepository,
    eventBus,
  );
  return {
    service,
    findByIds,
    decrementStockIfAvailable,
    incrementStock,
    createMovement,
    publish,
  };
}

const fakeSession = {} as import('mongoose').ClientSession;

describe('InventoryService.reserveStock', () => {
  it('is a no-op when no line item references an offer', async () => {
    const { service, findByIds, decrementStockIfAvailable } = buildService();

    await service.reserveStock(
      '507f1f77bcf86cd799439011',
      [{ offerId: undefined, quantity: 2 }],
      fakeSession,
    );

    expect(findByIds).not.toHaveBeenCalled();
    expect(decrementStockIfAvailable).not.toHaveBeenCalled();
  });

  it('skips offers with trackStock: false entirely', async () => {
    const { service, findByIds, decrementStockIfAvailable } = buildService();
    findByIds.mockResolvedValue([{ id: '507f1f77bcf86cd799439022', trackStock: false }]);

    await service.reserveStock(
      '507f1f77bcf86cd799439011',
      [{ offerId: '507f1f77bcf86cd799439022', quantity: 2 }],
      fakeSession,
    );

    expect(decrementStockIfAvailable).not.toHaveBeenCalled();
  });

  it('sums quantities for the same (offerId, variantId) pair across multiple line items before reserving once', async () => {
    const { service, findByIds, decrementStockIfAvailable } = buildService();
    findByIds.mockResolvedValue([{ id: '507f1f77bcf86cd799439022', trackStock: true }]);
    decrementStockIfAvailable.mockResolvedValue({
      offer: { id: '507f1f77bcf86cd799439022' },
      stockAfter: 5,
    });

    await service.reserveStock(
      '507f1f77bcf86cd799439011',
      [
        { offerId: '507f1f77bcf86cd799439022', quantity: 2 },
        { offerId: '507f1f77bcf86cd799439022', quantity: 3 },
      ],
      fakeSession,
    );

    expect(decrementStockIfAvailable).toHaveBeenCalledTimes(1);
    expect(decrementStockIfAvailable).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      '507f1f77bcf86cd799439022',
      5,
      undefined,
      fakeSession,
    );
  });

  it('keeps two different variants of the same offer as separate lines, never summed together', async () => {
    const { service, findByIds, decrementStockIfAvailable } = buildService();
    findByIds.mockResolvedValue([{ id: '507f1f77bcf86cd799439022', trackStock: true }]);
    decrementStockIfAvailable.mockResolvedValue({
      offer: { id: '507f1f77bcf86cd799439022' },
      stockAfter: 1,
    });

    await service.reserveStock(
      '507f1f77bcf86cd799439011',
      [
        { offerId: '507f1f77bcf86cd799439022', variantId: '507f1f77bcf86cd799439033', quantity: 1 },
        { offerId: '507f1f77bcf86cd799439022', variantId: '507f1f77bcf86cd799439044', quantity: 1 },
      ],
      fakeSession,
    );

    expect(decrementStockIfAvailable).toHaveBeenCalledTimes(2);
    expect(decrementStockIfAvailable).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      '507f1f77bcf86cd799439022',
      1,
      '507f1f77bcf86cd799439033',
      fakeSession,
    );
    expect(decrementStockIfAvailable).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      '507f1f77bcf86cd799439022',
      1,
      '507f1f77bcf86cd799439044',
      fakeSession,
    );
  });

  it('throws INSUFFICIENT_STOCK when the repository reports no match, and never publishes an event', async () => {
    const { service, findByIds, decrementStockIfAvailable, publish } =
      buildService();
    findByIds.mockResolvedValue([{ id: '507f1f77bcf86cd799439022', trackStock: true }]);
    decrementStockIfAvailable.mockResolvedValue(null);

    await expect(
      service.reserveStock(
        '507f1f77bcf86cd799439011',
        [{ offerId: '507f1f77bcf86cd799439022', quantity: 10 }],
        fakeSession,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(publish).not.toHaveBeenCalled();
  });

  it('records a "sold" StockMovement with the signed (negative) quantity and resulting stockAfter', async () => {
    const { service, findByIds, decrementStockIfAvailable, createMovement } =
      buildService();
    findByIds.mockResolvedValue([{ id: '507f1f77bcf86cd799439022', trackStock: true }]);
    decrementStockIfAvailable.mockResolvedValue({
      offer: { id: '507f1f77bcf86cd799439022' },
      stockAfter: 5,
    });

    await service.reserveStock(
      '507f1f77bcf86cd799439011',
      [{ offerId: '507f1f77bcf86cd799439022', quantity: 2 }],
      fakeSession,
    );

    expect(createMovement).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sold', quantity: -2, stockAfter: 5 }),
    );
  });

  it('publishes offer.stock_depleted only when the decrement brings stock to exactly 0', async () => {
    const { service, findByIds, decrementStockIfAvailable, publish } =
      buildService();
    findByIds.mockResolvedValue([{ id: '507f1f77bcf86cd799439022', trackStock: true }]);
    decrementStockIfAvailable.mockResolvedValue({
      offer: { id: '507f1f77bcf86cd799439022' },
      stockAfter: 0,
    });

    await service.reserveStock(
      '507f1f77bcf86cd799439011',
      [{ offerId: '507f1f77bcf86cd799439022', quantity: 5 }],
      fakeSession,
    );

    expect(publish).toHaveBeenCalledWith('507f1f77bcf86cd799439011', 'offer.stock_depleted', {
      offerId: '507f1f77bcf86cd799439022',
      variantId: undefined,
    });
  });

  it('does not publish anything when stock remains above 0 and no lowStockThreshold is configured', async () => {
    const { service, findByIds, decrementStockIfAvailable, publish } =
      buildService();
    findByIds.mockResolvedValue([{ id: '507f1f77bcf86cd799439022', trackStock: true }]);
    decrementStockIfAvailable.mockResolvedValue({
      offer: { id: '507f1f77bcf86cd799439022' },
      stockAfter: 3,
    });

    await service.reserveStock(
      '507f1f77bcf86cd799439011',
      [{ offerId: '507f1f77bcf86cd799439022', quantity: 2 }],
      fakeSession,
    );

    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes offer.low_stock once stock drops to or below a configured lowStockThreshold', async () => {
    const { service, findByIds, decrementStockIfAvailable, publish } =
      buildService();
    findByIds.mockResolvedValue([
      { id: '507f1f77bcf86cd799439022', trackStock: true, lowStockThreshold: 5 },
    ]);
    decrementStockIfAvailable.mockResolvedValue({
      offer: { id: '507f1f77bcf86cd799439022', lowStockThreshold: 5 },
      stockAfter: 5,
    });

    await service.reserveStock(
      '507f1f77bcf86cd799439011',
      [{ offerId: '507f1f77bcf86cd799439022', quantity: 1 }],
      fakeSession,
    );

    expect(publish).toHaveBeenCalledWith('507f1f77bcf86cd799439011', 'offer.low_stock', {
      offerId: '507f1f77bcf86cd799439022',
      variantId: undefined,
      stockOnHand: 5,
      lowStockThreshold: 5,
    });
  });

  it('never publishes offer.low_stock when lowStockThreshold is unset (0 stays covered by stock_depleted alone)', async () => {
    const { service, findByIds, decrementStockIfAvailable, publish } =
      buildService();
    findByIds.mockResolvedValue([{ id: '507f1f77bcf86cd799439022', trackStock: true }]);
    decrementStockIfAvailable.mockResolvedValue({
      offer: { id: '507f1f77bcf86cd799439022' },
      stockAfter: 0,
    });

    await service.reserveStock(
      '507f1f77bcf86cd799439011',
      [{ offerId: '507f1f77bcf86cd799439022', quantity: 1 }],
      fakeSession,
    );

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      'offer.stock_depleted',
      expect.anything(),
    );
  });
});

describe('InventoryService.restockItems', () => {
  it('is a no-op when no line item references an offer', async () => {
    const { service, incrementStock } = buildService();

    await service.restockItems('507f1f77bcf86cd799439011', [{ offerId: undefined, quantity: 2 }]);

    expect(incrementStock).not.toHaveBeenCalled();
  });

  it('sums quantities for the same (offerId, variantId) pair before restocking once', async () => {
    const { service, incrementStock } = buildService();
    incrementStock.mockResolvedValue({ offer: {}, stockAfter: 5 });

    await service.restockItems('507f1f77bcf86cd799439011', [
      { offerId: '507f1f77bcf86cd799439022', quantity: 2 },
      { offerId: '507f1f77bcf86cd799439022', quantity: 3 },
    ]);

    expect(incrementStock).toHaveBeenCalledTimes(1);
    expect(incrementStock).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      '507f1f77bcf86cd799439022',
      5,
      undefined,
      undefined,
    );
  });

  it('records a "returned" StockMovement with the positive quantity and resulting stockAfter', async () => {
    const { service, incrementStock, createMovement } = buildService();
    incrementStock.mockResolvedValue({ offer: {}, stockAfter: 8 });

    await service.restockItems('507f1f77bcf86cd799439011', [{ offerId: '507f1f77bcf86cd799439022', quantity: 3 }]);

    expect(createMovement).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'returned', quantity: 3, stockAfter: 8 }),
    );
  });

  it('skips recording a movement when the repository finds nothing to restock', async () => {
    const { service, incrementStock, createMovement } = buildService();
    incrementStock.mockResolvedValue(null);

    await service.restockItems('507f1f77bcf86cd799439011', [{ offerId: '507f1f77bcf86cd799439022', quantity: 3 }]);

    expect(createMovement).not.toHaveBeenCalled();
  });
});
