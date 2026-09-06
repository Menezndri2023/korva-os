export interface Warehouse {
  id: string;
  organizationId: string;
  name: string;
  address?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Per-warehouse breakdown of an offer's (or one of its variant's) stock — see the API-side
 * StockLevel schema doc comment for the full Phase C2 design. Never created/edited directly by
 * a human; rows exist only once a stock operation has targeted a specific warehouse.
 */
export interface StockLevel {
  id: string;
  organizationId: string;
  offerId: string;
  variantId?: string | null;
  warehouseId: string;
  quantity: number;
  createdAt: string;
  updatedAt: string;
}
