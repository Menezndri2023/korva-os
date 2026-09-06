import { FilterQuery, Types } from 'mongoose';
import type { SegmentCriteria, SegmentRule } from '@korva/types';
import type { Contact } from '../../crm/contacts/schemas/contact.schema';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "tag" -> the Contact.tags array field; "customField:<key>" -> the corresponding
 *  Contact.customFields.<key> path. Any other shape is a data-integrity bug (the service layer
 *  validates every rule's field before a Segment is ever saved) — throwing here rather than
 *  silently building a wrong/empty filter. */
function resolveFieldPath(field: string): string {
  if (field === 'tag') return 'tags';
  if (
    field.startsWith('customField:') &&
    field.length > 'customField:'.length
  ) {
    return `customFields.${field.slice('customField:'.length)}`;
  }
  throw new Error(`Unrecognized segment rule field: "${field}"`);
}

function buildRuleClause(rule: SegmentRule): Record<string, unknown> {
  const path = resolveFieldPath(rule.field);
  switch (rule.operator) {
    case 'has_tag':
    case 'equals':
      return { [path]: rule.value };
    case 'not_has_tag':
      return { [path]: { $nin: [rule.value] } };
    case 'not_equals':
      return { [path]: { $ne: rule.value } };
    case 'contains':
      return {
        [path]: {
          $regex: escapeRegExp(String(rule.value ?? '')),
          $options: 'i',
        },
      };
    case 'is_set':
      return { [path]: { $exists: true } };
    case 'is_not_set':
      return { [path]: { $exists: false } };
    default: {
      const exhaustive: never = rule.operator;
      throw new Error(
        `Unhandled segment rule operator: "${String(exhaustive)}"`,
      );
    }
  }
}

/**
 * Builds a tenant-scoped Mongo filter from a Segment's saved criteria. `organizationId` is
 * ALWAYS hard-coded here, never assembled from rule input — this is the single load-bearing
 * tenant-isolation guarantee for the whole Segment feature, since (unlike every other repository
 * in this codebase) this filter is built from user-authored data, not fixed developer-written
 * fields.
 */
export function buildContactFilter(
  organizationId: string,
  criteria: SegmentCriteria,
): FilterQuery<Contact> {
  const clauses = criteria.rules.map(buildRuleClause);
  const combinator = criteria.match === 'any' ? '$or' : '$and';
  return {
    organizationId: new Types.ObjectId(organizationId),
    ...(clauses.length > 0 ? { [combinator]: clauses } : {}),
  };
}
