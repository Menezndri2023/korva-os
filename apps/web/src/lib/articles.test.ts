import { describe, it, expect } from "vitest";
import { ARTICLES, articleBySlug, articlePath } from "./articles";

describe("advice articles", () => {
  it("exist in both languages, with unique slugs and real content", () => {
    for (const locale of ["fr", "en"] as const) {
      const slugs = ARTICLES.map((article) => article[locale].slug);
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const article of ARTICLES) {
        const text = article[locale];
        expect(text.slug).toMatch(/^[a-z0-9-]+$/);
        expect(text.title.length).toBeGreaterThan(10);
        // Search engines cut a description around 160 characters.
        expect(text.description.length).toBeLessThanOrEqual(170);
        expect(text.body.filter((block) => block.type === "h2").length).toBeGreaterThanOrEqual(2);
        expect(articleBySlug(text.slug, locale)).toBe(article);
      }
    }
  });

  it("lives under /conseils in French and /en/guides in English", () => {
    const [article] = ARTICLES;
    expect(articlePath(article!, "fr")).toBe(`/conseils/${article!.fr.slug}`);
    expect(articlePath(article!, "en")).toBe(`/en/guides/${article!.en.slug}`);
  });
});
