"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The language of the few words the design system writes itself (pagination, theme toggle).
 * The app sets it once around its pages; without a provider, French, as before.
 */
export type UiLocale = "fr" | "en";

const UiLocaleContext = createContext<UiLocale>("fr");

export function UiLocaleProvider({ locale, children }: { locale: UiLocale; children: ReactNode }) {
  return <UiLocaleContext.Provider value={locale}>{children}</UiLocaleContext.Provider>;
}

export function useUiLocale(): UiLocale {
  return useContext(UiLocaleContext);
}
