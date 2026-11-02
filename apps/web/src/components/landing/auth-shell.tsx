import type { ReactNode } from "react";
import Link from "next/link";
import { KorvaWordmark } from "@/components/brand/korva-mark";
import type { Locale } from "@korva/types";
import { AUTH_TEXT } from "@/lib/auth-text";

/**
 * Shared frame for the four pre-auth form pages (login, register, forgot-password,
 * reset-password). Each of them used to be a bare centred form under the words "KORVA OS" set in
 * `text-2xl font-semibold` — no identity, and nothing telling a first-time visitor what they were
 * signing up to.
 *
 * Two columns: a fixed ink field carrying the brand and the reassurance, and a form column.
 *
 * THE FORM COLUMN DELIBERATELY DOES NOT USE THE BRAND PALETTE. It stays on the app's themed
 * tokens (bg-app-background / text-text), which invert under prefers-color-scheme: dark. The
 * reason is Input in packages/ui: it sets a border and nothing else, inheriting both its text
 * colour and its background from the page. Painting this column with the fixed --color-paper
 * would leave a system-dark visitor typing near-white --color-text onto warm white — so the
 * brand lands through the ink column, which is dark in both themes and safe, and the form keeps
 * exactly the rendering it has today.
 */
export function AuthShell({
  title,
  intro,
  aside,
  children,
  footer,
  locale = "fr",
}: {
  locale?: Locale;
  title: string;
  intro: string;
  /** Shown only from lg: — it is reassurance, and on a phone the form has to come first. */
  aside?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  const t = AUTH_TEXT[locale];
  const home = locale === "en" ? "/en" : "/";
  return (
    <div className="flex min-h-screen flex-col lg:flex-row" lang={locale}>
      <div className="flex flex-col bg-ink-deep text-paper lg:w-[24rem] lg:shrink-0">
        <div className="px-4 py-5 sm:px-6 lg:px-9 lg:py-10">
          <Link
            href={home}
            className="inline-block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
          >
            <KorvaWordmark />
            <span className="sr-only">{t.home}</span>
          </Link>
        </div>

        {aside && (
          <div className="hidden px-9 lg:block">
            <div className="border-t border-ink-soft pt-8">{aside}</div>
          </div>
        )}

        <div className="mt-auto hidden px-9 pb-10 lg:block">
          <Link
            href={home}
            className="rounded text-sm text-ink-muted transition-colors hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper"
          >
            {t.backHome}
          </Link>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center bg-app-background px-4 py-10 text-text sm:py-16">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-text-muted">{intro}</p>
          <div className="mt-7">{children}</div>
          <p className="mt-6 text-sm text-text-muted">{footer}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * The ink column's content on /login: where the owner lands once signed in, so the column is not
 * an empty slab on the page people see most often.
 */
function Aside({ items }: { items: readonly (readonly string[])[] }) {
  return (
    <ul className="space-y-5 text-sm leading-relaxed text-ink-muted">
      {items.map(([title, body]) => (
        <li key={title}>
          <span className="block font-medium text-paper">{title}</span>
          {body}
        </li>
      ))}
    </ul>
  );
}

/** The ink column on /login: where the owner lands once signed in. */
export function LoginAside({ locale = "fr" }: { locale?: Locale }) {
  return <Aside items={AUTH_TEXT[locale].loginAside} />;
}

/** The ink column on /register: three facts about what the account actually does. */
export function RegisterAside({ locale = "fr" }: { locale?: Locale }) {
  return <Aside items={AUTH_TEXT[locale].registerAside} />;
}
