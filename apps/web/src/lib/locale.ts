"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@korva/types";

const STORAGE_KEY = "korva-lang";
const NO_SUBSCRIBE = () => () => {};
function readStored(): Locale {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/**
 * The language of the signed-out pages (sign-in, sign-up, password). `?lang=en` on a link — what
 * the English home page puts on its buttons — wins and is remembered in this browser; otherwise
 * the remembered choice; otherwise French. Read during server rendering from the URL, so a
 * visitor coming from the English site never sees a French flash.
 */
export function useLocale(): Locale {
  const fromUrl = useSearchParams()?.get("lang");
  const stored = useSyncExternalStore(NO_SUBSCRIBE, readStored, () => DEFAULT_LOCALE);
  const locale = isLocale(fromUrl) ? fromUrl : stored;
  useEffect(() => {
    if (!isLocale(fromUrl)) return;
    try {
      localStorage.setItem(STORAGE_KEY, fromUrl);
    } catch {
      // Private browsing: the choice still holds for this page.
    }
  }, [fromUrl]);
  return locale;
}

/** Keeps ?lang=en on links between the signed-out pages, so the language follows the visitor. */
export function withLang(href: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return href;
  return `${href}${href.includes("?") ? "&" : "?"}lang=${locale}`;
}
