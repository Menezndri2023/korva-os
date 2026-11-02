"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { Card } from "@korva/ui";
import { ApiError } from "@/lib/api-client";
import { useT } from "@/lib/dashboard-locale";

/** Shared loading/error/empty/list rendering for a "related records" section on a detail page
 * (contact, lead, ...) — each section is independent: a 403 on one (e.g. a module the
 * organization hasn't enabled) never blocks the others or the core identity card above. */
export function RelationSection<T extends { id: string }>({
  title,
  query,
  renderItem,
  emptyLabel,
  header,
}: {
  title: string;
  query: Pick<UseQueryResult<T[]>, "isLoading" | "isError" | "error" | "data">;
  renderItem: (item: T) => React.ReactNode;
  emptyLabel: string;
  header?: React.ReactNode;
}) {
  const t = useT();
  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold text-text">{title}</h2>
      {header && <div className="mt-3">{header}</div>}
      <div className="mt-3">
        {query.isLoading && <p className="text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>}
        {query.isError && (
          <p className="text-sm text-text-muted">
            {query.error instanceof ApiError ? query.error.message : t("Non disponible.", "Not available.")}
          </p>
        )}
        {!query.isLoading && !query.isError && (query.data?.length ?? 0) === 0 && (
          <p className="text-sm text-text-muted">{emptyLabel}</p>
        )}
        {!query.isLoading && !query.isError && query.data && query.data.length > 0 && (
          <ul className="divide-y divide-border">
            {query.data.map((item) => (
              <li key={item.id} className="py-2 text-sm">
                {renderItem(item)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
