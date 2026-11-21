"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * KORVA's own Google tag (Google Ads / Google Analytics) on korvasuite.com — not the businesses'
 * sites, which have their own per-site tracking in apps/storefront (site-tracking.tsx).
 *
 * The ids come from the server at RUNTIME (GOOGLE_TAG_ID, GOOGLE_ADS_SIGNUP_SEND_TO, read in
 * app/layout.tsx), not from a NEXT_PUBLIC_ build arg: changing them only needs a restart.
 *
 * NOTHING is loaded before the visitor accepts (ePrivacy, France/Belgium — same rule as the
 * businesses' sites). gtag.js is injected by this nonce-trusted bundle, which the CSP's
 * 'strict-dynamic' allows; middleware.ts opens connect-src/frame-src to Google for its pings.
 */

const STORAGE_KEY = "korva-consent";
export const CONSENT_REOPEN_EVENT = "korva:consent-reopen";

type Consent = "granted" | "denied";
type GtagWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };

/** G-… (Analytics), AW-… (Ads), GT-… (Google tag). Anything else is a typo in .env. */
export function isGoogleTagId(value: string | undefined): value is string {
  return Boolean(value && /^(G|AW|GT|DC)-[A-Z0-9]+$/i.test(value.trim()));
}

/** "AW-123456789/AbC-dEfGhIjK" — the conversion's "send_to" in Google Ads. */
export function isConversionSendTo(value: string | undefined): value is string {
  return Boolean(value && /^AW-[0-9]+\/[\w-]+$/.test(value.trim()));
}

let signupSendTo: string | undefined;

function readConsent(): Consent | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

function loadGoogleTag(id: string) {
  const w = window as GtagWindow;
  if (w.gtag) return;
  w.dataLayer = w.dataLayer ?? [];
  w.gtag = function gtag() {
    // gtag.js reads the Arguments object itself, not an array.
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
  // Consent Mode v2: only ever loaded after "Accepter", so granted from the first hit.
  w.gtag("consent", "default", {
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
    analytics_storage: "granted",
  });
  w.gtag("js", new Date());
  // Page views are sent by hand on every navigation, client-side ones included.
  w.gtag("config", id, { send_page_view: false });
  const src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  if (document.querySelector(`script[src="${src}"]`)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

/**
 * The account was just created. A no-op when the tag is off or the visitor declined:
 * gtag is then undefined, and nothing is queued for later.
 */
export function trackSignUp() {
  const w = window as GtagWindow;
  if (!w.gtag) return;
  w.gtag("event", "sign_up", { method: "email" });
  if (signupSendTo) w.gtag("event", "conversion", { send_to: signupSendTo });
}

const TEXT = {
  fr: {
    label: "Cookies de mesure d'audience",
    body: "KORVA OS mesure son audience et l'efficacité de ses publicités (Google). Acceptez-vous ces cookies ?",
    decline: "Refuser",
    accept: "Accepter",
  },
  en: {
    label: "Audience cookies",
    body: "KORVA OS measures its audience and the reach of its ads (Google). Do you accept these cookies?",
    decline: "Decline",
    accept: "Accept",
  },
} as const;

/** The footer's « Cookies » link: asks the question again (withdrawing must be as easy as giving). */
export function CookieChoiceLink({ className }: { className?: string; lang?: "fr" | "en" }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event(CONSENT_REOPEN_EVENT))}
    >
      Cookies
    </button>
  );
}

export function GoogleTag({
  tagId,
  signupConversion,
  lang,
}: {
  tagId?: string;
  signupConversion?: string;
  lang: "fr" | "en";
}) {
  const pathname = usePathname();
  const stored = useSyncExternalStore(
    () => () => {},
    readConsent,
    () => "denied" as Consent | null, // the server never shows the banner nor loads anything
  );
  const [choice, setChoice] = useState<Consent | null | undefined>(undefined);
  const [reopened, setReopened] = useState(false);
  const consent = choice === undefined ? stored : choice;
  const enabled = isGoogleTagId(tagId);

  useEffect(() => {
    signupSendTo = isConversionSendTo(signupConversion) ? signupConversion.trim() : undefined;
  }, [signupConversion]);

  useEffect(() => {
    const reopen = () => setReopened(true);
    window.addEventListener(CONSENT_REOPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_REOPEN_EVENT, reopen);
  }, []);

  useEffect(() => {
    if (!enabled || consent !== "granted") return;
    loadGoogleTag(tagId!.trim());
    (window as GtagWindow).gtag?.("event", "page_view", {
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [enabled, consent, tagId, pathname]);

  function decide(value: Consent) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Private browsing: the choice holds for this visit only.
    }
    setChoice(value);
    setReopened(false);
    // Withdrawing consent: a script already running cannot be unloaded — a reload stops it.
    if (value === "denied" && consent === "granted") window.location.reload();
  }

  if (!enabled || (consent !== null && !reopened)) return null;
  const t = TEXT[lang];

  return (
    <div
      role="dialog"
      aria-label={t.label}
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-2xl border border-border bg-surface p-4 text-sm text-text shadow-xl sm:inset-x-6"
    >
      <p>{t.body}</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => decide("denied")}
          className="rounded-full border border-border px-4 py-2 font-medium hover:bg-app-background"
        >
          {t.decline}
        </button>
        <button
          type="button"
          onClick={() => decide("granted")}
          className="rounded-full bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover"
        >
          {t.accept}
        </button>
      </div>
    </div>
  );
}
