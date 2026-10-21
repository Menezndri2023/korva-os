"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Card, Input, Notice, PageHeader } from "@korva/ui";
import { ApiError } from "@/lib/api-client";
import { adminApi, usePlatformAdmin } from "@/lib/platform-admin";

/** The administrator's own account: replace the generated password with one they chose. */
export default function AdminAccountPage() {
  const me = usePlatformAdmin();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = confirm.length > 0 && next !== confirm;
  const mutation = useMutation({
    mutationFn: () =>
      adminApi.post("/platform/auth/password", { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
    },
  });

  return (
    <div>
      <PageHeader title="Mon compte" description={me.data?.email} />
      <Card className="max-w-md p-6">
        <h2 className="text-lg font-semibold">Changer le mot de passe</h2>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!mismatch) mutation.mutate();
          }}
        >
          <Input aria-label="Mot de passe actuel" type="password" autoComplete="current-password" placeholder="Mot de passe actuel" value={current} onChange={(e) => setCurrent(e.target.value)} className="w-full" required />
          <Input aria-label="Nouveau mot de passe" type="password" autoComplete="new-password" placeholder="Nouveau mot de passe (12 caractères minimum)" value={next} onChange={(e) => setNext(e.target.value)} className="w-full" minLength={12} required />
          <Input aria-label="Confirmer le nouveau mot de passe" type="password" autoComplete="new-password" placeholder="Confirmer le nouveau mot de passe" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full" required />
          {mismatch && <p className="text-sm text-destructive">Les deux saisies diffèrent.</p>}
          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error instanceof ApiError && mutation.error.code === "INVALID_CREDENTIALS"
                ? "Le mot de passe actuel est incorrect."
                : "Le nouveau mot de passe doit faire au moins 12 caractères."}
            </p>
          )}
          {mutation.isSuccess && <Notice tone="info">Mot de passe modifié.</Notice>}
          <Button type="submit" loading={mutation.isPending} disabled={mismatch}>
            Enregistrer
          </Button>
        </form>
      </Card>
    </div>
  );
}
