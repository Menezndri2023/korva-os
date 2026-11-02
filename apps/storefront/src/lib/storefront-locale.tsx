"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "@korva/types";
import { translator, type Translate } from "./storefront-locale-core";

export { intlLocale, type Translate } from "./storefront-locale-core";

const StorefrontLocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** Set once per site, around every page under /[slug], from the business's language. */
export function StorefrontLocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  useEffect(() => {
    // The root layout cannot know the business, so its <html lang> is French by default.
    document.documentElement.lang = locale;
  }, [locale]);
  return <StorefrontLocaleContext.Provider value={locale}>{children}</StorefrontLocaleContext.Provider>;
}

export function useStorefrontLocale(): Locale {
  return useContext(StorefrontLocaleContext);
}

export function useT(): Translate {
  const locale = useStorefrontLocale();
  return useMemo(() => translator(locale), [locale]);
}
