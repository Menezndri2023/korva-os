"use client";

import Link from "next/link";

/** Shared header/layout for every /[slug]/account/* page — same visual shell as the existing
 *  /[slug]/track page (border-b header, "← Retour à la boutique" link, max-w-2xl column). */
export function AccountShell({
  slug,
  title,
  children,
}: {
  slug: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-app-background">
      <header className="border-b border-border bg-surface px-6 py-4">
        <div className="mx-auto max-w-2xl">
          <Link href={`/${slug}`} className="text-sm text-text-muted hover:underline">
            ← Retour à la boutique
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-text">{title}</h1>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">{children}</main>
    </div>
  );
}
