import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  CreateWarehouseInput,
  UpdateWarehouseInput,
} from '@korva/validation';
import { WarehousesRepository } from './warehouses.repository';
import { StockLevelsRepository } from './stock-levels.repository';
import { WarehouseDocument } from './schemas/warehouse.schema';

@Injectable()
export class WarehousesService {
  constructor(
    private readonly warehousesRepository: WarehousesRepository,
    private readonly stockLevelsRepository: StockLevelsRepository,
  ) {}

  /** The very first warehouse an organization creates is automatically its default — matches
   *  the same "the org's first pipeline is its default" convention already established for CRM
   *  Pipelines, so an org that only ever creates one warehouse never has to think about the
   *  isDefault flag at all. */
  async create(
    organizationId: string,
    input: CreateWarehouseInput,
  ): Promise<WarehouseDocument> {
    const existingCount =
      await this.warehousesRepository.countForOrganization(organizationId);
    const isDefault = existingCount === 0 ? true : (input.isDefault ?? false);
    if (isDefault) {
      await this.warehousesRepository.unsetDefaultForOthers(organizationId);
    }

    return this.warehousesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name: input.name,
      address: input.address,
      isDefault,
    });
  }

  list(organizationId: string): Promise<WarehouseDocument[]> {
    return this.warehousesRepository.findAllForOrganization(organizationId);
  }

  async getById(
    organizationId: string,
    id: string,
  ): Promise<WarehouseDocument> {
    const warehouse = await this.warehousesRepository.findById(
      organizationId,
      id,
    );
    if (!warehouse) {
      throw new NotFoundException({
        code: 'WAREHOUSE_NOT_FOUND',
        message: 'Warehouse not found',
      });
    }
    return warehouse;
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateWarehouseInput,
  ): Promise<WarehouseDocument> {
    if (input.isDefault) {
      await this.warehousesRepository.unsetDefaultForOthers(organizationId, id);
    }
    const updated = await this.warehousesRepository.update(
      organizationId,
      id,
      input,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'WAREHOUSE_NOT_FOUND',
        message: 'Warehouse not found',
      });
    }
    return updated;
  }

  async delete(organizationId: string, id: string): Promise<void> {
    const hasStock = await this.stockLevelsRepository.existsForWarehouse(
      organizationId,
      id,
    );
    if (hasStock) {
      throw new ConflictException({
        code: 'WAREHOUSE_IN_USE',
        message:
          'This warehouse cannot be deleted while it still holds stock — move or clear its stock first',
      });
    }

    const deleted = await this.warehousesRepository.delete(organizationId, id);
    if (!deleted) {
      throw new NotFoundException({
        code: 'WAREHOUSE_NOT_FOUND',
        message: 'Warehouse not found',
      });
    }
  }
}
