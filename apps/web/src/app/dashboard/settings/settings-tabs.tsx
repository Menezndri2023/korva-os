"use client";

import { useSyncExternalStore, type ReactNode } from "react";

export const SETTINGS_TABS = [
  { key: "entreprise", label: "Entreprise" },
  { key: "site", label: "Site et ventes" },
  { key: "abonnement", label: "Formule et modules" },
  { key: "equipe", label: "Équipe" },
  { key: "integrations", label: "Intégrations" },
  { key: "avance", label: "Avancé" },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

const DEFAULT_TAB: SettingsTab = "entreprise";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
const readHash = () => window.location.hash.slice(1);
const readNoHash = () => "";

/**
 * The open tab lives in the URL hash (#site, #abonnement…), so a link elsewhere in the dashboard
 * can open Settings on the right section, and the back button returns to the previous tab.
 * useSyncExternalStore with an empty server snapshot: the server render and hydration agree on
 * the default tab, then the hash applies.
 */
export function useSettingsTab(): SettingsTab {
  const hash = useSyncExternalStore(subscribe, readHash, readNoHash);
  return SETTINGS_TABS.some((tab) => tab.key === hash) ? (hash as SettingsTab) : DEFAULT_TAB;
}

/**
 * Settings had grown into one 5,000-pixel scroll mixing the business profile, billing, the team
 * and webhooks. The tabs group them by what the owner came to do.
 *
 * Plain links to "#key" rather than buttons with state: the hash IS the state (see above), so
 * opening a tab in a new browser tab or sharing the address works without extra code.
 */
export function SettingsTabs({ active }: { active: SettingsTab }) {
  return (
    <nav
      aria-label="Sections des paramètres"
      className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0"
    >
      {SETTINGS_TABS.map((tab) => (
        <a
          key={tab.key}
          href={`#${tab.key}`}
          aria-current={tab.key === active ? "page" : undefined}
          className={`shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium ${
            tab.key === active
              ? "border-b-2 border-primary text-text"
              : "text-text-muted hover:text-text"
          }`}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

/**
 * Hidden with a class rather than unmounted: an open edit form in one tab keeps what was typed
 * when the owner glances at another, and each section's data still loads once with the page.
 */
export function SettingsTabPanel({
  tab,
  active,
  children,
}: {
  tab: SettingsTab;
  active: SettingsTab;
  children: ReactNode;
}) {
  return (
    <div id={`settings-${tab}`} className={tab === active ? "space-y-8" : "hidden"}>
      {children}
    </div>
  );
}
