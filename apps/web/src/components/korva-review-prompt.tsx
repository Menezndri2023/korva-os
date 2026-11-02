"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PlatformReview } from "@korva/types";
import { HeartHandshake, X } from "lucide-react";
import { Card } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { useT } from "@/lib/dashboard-locale";

/** Long enough to have an opinion, short enough that it is still fresh. */
const PROMPT_AFTER_DAYS = 7;

function dismissKey(organizationId: string) {
  return `korva-review-prompt-dismissed:${organizationId}`;
}

function readDismissed(organizationId: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(organizationId)) === "1";
  } catch {
    return false;
  }
}

/**
 * A one-line invitation on the dashboard home to say what the business thinks of KORVA, shown
 * once it has used KORVA for a week and until it either writes a review or closes the card.
 * Closing is remembered in this browser only — a convenience, not something to sync.
 */
export function KorvaReviewPrompt({
  organizationId,
  organizationCreatedAt,
}: {
  organizationId: string;
  organizationCreatedAt?: string;
}) {
  const [dismissed, setDismissed] = useState(() =>
    typeof window === "undefined" ? true : readDismissed(organizationId),
  );
  const [now] = useState(() => Date.now());
  const t = useT();
  const oldEnough =
    Boolean(organizationCreatedAt) &&
    now - new Date(organizationCreatedAt!).getTime() >= PROMPT_AFTER_DAYS * 86_400_000;

  const mine = useQuery({
    queryKey: ["platform-review", "me"],
    queryFn: () => apiClient.get<PlatformReview | null>("/platform-reviews/me"),
    enabled: oldEnough && !dismissed,
  });

  if (!oldEnough || dismissed || mine.data !== null) return null;

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(dismissKey(organizationId), "1");
    } catch {
      // Storage unavailable: the card simply comes back next visit.
    }
  }

  return (
    <Card className="flex items-center gap-3 p-4">
      <HeartHandshake aria-hidden className="h-6 w-6 shrink-0 text-primary" />
      <p className="flex-1 text-sm text-text">
        {t("Vous utilisez KORVA depuis quelques jours.", "You have been using KORVA for a few days.")}{" "}
        <Link href="/dashboard/avis-korva" className="font-medium underline underline-offset-2">
          {t("Dites-nous ce que vous en pensez", "Tell us what you think")}
        </Link>
        {t(", en une minute.", ", in a minute.")}
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("Masquer cette invitation", "Hide this invitation")}
        className="rounded-md p-1 text-text-muted hover:bg-surface-muted hover:text-text"
      >
        <X aria-hidden className="h-4 w-4" />
      </button>
    </Card>
  );
}
