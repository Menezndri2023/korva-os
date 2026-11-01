/**
 * KORVA's public address, for what search engines and AI assistants read (canonical links,
 * sitemap, robots.txt, llms.txt, structured data). Server-side only and read at request time —
 * every route here is dynamic — so it can be changed with the APP_URL environment variable
 * without rebuilding; it defaults to the production address.
 */
export function appUrl(): string {
  return (process.env.APP_URL ?? "https://app.korvasuite.com").replace(/\/$/, "");
}
