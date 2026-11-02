"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@korva/types";

const STORAGE_KEY = "korva-lang";

/**
 * The dashboard speaks English only once every screen does: until then a half-translated
 * dashboard would be worse than a French one, so the choice stays French whatever is remembered.
 */
export const DASHBOARD_ENGLISH_READY = false;

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function readStored(): Locale {
  if (!DASHBOARD_ENGLISH_READY) return DEFAULT_LOCALE;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Remembers the dashboard language in this browser — the same choice the public site makes. */
export function setDashboardLocale(locale: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Private browsing: nothing to remember.
  }
  listeners.forEach((listener) => listener());
}

export function useDashboardLocale(): Locale {
  return useSyncExternalStore(subscribe, readStored, () => DEFAULT_LOCALE);
}

/** The Intl locale for dates and numbers in the dashboard's language. */
export function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-GB" : "fr-FR";
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
