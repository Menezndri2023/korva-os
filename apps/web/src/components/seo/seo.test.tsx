import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VERTICAL_TEMPLATES } from "@korva/types";
import { SEO_TRADES, seoTradeBySlug } from "@/lib/seo-trades";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { GET as llms } from "@/app/llms.txt/route";
import { TradePage, tradeFaq } from "./trade-page";

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

  it("tells AI assistants what KORVA is, its real prices and its trade pages", async () => {
    const text = await llms().text();
    expect(text).toMatch(/^# KORVA OS/);
    expect(text).toContain("9 900 F CFA");
    expect(text).toContain("carte bancaire");
    expect(text).toContain("/metiers/restaurant-maquis");
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
