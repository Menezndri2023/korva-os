import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VERTICAL_TEMPLATES } from "@korva/types";
import { SEO_TRADES, seoTradeBySlug } from "@/lib/seo-trades";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { GET as llms } from "@/app/llms.txt/route";
import { TradePage, tradeFaq } from "./trade-page";
import { LandingPage } from "@/components/landing/landing-page";
import { TRADE_COUNT } from "@/lib/brand";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** The home page reads the platform reviews through react-query; offline here, so it shows none. */
function renderLanding(locale?: "fr" | "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LandingPage locale={locale} />
    </QueryClientProvider>,
  );
}

describe("SEO", () => {
  it("gives every trade a page, with a unique and stable slug", () => {
    expect(SEO_TRADES).toHaveLength(VERTICAL_TEMPLATES.length);
    const slugs = SEO_TRADES.map((trade) => trade.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(seoTradeBySlug("salon-de-coiffure-beaute")?.template.key).toBe("beauty_wellness");
  });

  it("lists the home page and every trade page in the sitemap", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("https://app.korvasuite.com/");
    for (const trade of SEO_TRADES) expect(urls).toContain(`https://app.korvasuite.com/metiers/${trade.slug}`);
  });

  it("keeps accounts and the administration out of search engines", () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0]! : rules;
    expect(rule.disallow).toEqual(expect.arrayContaining(["/dashboard", "/admin", "/voir"]));
    expect(robots().sitemap).toBe("https://app.korvasuite.com/sitemap.xml");
  });

  it("welcomes the search and AI crawlers by name, with the same private paths closed", () => {
    const rules = robots().rules;
    const named = (Array.isArray(rules) ? rules : [rules]).find((rule) =>
      ([] as string[]).concat(rule.userAgent ?? []).includes("GPTBot"),
    )!;
    expect(named.userAgent).toEqual(expect.arrayContaining(["Bingbot", "ClaudeBot", "PerplexityBot", "OAI-SearchBot"]));
    expect(named.disallow).toEqual(expect.arrayContaining(["/dashboard", "/admin"]));
  });

  it("names KORVA OS and its seventeen trades on the home page, each linking to its page", () => {
    expect(TRADE_COUNT).toBe(17);
    const { container } = renderLanding();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toContain("KORVA OS");
    expect(h1.textContent).toContain("17 métiers");
    expect(screen.getByRole("heading", { level: 2, name: "Les 17 métiers pris en charge par KORVA OS" })).toBeInTheDocument();
    const section = container.querySelector("#metiers")!;
    for (const trade of SEO_TRADES) {
      expect(section.querySelector(`a[href="/metiers/${trade.slug}"]`)).not.toBeNull();
    }
    const blocks = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
    const list = blocks.find((block: { "@type": string }) => block["@type"] === "ItemList");
    expect(list.itemListElement).toHaveLength(17);
    const app = blocks.find((block: { "@type": string }) => block["@type"] === "SoftwareApplication");
    expect(app.areaServed).toEqual(expect.arrayContaining(["Côte d'Ivoire", "International"]));
    expect(app.keywords).toContain("KORVA OS");
  });

  it("does the same in English", () => {
    const { container } = renderLanding("en");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("17 trades");
    expect(container.querySelector('#metiers a[href="/en/trades/restaurant"]')).not.toBeNull();
  });

  it("tells AI assistants what KORVA is, its real prices and its trade pages", async () => {
    const text = await llms().text();
    expect(text).toMatch(/^# KORVA OS/);
    expect(text).toContain("9 900 F CFA");
    expect(text).toContain("carte bancaire");
    expect(text).toContain("/metiers/restaurant-maquis");
    expect(text).toContain("17 métiers");
    expect(text).toContain("Afrique de l'Ouest");
  });

  it("renders a trade page with its heading, questions and structured data", () => {
    const trade = seoTradeBySlug("restaurant-maquis")!;
    const { container } = render(<TradePage trade={trade} />);
    expect(screen.getByRole("heading", { level: 1, name: trade.heading })).toBeInTheDocument();
    for (const item of tradeFaq(trade)) expect(screen.getByText(item.question)).toBeInTheDocument();
    const data = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(data.map((block: { "@type": string }) => block["@type"])).toEqual([
      "BreadcrumbList",
      "SoftwareApplication",
      "FAQPage",
    ]);
  });
});
