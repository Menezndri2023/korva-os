export interface InterpolateOptions {
  /**
   * HTML-escape each substituted value (not the surrounding template) before splicing it in.
   * Defaults to false. Must be enabled only where the result is sent as HTML (e.g. outbound
   * email bodies) — never for plain-text channels like SMS/WhatsApp, where it would corrupt
   * the visible text.
   */
  escapeHtml?: boolean;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] as string);
}

/** Replaces "{{field}}" / "{{a.b}}" placeholders in a string with values from the event payload. */
export function interpolate(
  template: string,
  payload: Record<string, unknown>,
  options: InterpolateOptions = {},
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
    const resolved =
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
    return options.escapeHtml ? escapeHtml(resolved) : resolved;
  });
}
