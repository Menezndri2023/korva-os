"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, Input, Notice } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { formatCurrency } from "@/lib/analytics-format";
import { useAuthStore } from "@/lib/auth-store";
import { useDashboardLocale, useT } from "@/lib/dashboard-locale";

interface QueuedSale {
  amount: number;
  label?: string;
  key: string;
  soldAt: string;
}

const queueKey = (organizationId: string) => `korva-till-queue:${organizationId}`;

function readQueue(organizationId: string): QueuedSale[] {
  try {
    const raw = window.localStorage.getItem(queueKey(organizationId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as QueuedSale[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(organizationId: string, queue: QueuedSale[]): void {
  try {
    window.localStorage.setItem(queueKey(organizationId), JSON.stringify(queue));
  } catch {
    // Storage full or blocked: the sale stays in memory until sent.
  }
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * "Vente en espèces" — and a till that keeps working when the connection drops (2026-11-07).
 * Each sale gets its own key and goes into a queue kept on this phone; the queue is sent at once,
 * and again whenever the network comes back. The API records a key once, so a sale sent twice
 * (a reply lost on a bad network) is still one sale. The page must have been opened while
 * online; mobile money by QR code needs the network by nature.
 */
export function CashSaleCard({ currency }: { currency: string | null }) {
  const t = useT();
  const locale = useDashboardLocale();
  const queryClient = useQueryClient();
  const organizationId = useAuthStore((state) => state.activeOrganizationId);
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const parsed = Number(amount.replace(/\s/g, "").replace(",", "."));

  const flush = useCallback(async () => {
    if (!organizationId || sending) return;
    let pending = readQueue(organizationId);
    if (pending.length === 0) return;
    setSending(true);
    try {
      while (pending.length > 0) {
        const sale = pending[0]!;
        try {
          await apiClient.post("/counter-payments/cash", sale);
          setLastSaved(sale.amount);
        } catch (error) {
          // No answer: still offline. Keep everything for the next try.
          if (!(error instanceof ApiError)) break;
          // A real refusal (an amount the API rejects): drop it, say so.
          setRefused(error.message);
        }
        pending = pending.slice(1);
        writeQueue(organizationId, pending);
        setQueue(pending);
      }
      void queryClient.invalidateQueries({ queryKey: ["till"] });
    } finally {
      setSending(false);
    }
  }, [organizationId, sending, queryClient]);

  /* eslint-disable react-hooks/set-state-in-effect -- the queue lives in localStorage, read after mount */
  useEffect(() => {
    if (!organizationId) return;
    setQueue(readQueue(organizationId));
    void flush();
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    const timer = setInterval(() => void flush(), 30_000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
    };
  }, [organizationId, flush]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!organizationId || !(parsed > 0)) return;
    const sale: QueuedSale = {
      amount: parsed,
      ...(label.trim() ? { label: label.trim() } : {}),
      key: newKey(),
      soldAt: new Date().toISOString(),
    };
    const next = [...readQueue(organizationId), sale];
    writeQueue(organizationId, next);
    setQueue(next);
    setAmount("");
    setLabel("");
    setRefused(null);
    void flush();
  }

  return (
    <Card className="space-y-3 p-5">
      <div>
        <h2 className="text-base font-semibold text-text">{t("Vente en espèces", "Cash sale")}</h2>
        <p className="mt-1 text-sm text-text-muted">
          {t(
            "Notez chaque vente payée en espèces : elle compte dans votre caisse du jour et votre bénéfice. Sans réseau, elle est gardée sur ce téléphone et envoyée dès le retour de la connexion.",
            "Record each sale paid in cash: it counts in today's till and your profit. Without network, it is kept on this phone and sent as soon as the connection is back.",
          )}
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-text-muted">{t("Montant", "Amount")}</span>
          <Input
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="w-36 tabular-nums"
            placeholder="0"
          />
        </label>
        <label className="min-w-0 flex-1 text-sm">
          <span className="mb-1 block text-text-muted">{t("Article ou service (facultatif)", "Item or service (optional)")}</span>
          <Input value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} placeholder={t("Vente au comptoir", "Counter sale")} />
        </label>
        <Button type="submit" disabled={!(parsed > 0)}>
          {t("Enregistrer la vente", "Record the sale")}
        </Button>
      </form>
      {queue.length > 0 ? (
        <Notice tone="warning">
          {t(
            `Hors connexion : ${queue.length} vente(s) en attente d'envoi (${formatCurrency(queue.reduce((sum, sale) => sum + sale.amount, 0), currency, locale)}). Elles partent toutes seules au retour du réseau.`,
            `Offline: ${queue.length} sale(s) waiting to be sent (${formatCurrency(queue.reduce((sum, sale) => sum + sale.amount, 0), currency, locale)}). They go by themselves when the network is back.`,
          )}
        </Notice>
      ) : (
        lastSaved !== null && (
          <p className="text-sm text-text-muted" role="status">
            {t(`Vente de ${formatCurrency(lastSaved, currency, locale)} enregistrée.`, `${formatCurrency(lastSaved, currency, locale)} sale recorded.`)}
          </p>
        )
      )}
      {refused && <p className="text-sm text-destructive">{refused}</p>}
    </Card>
  );
}
