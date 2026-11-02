"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { REFERRAL_REWARD, SIGNUP_TRIAL, type ReferralSummary } from "@korva/types";
import { Button, Card, Notice, PageHeader, StatTile } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { useDashboardLocale, useT } from "@/lib/dashboard-locale";

/**
 * Parrainage: the business's own link to KORVA. What a business owner tells another one is what
 * convinces them most, so the page makes that one tap — copy the link, or send it on WhatsApp.
 */
export default function ReferralPage() {
  const authReady = useAuthReady();
  const locale = useDashboardLocale();
  const t = useT();
  const { data: organization } = useActiveOrganization();
  const [copied, setCopied] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["organizations", "me", "referral"],
    queryFn: () => apiClient.get<ReferralSummary>("/organizations/me/referral"),
    enabled: authReady,
  });

  const link = data
    ? `${window.location.origin}/register?ref=${data.code}${locale === "en" ? "&lang=en" : ""}`
    : "";
  const message = t(
    `Je gère ${organization?.name ?? "mon entreprise"} avec KORVA : site, rendez-vous, caisse et paiements au même endroit. Inscris-toi avec mon lien, tu as ${REFERRAL_REWARD.refereeTrialDays} jours de Pro offerts : ${link}`,
    `I run ${organization?.name ?? "my business"} with KORVA: website, bookings, till and payments in one place. Sign up with my link and get ${REFERRAL_REWARD.refereeTrialDays} days of Pro free: ${link}`,
  );

  function copy() {
    void navigator.clipboard?.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title={t("Parrainer un commerçant", "Refer a business")}
        description={t(
          `Partagez votre lien. Le commerçant qui s'inscrit avec reçoit ${REFERRAL_REWARD.refereeTrialDays} jours de Pro offerts au lieu de ${SIGNUP_TRIAL.days}. Vous recevez un mois de Pro dès qu'il paie sa première formule.`,
          `Share your link. The business that signs up with it gets ${REFERRAL_REWARD.refereeTrialDays} days of Pro free instead of ${SIGNUP_TRIAL.days}. You get a month of Pro as soon as it pays for its first plan.`,
        )}
      />

      {isLoading && <Card className="p-6 text-sm text-text-muted">{t("Chargement…", "Loading…")}</Card>}
      {isError && (
        <Card className="p-6 text-sm text-destructive">
          {t("Impossible de charger votre lien de parrainage.", "Your referral link could not be loaded.")}
        </Card>
      )}

      {data && (
        <>
          <Card className="space-y-4 p-5">
            <div>
              <p className="text-sm font-medium text-text">{t("Votre lien", "Your link")}</p>
              <p className="mt-1 break-all rounded-md bg-surface-muted px-3 py-2 font-mono text-sm text-text">
                {link}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {t(`Votre code : ${data.code}`, `Your code: ${data.code}`)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center rounded-lg bg-action px-4 text-sm font-semibold text-on-action hover:bg-action-hover"
              >
                {t("Envoyer sur WhatsApp", "Send on WhatsApp")}
              </a>
              <Button type="button" variant="secondary" onClick={copy}>
                {copied ? t("Lien copié", "Link copied") : t("Copier le lien", "Copy the link")}
              </Button>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatTile label={t("Inscrits avec votre lien", "Signed up with your link")} value={data.signedUp} />
            <StatTile
              tone="emphasis"
              label={t("Mois de Pro gagnés", "Months of Pro earned")}
              value={data.rewarded}
            />
          </div>

          <Notice tone="info">
            {t(
              "La récompense arrive au premier paiement du commerçant parrainé, jamais à la simple inscription : elle s'ajoute à votre formule actuelle, sans rien vous facturer.",
              "The reward comes with the referred business's first payment, never with the sign-up alone: it is added to your current plan, at no charge.",
            )}
          </Notice>
        </>
      )}
    </div>
  );
}
