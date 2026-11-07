"use client";

import { useState } from "react";
import { Button } from "@korva/ui";
import { downloadFile } from "@/lib/api-client";
import { useT } from "@/lib/dashboard-locale";

/** A button that downloads a file the API renders (PDF, CSV), with its own busy and error state. */
export function DownloadButton({
  path,
  filename,
  label,
  variant = "secondary",
}: {
  path: string;
  filename: string;
  label: string;
  variant?: "secondary" | "ghost";
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex flex-col">
      <Button
        type="button"
        variant={variant}
        size="sm"
        loading={busy}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          downloadFile(path, filename)
            .catch(() => setFailed(true))
            .finally(() => setBusy(false));
        }}
      >
        {label}
      </Button>
      {failed && (
        <span className="mt-1 text-xs text-destructive">
          {t("Le téléchargement n'a pas abouti. Réessayez.", "The download failed. Try again.")}
        </span>
      )}
    </span>
  );
}
