"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { PublicReviewInvitation } from "@korva/types";
import { Button, Card } from "@korva/ui";
import { publicApiClient, PublicApiError } from "@/lib/public-api-client";
import { AccountShell } from "../account/account-shell";
import { StarPicker } from "../star-picker";

export default function ReviewInvitationClient({ slug, token }: { slug: string; token: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [showName, setShowName] = useState(true);
  const [missingRating, setMissingRating] = useState(false);

  const invitation = useQuery({
    queryKey: ["review-invitation", slug, token],
    queryFn: () =>
      publicApiClient.get<PublicReviewInvitation>(
        `/public/${slug}/review-invitation?token=${encodeURIComponent(token)}`,
      ),
    enabled: token.length > 0,
    retry: false,
  });

  const submit = useMutation({
    mutationFn: () =>
      publicApiClient.post(`/public/${slug}/reviews`, {
        token,
        rating,
        comment: comment.trim() || undefined,
        showName,
      }),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (rating === 0) {
      setMissingRating(true);
      return;
    }
    submit.mutate();
  }

  const backToSite = (
    <Link href={`/${slug}`} className="font-medium text-text underline underline-offset-2">
      Voir le site
    </Link>
  );

  if (!token || invitation.isError) {
    return (
      <AccountShell slug={slug} title="Donner mon avis">
        <Card className="space-y-2 p-6 text-sm text-text-muted">
          <p className="font-medium text-text">Ce lien n’est plus valide.</p>
          <p>
            Il a peut-être expiré, ou il a été copié incomplètement. Vous pouvez aussi laisser un avis
            depuis votre espace client, sur la commande ou la réservation concernée.
          </p>
          <p>{backToSite}</p>
        </Card>
      </AccountShell>
    );
  }

  if (invitation.isLoading || !invitation.data) {
    return (
      <AccountShell slug={slug} title="Donner mon avis">
        <Card className="p-6 text-sm text-text-muted">Chargement…</Card>
      </AccountShell>
    );
  }

  const data = invitation.data;
  const alreadyDone =
    data.alreadyReviewed ||
    (submit.error instanceof PublicApiError && submit.error.code === "REVIEW_ALREADY_EXISTS");

  if (submit.isSuccess || alreadyDone) {
    return (
      <AccountShell slug={slug} title={`Votre avis sur ${data.organizationName}`}>
        <Card className="space-y-2 p-6 text-sm text-text-muted">
          <p className="text-base font-semibold text-text">
            {submit.isSuccess ? "Merci, votre avis est publié." : "Vous avez déjà donné votre avis sur cet achat."}
          </p>
          <p>
            {submit.isSuccess
              ? `Il aide ${data.organizationName} à s'améliorer et les prochains clients à choisir.`
              : "Un seul avis par achat : c'est ce qui les rend fiables."}
          </p>
          <p>{backToSite}</p>
        </Card>
      </AccountShell>
    );
  }

  const what = data.entity === "order" ? "votre commande" : "votre rendez-vous";

  return (
    <AccountShell slug={slug} title={`Votre avis sur ${data.organizationName}`}>
      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <p className="text-sm text-text-muted">
              {data.customerFirstName ? `${data.customerFirstName}, comment` : "Comment"} s’est passé{" "}
              {what} ?
            </p>
            {data.items.length > 0 && (
              <p className="mt-1 text-sm font-medium text-text">{data.items.join(", ")}</p>
            )}
          </div>

          <div>
            <StarPicker
              value={rating}
              onChange={(value) => {
                setRating(value);
                setMissingRating(false);
              }}
            />
            {missingRating && (
              <p className="text-sm text-destructive" role="alert">
                Choisissez une note de 1 à 5 étoiles.
              </p>
            )}
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-text-muted">Votre commentaire (facultatif)</span>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Ce que vous avez aimé, ce qui pourrait être mieux…"
              className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-base text-text focus:border-focus focus:outline-none"
            />
          </label>

          {data.customerFirstName && (
            <label className="flex items-start gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={showName}
                onChange={(event) => setShowName(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Signer avec mon prénom ({data.customerFirstName})
                <span className="block text-xs text-text-muted">
                  Sinon, votre avis apparaît comme « Client vérifié ».
                </span>
              </span>
            </label>
          )}

          {submit.isError && !alreadyDone && (
            <p className="text-sm text-destructive" role="alert">
              {submit.error instanceof PublicApiError ? submit.error.message : "Envoi impossible. Réessayez."}
            </p>
          )}

          <Button type="submit" loading={submit.isPending} className="w-full">
            Publier mon avis
          </Button>
          <p className="text-center text-xs text-text-muted">
            Votre avis est publié sur le site de {data.organizationName}, qui peut y répondre.
          </p>
        </form>
      </Card>
    </AccountShell>
  );
}
