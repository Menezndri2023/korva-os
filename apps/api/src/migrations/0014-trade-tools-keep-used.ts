import type { MigrationDefinition } from '../core/migrations/migration.types';
import {
  BUSINESS_MODEL_DEFINITIONS,
  TRADE_TOOLS,
  type BusinessModel,
  type TradeTool,
} from '@korva/types';

/** The collection whose documents prove an organization already uses each trade tool. */
const TOOL_COLLECTIONS: Record<TradeTool, string> = {
  orders: 'orders',
  returns: 'return_requests',
  bookings: 'bookings',
};

/**
 * The menu now shows each trade only its own tools (BusinessModelDefinition.tools). An
 * organization already working with a tool its trade does not list — a salon that sells products
 * and takes orders — must not see it disappear on deploy day. For each such organization, every
 * tool it has at least one document for is written into Organization.extraTools, exactly as if
 * the owner had brought it back from Settings › Autres outils.
 *
 * Additive and idempotent: $addToSet, never removes a tool, and an organization without a type of
 * activity is skipped (it keeps seeing every tool anyway).
 */
export const migration: MigrationDefinition = {
  name: '0014-trade-tools-keep-used',
  async up(connection) {
    const organizations = connection.collection('organizations');
    const cursor = organizations.find(
      { businessModel: { $exists: true } },
      { projection: { _id: 1, businessModel: 1 } },
    );
    for await (const organization of cursor) {
      const definition =
        BUSINESS_MODEL_DEFINITIONS[organization.businessModel as BusinessModel];
      if (!definition) continue;
      const used: TradeTool[] = [];
      for (const tool of TRADE_TOOLS) {
        if (definition.tools.includes(tool)) continue;
        const found = await connection
          .collection(TOOL_COLLECTIONS[tool])
          .findOne(
            { organizationId: organization._id },
            { projection: { _id: 1 } },
          );
        if (found) used.push(tool);
      }
      if (used.length === 0) continue;
      await organizations.updateOne(
        { _id: organization._id },
        {
          $addToSet: { extraTools: { $each: used } },
          $set: { updatedAt: new Date() },
        },
      );
    }
  },
};

export default migration;
