import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  CreateSupplierInput,
  ListSuppliersQuery,
  UpdateSupplierInput,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import { SuppliersRepository } from './suppliers.repository';
import { PurchaseOrdersRepository } from './purchase-orders.repository';
import { SupplierDocument } from './schemas/supplier.schema';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly suppliersRepository: SuppliersRepository,
    private readonly purchaseOrdersRepository: PurchaseOrdersRepository,
  ) {}

  create(
    organizationId: string,
    input: CreateSupplierInput,
  ): Promise<SupplierDocument> {
    return this.suppliersRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      ...input,
    });
  }

  async findAll(
    organizationId: string,
    query: ListSuppliersQuery,
  ): Promise<{ data: SupplierDocument[]; pagination: Pagination }> {
    const { data, total } = await this.suppliersRepository.findAll(
      organizationId,
      query,
    );
    return {
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async getById(organizationId: string, id: string): Promise<SupplierDocument> {
    const supplier = await this.suppliersRepository.findById(
      organizationId,
      id,
    );
    if (!supplier) {
      throw new NotFoundException({
        code: 'SUPPLIER_NOT_FOUND',
        message: 'Supplier not found',
      });
    }
    return supplier;
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateSupplierInput,
  ): Promise<SupplierDocument> {
    const updated = await this.suppliersRepository.update(
      organizationId,
      id,
      input,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'SUPPLIER_NOT_FOUND',
        message: 'Supplier not found',
      });
    }
    return updated;
  }

  async delete(organizationId: string, id: string): Promise<void> {
    const hasActiveOrders =
      await this.purchaseOrdersRepository.hasActiveOrdersForSupplier(
        organizationId,
        id,
      );
    if (hasActiveOrders) {
      throw new ConflictException({
        code: 'SUPPLIER_IN_USE',
        message:
          'This supplier cannot be deleted while it still has an active purchase order',
      });
    }

    const deleted = await this.suppliersRepository.delete(organizationId, id);
    if (!deleted) {
      throw new NotFoundException({
        code: 'SUPPLIER_NOT_FOUND',
        message: 'Supplier not found',
      });
    }
  }
}
