import { KORVA_SUPPORT } from "@korva/types";
import { Card } from "@korva/ui";
import { usePlanFeatures } from "@/lib/use-plan-features";
import { useT } from "@/lib/dashboard-locale";

/** Business: the direct line to KORVA, on the dashboard home. Nothing below Business. */
export function PrioritySupportCard() {
  const planFeatures = usePlanFeatures();
  const t = useT();
  if (planFeatures.planKey !== "business") return null;
  return (
    <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text">{t("Accompagnement prioritaire", "Priority support")}</p>
        <p className="mt-1 text-sm text-text-muted">
          {t(
            "Formule Business : écrivez-nous directement, votre demande passe en premier.",
            "Business plan: write to us directly, your request goes first.",
          )}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <a
          href={KORVA_SUPPORT.whatsappUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center rounded-lg bg-action px-4 text-sm font-semibold text-on-action hover:bg-action-hover"
        >
          WhatsApp {KORVA_SUPPORT.phoneDisplay}
        </a>
        <a
          href={`mailto:${KORVA_SUPPORT.email}`}
          className="inline-flex min-h-11 items-center rounded-lg border border-border-input bg-surface px-4 text-sm font-semibold text-text hover:bg-surface-muted"
        >
          {KORVA_SUPPORT.email}
        </a>
      </div>
    </Card>
  );
}
