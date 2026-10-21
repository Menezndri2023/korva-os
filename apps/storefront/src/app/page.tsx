import { redirect } from "next/navigation";

// Rendered per request: APP_URL is a runtime variable, and a page prerendered at build time
// carries no CSP nonce — this root used to be a static placeholder whose every script the
// storefront's own CSP blocked.
export const dynamic = "force-dynamic";

/**
 * sites.korvasuite.com/ belongs to no business (a site lives at /<slug> or on its own domain).
 * A visitor who lands here wants to know what KORVA is: send them to its home page.
 */
export default function StorefrontRoot() {
  redirect(process.env.APP_URL ?? "http://localhost:3000");
}
