"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { adminApi, type PlatformSearchResults } from "@/lib/platform-admin";

/** Waits for the administrator to stop typing before asking the API. */
function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * One box for the whole administration: a business (name, address, domain), a person (e-mail,
 * name) or a plan invoice (ABO-…). ⌘K / Ctrl+K focuses it from any page.
 */
export function AdminSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const term = useDebounced(query.trim(), 250);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useQuery({
    queryKey: ["platform", "search", term],
    queryFn: () => adminApi.get<PlatformSearchResults>(`/platform/search?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
    staleTime: 30_000,
  });

  const data = results.data;
  const empty = data && data.organizations.length + data.users.length + data.invoices.length === 0;
  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <div
      className="relative w-full max-w-xl"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label className="flex h-11 items-center gap-2.5 rounded-lg border border-border-input bg-app-background px-3 text-text-muted focus-within:border-focus focus-within:ring-2 focus-within:ring-primary/40">
        <Search aria-hidden className="h-4 w-4 shrink-0" />
        <span className="sr-only">Rechercher dans l&apos;administration</span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
          aria-controls={listId}
          placeholder="Rechercher une entreprise, une personne, une facture"
          className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
        />
        <kbd className="hidden rounded border border-border-input bg-surface px-1.5 text-xs sm:inline">⌘K</kbd>
      </label>

      {open && term.length >= 2 && (
        <div
          id={listId}
          className="absolute inset-x-0 top-12 z-30 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-xl"
        >
          {results.isLoading && <p className="px-3 py-2 text-sm text-text-muted">Recherche…</p>}
          {empty && <p className="px-3 py-2 text-sm text-text-muted">Rien ne correspond à « {term} ».</p>}
          {data && data.organizations.length > 0 && (
            <ResultGroup title="Entreprises">
              {data.organizations.map((org) => (
                <ResultLink key={org.id} href={`/admin/entreprises/${org.id}`} onPick={close}>
                  <span className="font-medium text-text">{org.name}</span>
                  <span className="text-text-muted"> /{org.slug}</span>
                </ResultLink>
              ))}
            </ResultGroup>
          )}
          {data && data.users.length > 0 && (
            <ResultGroup title="Personnes">
              {data.users.map((user) => (
                <ResultLink key={user.id} href={`/admin/utilisateurs?q=${encodeURIComponent(user.email)}`} onPick={close}>
                  <span className="font-medium text-text">{user.name ?? user.email}</span>
                  {user.name && <span className="text-text-muted"> {user.email}</span>}
                </ResultLink>
              ))}
            </ResultGroup>
          )}
          {data && data.invoices.length > 0 && (
            <ResultGroup title="Factures de formule">
              {data.invoices.map((invoice) => (
                <ResultLink key={invoice.id} href={`/admin/entreprises/${invoice.organizationId}#formule`} onPick={close}>
                  <span className="font-medium text-text">{invoice.number}</span>
                  <span className="text-text-muted"> {invoice.organizationName}</span>
                </ResultLink>
              ))}
            </ResultGroup>
          )}
        </div>
      )}
    </div>
  );
}

function ResultGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <p className="px-3 pb-1 text-xs font-semibold text-text-muted">{title}</p>
      <ul>{children}</ul>
    </div>
  );
}

function ResultLink({ href, onPick, children }: { href: string; onPick: () => void; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        onClick={onPick}
        className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
      >
        {children}
      </Link>
    </li>
  );
}
