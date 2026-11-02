"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_LOCALE, type Locale } from "@korva/types";
import { intlLocale, readDashboardLocale, rememberLocale } from "./dashboard-locale-core";

export { intlLocale, readDashboardLocale };

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Remembers the dashboard language in this browser — the same choice the public site makes. */
export function setDashboardLocale(locale: Locale) {
  rememberLocale(locale);
  listeners.forEach((listener) => listener());
}

export function useDashboardLocale(): Locale {
  return useSyncExternalStore(subscribe, readDashboardLocale, () => DEFAULT_LOCALE);
}

/**
 * `t("Commandes", "Orders")`: the French text stays where it always was and its English sits
 * next to it, so a screen can never lose a translation without the compiler noticing.
 */
export type Translate = (fr: string, en: string) => string;

export function useT(): Translate {
  const locale = useDashboardLocale();
  return useCallback((fr: string, en: string) => (locale === "en" ? en : fr), [locale]);
}
