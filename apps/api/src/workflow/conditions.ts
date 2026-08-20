import type { WorkflowCondition } from '@korva/types';

function getByPath(payload: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value === null || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  }, payload);
}

function evaluateOne(
  condition: WorkflowCondition,
  payload: Record<string, unknown>,
): boolean {
  const actual = getByPath(payload, condition.field);

  switch (condition.operator) {
    case 'equals':
      return actual === condition.value;
    case 'not_equals':
      return actual !== condition.value;
    case 'greater_than':
      return (
        typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual > condition.value
      );
    case 'less_than':
      return (
        typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual < condition.value
      );
    case 'contains':
      if (typeof actual === 'string' && typeof condition.value === 'string') {
        return actual.includes(condition.value);
      }
      if (Array.isArray(actual)) {
        return actual.includes(condition.value);
      }
      return false;
  }
}

/** All conditions must pass (AND) — an empty list always matches. */
export function evaluateConditions(
  conditions: WorkflowCondition[],
  payload: Record<string, unknown>,
): boolean {
  return conditions.every((condition) => evaluateOne(condition, payload));
}
