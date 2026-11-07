"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { formatCurrency } from "@/lib/analytics-format";
import { useAuthReady } from "@/lib/use-auth-ready";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

interface MonthlyProfit {
  month: string;
  currency: string;
  collected: number;
  refunded: number;
  expenses: number;
  profit: number;
  expensesByCategory: { category: string; amount: number }[];
}

function monthKey(offset: number): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * "Bénéfice du mois": what came in (every payment received, less refunds) minus the month's
 * expenses — the question an owner actually asks, "did I earn money this month?". A cash view,
 * said as such: not an accounting result.
 */
export function MonthlyProfitCard() {
  const t = useT();
  const locale = useDashboardLocale();
  const authReady = useAuthReady();
  const months = Array.from({ length: 12 }, (_, index) => monthKey(index));
  const [month, setMonth] = useState(months[0]!);
  const profit = useQuery({
    queryKey: ["expenses", "profit", month],
    queryFn: () => apiClient.get<MonthlyProfit>(`/expenses/profit?month=${month}`),
    enabled: authReady,
  });
  const money = (amount: number) => formatCurrency(amount, profit.data?.currency ?? null, locale);
  const label = (value: string) => {
    const [year, m] = value.split("-").map(Number) as [number, number];
    return new Date(year, m - 1, 1).toLocaleDateString(intlLocale(locale), { month: "long", year: "numeric" });
  };
  const data = profit.data;

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-text">{t("Bénéfice du mois", "This month's profit")}</h2>
        <select
          aria-label={t("Mois", "Month")}
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          className="rounded-md border border-border-input bg-surface px-2 py-1.5 text-sm text-text"
        >
          {months.map((value) => (
            <option key={value} value={value}>
              {label(value)}
            </option>
          ))}
        </select>
      </div>
      {profit.isError && (
        <p className="text-sm text-destructive">{t("Impossible de calculer le bénéfice.", "The profit could not be worked out.")}</p>
      )}
      {data && (
        <>
          <p className={`text-3xl font-semibold tabular-nums ${data.profit < 0 ? "text-destructive" : "text-text"}`}>
            {money(data.profit)}
          </p>
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-text-muted">{t("Encaissé", "Received")}</dt>
              <dd className="tabular-nums text-text">{money(data.collected)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">{t("Remboursé", "Refunded")}</dt>
              <dd className="tabular-nums text-text">{money(-data.refunded)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">{t("Dépenses", "Expenses")}</dt>
              <dd className="tabular-nums text-text">{money(-data.expenses)}</dd>
            </div>
          </dl>
          {data.expensesByCategory.length > 0 && (
            <p className="text-xs text-text-muted">
              {t("Plus grosses dépenses : ", "Largest expenses: ")}
              {data.expensesByCategory
                .slice(0, 3)
                .map((row) => `${row.category} ${money(row.amount)}`)
                .join(", ")}
            </p>
          )}
          <p className="text-xs text-text-muted">
            {t(
              "Tous les paiements reçus (espèces, mobile money, carte) moins les remboursements et les dépenses notées ici. Un repère de trésorerie, pas un bilan comptable.",
              "Every payment received (cash, mobile money, card) less refunds and the expenses recorded here. A cash indicator, not an accounting result.",
            )}
          </p>
        </>
      )}
    </Card>
  );
}
