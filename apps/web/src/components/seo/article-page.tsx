import Link from "next/link";
import type { Locale } from "@korva/types";
import { ARTICLES, articlePath, articlesIndexPath, type Article } from "@/lib/articles";
import { appUrl } from "@/lib/site-url";
import { JsonLd } from "./json-ld";
import { PublicFooter, PublicHeader } from "./trade-page";

const TEXT = {
  fr: {
    index: "Conseils",
    indexTitle: "Conseils pour gérer et faire grandir votre activité",
    indexLead:
      "Des réponses concrètes aux questions des commerçants, artisans et prestataires : encaisser, remplir l'agenda, faire signer un devis.",
    read: "Lire l'article",
    cta: "Essayer KORVA gratuitement",
    ctaLead: "Créez votre compte en deux minutes : votre site, votre caisse et votre agenda sont prêts tout de suite.",
    more: "D'autres conseils",
    published: "Publié le",
  },
  en: {
    index: "Guides",
    indexTitle: "Guides to run and grow your business",
    indexLead:
      "Practical answers to the questions shop owners, tradespeople and service providers ask: taking payments, filling the diary, getting quotes signed.",
    read: "Read the guide",
    cta: "Try KORVA for free",
    ctaLead: "Create your account in two minutes: your website, till and diary are ready straight away.",
    more: "More guides",
    published: "Published",
  },
} as const;

function formatDate(iso: string, locale: Locale): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale === "en" ? "en-GB" : "fr-FR", {
    dateStyle: "long",
  });
}

/** The list of advice articles, newest first. */
export function ArticleIndex({ locale }: { locale: Locale }) {
  const t = TEXT[locale];
  const articles = [...ARTICLES].sort((a, b) => b.published.localeCompare(a.published));
  return (
    <div className="bg-paper text-ink" lang={locale}>
      <PublicHeader
        locale={locale}
        otherLanguageHref={articlesIndexPath(locale === "en" ? "fr" : "en")}
      />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-8">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">{t.indexTitle}</h1>
        <p className="mt-3 text-ink-soft">{t.indexLead}</p>
        <ul className="mt-10 space-y-8">
          {articles.map((article) => (
            <li key={article.fr.slug} className="border-t border-rule pt-6">
              <h2 className="font-display text-xl font-semibold">
                <Link href={articlePath(article, locale)} className="hover:underline">
                  {article[locale].title}
                </Link>
              </h2>
              <p className="mt-2 text-ink-soft">{article[locale].description}</p>
              <Link
                href={articlePath(article, locale)}
                className="mt-3 inline-block text-sm font-semibold underline underline-offset-4"
              >
                {t.read}
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <PublicFooter locale={locale} />
    </div>
  );
}

/** One advice article, with what KORVA does about it and a way to try it. */
export function ArticlePage({ article, locale }: { article: Article; locale: Locale }) {
  const t = TEXT[locale];
  const text = article[locale];
  const url = `${appUrl()}${articlePath(article, locale)}`;
  const others = ARTICLES.filter((other) => other !== article).slice(0, 3);
  const en = locale === "en";
  return (
    <div className="bg-paper text-ink" lang={locale}>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: text.title,
            description: text.description,
            datePublished: article.published,
            inLanguage: locale,
            mainEntityOfPage: url,
            author: { "@type": "Organization", name: "KORVA OS", url: appUrl() },
            publisher: { "@type": "Organization", name: "KORVA OS", url: appUrl() },
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "KORVA OS", item: `${appUrl()}${en ? "/en" : ""}` },
              { "@type": "ListItem", position: 2, name: t.index, item: `${appUrl()}${articlesIndexPath(locale)}` },
              { "@type": "ListItem", position: 3, name: text.title, item: url },
            ],
          },
        ]}
      />
      <PublicHeader locale={locale} otherLanguageHref={articlePath(article, en ? "fr" : "en")} />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-8">
        <nav aria-label={en ? "Breadcrumb" : "Fil d'Ariane"} className="text-sm text-ink-soft">
          <Link href={articlesIndexPath(locale)} className="hover:underline">
            {t.index}
          </Link>
        </nav>
        <article className="mt-4">
          <h1 className="font-display text-3xl font-bold leading-tight sm:text-4xl">{text.title}</h1>
          <p className="mt-3 text-sm text-ink-soft">
            {t.published} {formatDate(article.published, locale)}
          </p>
          <div className="mt-8 space-y-5 text-[17px] leading-relaxed">
            {text.body.map((block, index) => {
              if (block.type === "h2") {
                return (
                  <h2 key={index} className="pt-4 font-display text-2xl font-semibold">
                    {block.text}
                  </h2>
                );
              }
              if (block.type === "ul") {
                return (
                  <ul key={index} className="list-disc space-y-2 pl-6">
                    {block.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                );
              }
              return <p key={index}>{block.text}</p>;
            })}
          </div>
        </article>

        <section className="mt-12 rounded-2xl bg-ink-deep p-6 text-paper sm:p-8">
          <p className="font-display text-2xl font-semibold">{t.cta}</p>
          <p className="mt-2 text-ink-muted">{t.ctaLead}</p>
          <Link
            href={en ? "/register?lang=en" : "/register"}
            className="mt-5 inline-block rounded-lg bg-primary px-5 py-3 font-semibold text-on-primary hover:bg-primary-hover"
          >
            {t.cta}
          </Link>
        </section>

        {others.length > 0 && (
          <section className="mt-12">
            <h2 className="font-display text-xl font-semibold">{t.more}</h2>
            <ul className="mt-4 space-y-3">
              {others.map((other) => (
                <li key={other.fr.slug}>
                  <Link href={articlePath(other, locale)} className="underline underline-offset-4">
                    {other[locale].title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <PublicFooter locale={locale} />
    </div>
  );
}
