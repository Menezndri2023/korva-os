import { intlLocaleOf, translator, type Translate } from '../../shared/i18n';

/**
 * Documents are written in the business's language (shared/i18n.ts): its customer reads them.
 * The statuses are the API's own keys, so they are named here rather than printed raw.
 */
export function documentWords(language: string | null | undefined): {
  t: Translate;
  date: (value: Date) => string;
  money: (amount: number, currency: string) => string;
  status: (status: string) => string;
} {
  const t = translator(language);
  const intl = intlLocaleOf(language);
  const statuses: Record<string, [string, string]> = {
    draft: ['Brouillon', 'Draft'],
    issued: ['Émise', 'Issued'],
    sent: ['Envoyé', 'Sent'],
    viewed: ['Consulté', 'Viewed'],
    accepted: ['Accepté', 'Accepted'],
    rejected: ['Refusé', 'Rejected'],
    expired: ['Expiré', 'Expired'],
    partially_paid: ['Partiellement payée', 'Partly paid'],
    paid: ['Payée', 'Paid'],
    overdue: ['En retard', 'Overdue'],
    cancelled: ['Annulée', 'Cancelled'],
  };
  return {
    t,
    date: (value) => value.toLocaleDateString(intl),
    money: (amount, currency) =>
      new Intl.NumberFormat(intl, { style: 'currency', currency }).format(
        amount,
      ),
    status: (status) => {
      const pair = statuses[status];
      return pair ? t(...pair) : status;
    },
  };
}
