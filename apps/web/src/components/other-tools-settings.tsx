"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BUSINESS_MODEL_DEFINITIONS,
  TRADE_TOOL_LABELS,
  TRADE_TOOLS,
  type Organization,
  type TradeTool,
} from "@korva/types";
import { Switch } from "@korva/ui";
import { ApiError, apiClient } from "@/lib/api-client";

const TOOL_DESCRIPTIONS: Record<TradeTool, string> = {
  orders: "Recevoir et suivre des commandes de produits.",
  returns: "Gérer les retours et remboursements de commandes.",
  bookings: "Prendre des réservations ou des rendez-vous.",
};

/**
 * The trade tools the organization's type of activity does not list, each one a switch that
 * brings it back into the menu (Organization.extraTools). Nothing is shown to an organization with
 * no type of activity — it already sees them all — nor when its trade uses every tool.
 *
 * The tool still needs its module (Modules above): this only decides whether a trade that does
 * not usually need it wants it in the menu.
 */
export function OtherToolsSettings({ organization }: { organization: Organization }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (extraTools: TradeTool[]) =>
      apiClient.patch<Organization>("/organizations/me", { extraTools }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organizations", "me"] }),
  });

  if (!organization.businessModel) return null;
  const definition = BUSINESS_MODEL_DEFINITIONS[organization.businessModel];
  const others = TRADE_TOOLS.filter((tool) => !definition.tools.includes(tool));
  if (others.length === 0) return null;
  const current = organization.extraTools ?? [];

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="text-sm font-semibold text-text">Autres outils</h2>
      <p className="mt-1 text-sm text-text-muted">
        Votre menu ne montre que les outils d&apos;une activité « {definition.label} ». Ajoutez-en
        un si votre façon de travailler en a besoin.
      </p>
      {mutation.isError && (
        <p className="mt-3 text-xs text-destructive">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : "Impossible d'enregistrer. Réessayez."}
        </p>
      )}
      <div className="mt-4 space-y-4">
        {others.map((tool) => (
          <Switch
            key={tool}
            checked={current.includes(tool)}
            disabled={mutation.isPending}
            onCheckedChange={(checked) =>
              mutation.mutate(checked ? [...current, tool] : current.filter((t) => t !== tool))
            }
            label={TRADE_TOOL_LABELS[tool]}
            description={TOOL_DESCRIPTIONS[tool]}
          />
        ))}
      </div>
    </section>
  );
}
