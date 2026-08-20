/** Replaces "{{field}}" / "{{a.b}}" placeholders in a string with values from the event payload. */
export function interpolate(
  template: string,
  payload: Record<string, unknown>,
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const value = path
      .split('.')
      .reduce<unknown>(
        (v, key) =>
          v && typeof v === 'object'
            ? (v as Record<string, unknown>)[key]
            : undefined,
        payload,
      );
    if (value === undefined || value === null) {
      return '';
    }
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return String(value);
    }
    return JSON.stringify(value);
  });
}
