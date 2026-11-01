/**
 * Structured data (schema.org JSON-LD) for search engines and AI assistants. A data block, never
 * executed, so the strict-dynamic CSP does not apply to it. `<` is escaped so a value can never
 * close the script element.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
