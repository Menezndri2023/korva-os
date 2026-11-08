"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "@/lib/storefront-locale";

/** Fired by the footer's « Cookies » link to show the choice again. */
export const CONSENT_REOPEN_EVENT = "korva:consent-reopen";

type Consent = "granted" | "denied";
type TrackingWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string };
  _fbq?: unknown;
};

const storageKey = (slug: string) => `korva-consent:${slug}`;

function readConsent(slug: string): Consent | null {
  try {
    const value = window.localStorage.getItem(storageKey(slug));
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

function addScript(src: string) {
  if (document.querySelector(`script[src="${src}"]`)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  // Created by this (nonce-trusted) bundle: allowed by the CSP's 'strict-dynamic'.
  document.head.appendChild(script);
}

function loadGoogleAnalytics(id: string) {
  const w = window as TrackingWindow;
  if (w.gtag) return;
  w.dataLayer = w.dataLayer ?? [];
  w.gtag = function gtag() {
    // gtag.js reads the Arguments object itself, not an array.
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
  w.gtag("js", new Date());
  // Page views are sent by hand on every navigation, client-side ones included.
  w.gtag("config", id, { send_page_view: false });
  addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
}

function loadMetaPixel(id: string) {
  const w = window as TrackingWindow;
  if (w.fbq) return;
  const fbq = function fbq(...args: unknown[]) {
    const self = fbq as TrackingWindow["fbq"] & { callMethod?: (...a: unknown[]) => void };
    if (self?.callMethod) self.callMethod(...args);
    else self?.queue?.push(args);
  } as NonNullable<TrackingWindow["fbq"]>;
  fbq.queue = [];
  fbq.loaded = true;
  fbq.version = "2.0";
  w.fbq = fbq;
  w._fbq = fbq;
  addScript("https://connect.facebook.net/en_US/fbevents.js");
  fbq("init", id);
}

/**
 * Google Analytics and Meta Pixel on a business's site (site_tracking, Pro and above — the API
 * only sends `tracking` then). NOTHING is loaded before the visitor accepts: the banner asks
 * first, the answer is kept per site in this browser, and the footer's « Cookies » link asks
 * again. Required in France and Belgium (ePrivacy), and honest everywhere else.
 */
export function SiteTracking({
  slug,
  googleAnalyticsId,
  metaPixelId,
}: {
  slug: string;
  googleAnalyticsId?: string;
  metaPixelId?: string;
}) {
  const t = useT();
  const pathname = usePathname();
  const stored = useSyncExternalStore(
    () => () => {},
    () => readConsent(slug),
    () => "denied" as Consent | null, // the server never shows the banner nor loads anything
  );
  const [choice, setChoice] = useState<Consent | null | undefined>(undefined);
  const [reopened, setReopened] = useState(false);
  const consent = choice === undefined ? stored : choice;
  const enabled = Boolean(googleAnalyticsId || metaPixelId);

  useEffect(() => {
    const reopen = () => setReopened(true);
    window.addEventListener(CONSENT_REOPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_REOPEN_EVENT, reopen);
  }, []);

  useEffect(() => {
    if (!enabled || consent !== "granted") return;
    if (googleAnalyticsId) loadGoogleAnalytics(googleAnalyticsId);
    if (metaPixelId) loadMetaPixel(metaPixelId);
    const w = window as TrackingWindow;
    w.gtag?.("event", "page_view", { page_location: window.location.href, page_title: document.title });
    w.fbq?.("track", "PageView");
  }, [enabled, consent, googleAnalyticsId, metaPixelId, pathname]);

  function decide(value: Consent) {
    try {
      window.localStorage.setItem(storageKey(slug), value);
    } catch {
      // Private browsing: the choice holds for this visit only.
    }
    setChoice(value);
    setReopened(false);
    // Withdrawing consent: scripts already running cannot be unloaded — a reload stops them.
    if (value === "denied" && consent === "granted") window.location.reload();
  }

  if (!enabled || (consent !== null && !reopened)) return null;

  return (
    <div
      role="dialog"
      aria-label={t("Cookies de mesure d'audience", "Audience cookies")}
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-2xl border border-black/10 bg-white p-4 text-sm text-neutral-800 shadow-xl sm:inset-x-6"
    >
      <p>
        {t(
          "Ce site mesure son audience et l'efficacité de ses publicités (Google Analytics, Meta). Acceptez-vous ces cookies ?",
          "This site measures its audience and the reach of its ads (Google Analytics, Meta). Do you accept these cookies?",
        )}
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => decide("denied")}
          className="rounded-full border border-neutral-300 px-4 py-2 font-medium hover:bg-neutral-100"
        >
          {t("Refuser", "Decline")}
        </button>
        <button
          type="button"
          onClick={() => decide("granted")}
          className="rounded-full bg-neutral-900 px-4 py-2 font-semibold text-white hover:bg-neutral-700"
        >
          {t("Accepter", "Accept")}
        </button>
      </div>
    </div>
  );
}
