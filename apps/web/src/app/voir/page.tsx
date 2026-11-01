"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";

/**
 * Landing of "Voir son tableau de bord", opened in a new tab by the administration. The view
 * token arrives in the URL fragment — never sent to any server, and erased from the address bar
 * and history at once — and only lives in this tab's memory.
 */
export default function ViewAsPage() {
  const router = useRouter();
  const enterViewMode = useAuthStore((state) => state.enterViewMode);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    window.history.replaceState(null, "", "/voir");
    const accessToken = params.get("t");
    const organizationId = params.get("o");
    const expiresAt = params.get("e");
    const user = params.get("u");
    if (!accessToken || !organizationId || !expiresAt || !user) {
      // Rendering the failure is this effect's whole outcome — there is nothing else to sync.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailed(true);
      return;
    }
    enterViewMode({ accessToken, organizationId, expiresAt, user: JSON.parse(user) });
    router.replace("/dashboard");
  }, [enterViewMode, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-app-background px-4 text-sm text-text-muted">
      {failed ? "Lien de consultation invalide. Rouvrez-le depuis l'administration." : "Ouverture du tableau de bord…"}
    </main>
  );
}
