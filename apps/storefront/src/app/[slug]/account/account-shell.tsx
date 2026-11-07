"use client";

import Link from "next/link";
import { usePublicOrganization } from "@/lib/use-public-organization";
import { uploadImage } from "@/lib/upload-image";

/**
 * Shared header/layout for every /[slug]/account/* page. It carries the business's own name and
 * logo — the customer is in that business's space, not on a generic KORVA page — and the way back
 * says "site", which fits a salon or an academy as well as a shop.
 */
export function AccountShell({
  slug,
  title,
  children,
}: {
  slug: string;
  title: string;
  children: React.ReactNode;
}) {
  const { data: organization } = usePublicOrganization(slug);
  return (
    <div className="min-h-screen bg-app-background">
      <header className="border-b border-border bg-surface px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          {organization?.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- tenant logo on any host
            <img {...uploadImage(organization.logo, [160, 320], "80px")} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
          ) : (
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-action font-semibold text-on-action"
            >
              {(organization?.name ?? "·").charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <Link href={`/${slug}`} className="text-sm text-text-muted hover:underline">
              ← Retour au site{organization ? ` de ${organization.name}` : ""}
            </Link>
            <h1 className="text-lg font-semibold text-text">{title}</h1>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">{children}</main>
    </div>
  );
}
