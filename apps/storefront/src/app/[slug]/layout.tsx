import { fetchOrganization } from "@/lib/fetch-organization";
import { siteLocale } from "@/lib/storefront-locale-core";
import { StorefrontLocaleProvider } from "@/lib/storefront-locale";

/**
 * Every page of a business's site — home, catalogue, offer, customer account — in the business's
 * language. The lookup is the same cached call the pages make, so this costs no extra request;
 * when it fails, the site stays in French and the page itself shows what went wrong.
 */
export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const lookup = await fetchOrganization(slug);
  const locale = siteLocale(lookup.kind === "found" ? lookup.organization.language : undefined);
  return (
    <StorefrontLocaleProvider locale={locale}>
      <div lang={locale} className="contents">
        {children}
      </div>
    </StorefrontLocaleProvider>
  );
}
