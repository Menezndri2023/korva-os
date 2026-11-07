import {
  MIN_ONLINE_PAYMENT,
  MIN_PAYOUT_AMOUNT,
  ONLINE_PAYMENT_TERMS_VERSION,
  PLAN_COMMISSION_BASIS_POINTS,
  PLAN_NAMES,
  PLAN_PAYOUT_RULES,
  PROVIDER_FEE_RATES,
  PROVIDER_PAYOUT_FEE_BASIS_POINTS,
  type Locale,
  type PlanKey,
} from "@korva/types";
import { PublicFooter, PublicHeader } from "./trade-page";

/** Paths of this page in each language. */
export const ONLINE_PAYMENT_TERMS_PATH: Record<Locale, string> = {
  fr: "/conditions/paiement-en-ligne",
  en: "/en/terms/online-payment",
};

/** Days a sale stays "en attente" before it can be withdrawn — WALLET_HOLD_DAYS' default. */
const HOLD_DAYS = 3;
const PLANS: PlanKey[] = ["free", "starter", "pro", "business"];

function percent(basisPoints: number, locale: Locale): string {
  return `${(basisPoints / 100).toLocaleString(locale === "en" ? "en-GB" : "fr-FR")} %`;
}

/**
 * Conditions du paiement en ligne KORVA — what a business accepts when it turns online payment on
 * (ONLINE_PAYMENT_TERMS_VERSION, recorded on the organization). Every figure is read from the
 * constants the API applies, so the page can never promise a rate KORVA does not charge.
 *
 * Written in plain words for the businesses using it; it does not replace advice from a lawyer on
 * the rules for holding funds for third parties (BCEAO), which the owner was told to obtain.
 */
export function OnlinePaymentTerms({ locale }: { locale: Locale }) {
  const en = locale === "en";
  const t = (fr: string, english: string) => (en ? english : fr);
  const fee = (method: keyof typeof PROVIDER_FEE_RATES) =>
    `${percent(PROVIDER_FEE_RATES[method].basisPoints, locale)} + ${PROVIDER_FEE_RATES[method].fixed} F`;
  const version = new Date(`${ONLINE_PAYMENT_TERMS_VERSION}T12:00:00Z`).toLocaleDateString(
    en ? "en-GB" : "fr-FR",
    { dateStyle: "long" },
  );

  const sections: { title: string; body: React.ReactNode }[] = [
    {
      title: t("1. Un service facultatif", "1. An optional service"),
      body: (
        <p>
          {t(
            "Le paiement en ligne KORVA permet à votre entreprise d'être payée par Wave, Orange Money, MTN Mobile Money, Moov Money ou carte bancaire, sur votre site KORVA ou au QR de votre caisse. Il est facultatif : vous pouvez n'accepter que les espèces (à la livraison, au retrait ou sur place), et dans ce cas KORVA ne prend aucune commission. Vous l'activez et le désactivez à tout moment dans vos Paramètres.",
            "KORVA online payment lets your business be paid by Wave, Orange Money, MTN Mobile Money, Moov Money or bank card, on your KORVA site or at your till's QR code. It is optional: you may accept cash only (on delivery, on collection or in person), and KORVA then takes no commission at all. You turn it on and off at any time in your Settings.",
          )}
        </p>
      ),
    },
    {
      title: t("2. Comment l'argent circule", "2. How the money flows"),
      body: (
        <>
          <p>
            {t(
              "Les paiements de vos clients sont encaissés par KORVA, pour votre compte, auprès de son prestataire de paiement GeniusPay. Chaque paiement réussi est inscrit sur votre Solde KORVA, avec le détail des frais retenus.",
              "Your customers' payments are collected by KORVA, on your behalf, through its payment provider GeniusPay. Each successful payment is recorded on your KORVA Balance, with the fees kept shown line by line.",
            )}
          </p>
          <p>
            {t(
              `Un paiement devient disponible ${HOLD_DAYS} jours après le paiement du client. Ce délai couvre les annulations, les litiges et la fraude. Vous retirez ensuite votre solde vers le numéro mobile money que vous avez confirmé par un code reçu par e-mail.`,
              `A payment becomes available ${HOLD_DAYS} days after the customer pays. This delay covers cancellations, disputes and fraud. You then withdraw your balance to the mobile money number you confirmed with a code sent by e-mail.`,
            )}
          </p>
        </>
      ),
    },
    {
      title: t("3. Frais et commissions", "3. Fees and commissions"),
      body: (
        <>
          <p>
            {t(
              "Sur chaque paiement en ligne, trois montants sont déduits avant que l'argent n'arrive sur votre numéro :",
              "On each online payment, three amounts are taken before the money reaches your number:",
            )}
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              {t("les frais de GeniusPay, selon le moyen choisi par le client : ", "GeniusPay's fee, depending on how the customer pays: ")}
              Wave {fee("wave")}, Orange Money, MTN {t("et", "and")} Moov {fee("mobile_money")},{" "}
              {t("carte", "card")} {fee("card")} ;
            </li>
            <li>{t("la commission de KORVA, selon votre formule (tableau ci-dessous) ;", "KORVA's commission, depending on your plan (table below);")}</li>
            <li>
              {t(
                `les frais de retrait de GeniusPay, ${percent(PROVIDER_PAYOUT_FEE_BASIS_POINTS, locale)} du montant retiré.`,
                `GeniusPay's withdrawal fee, ${percent(PROVIDER_PAYOUT_FEE_BASIS_POINTS, locale)} of the amount withdrawn.`,
              )}
            </li>
          </ul>
          <div className="overflow-x-auto">
            <table className="mt-2 w-full min-w-[28rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-rule text-left">
                  <th className="py-2 pr-4 font-semibold">{t("Formule", "Plan")}</th>
                  <th className="py-2 pr-4 font-semibold">{t("Commission KORVA", "KORVA commission")}</th>
                  <th className="py-2 font-semibold">{t("Retraits", "Withdrawals")}</th>
                </tr>
              </thead>
              <tbody>
                {PLANS.map((plan) => {
                  const rules = PLAN_PAYOUT_RULES[plan];
                  return (
                    <tr key={plan} className="border-b border-rule">
                      <td className="py-2 pr-4">{PLAN_NAMES[plan]}</td>
                      <td className="py-2 pr-4 tabular-nums">{percent(PLAN_COMMISSION_BASIS_POINTS[plan], locale)}</td>
                      <td className="py-2">
                        {rules.manualPerWeek === null
                          ? t("quand vous voulez, automatique chaque jour possible", "whenever you like, daily automatic available")
                          : t(
                              `${rules.manualPerWeek} demande par semaine, automatique chaque semaine possible`,
                              `${rules.manualPerWeek} request a week, weekly automatic available`,
                            )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>
            {t(
              `Un paiement en ligne commence à ${MIN_ONLINE_PAYMENT.XOF} F (${MIN_ONLINE_PAYMENT.EUR} € ou ${MIN_ONLINE_PAYMENT.USD} $) : en dessous, les frais fixes prendraient une trop grande part de la vente. Un retrait commence à ${MIN_PAYOUT_AMOUNT.toLocaleString("fr-FR")} F. Votre page Solde calcule ce que vous recevez pour n'importe quel prix.`,
              `An online payment starts at ${MIN_ONLINE_PAYMENT.XOF} F (€${MIN_ONLINE_PAYMENT.EUR} or $${MIN_ONLINE_PAYMENT.USD}): below that, the fixed fees would take too large a share of the sale. A withdrawal starts at ${MIN_PAYOUT_AMOUNT.toLocaleString("en-GB")} F. Your Balance page works out what you receive for any price.`,
            )}
          </p>
        </>
      ),
    },
    {
      title: t("4. Ventes dans une autre devise que le franc CFA", "4. Sales in a currency other than the CFA franc"),
      body: (
        <p>
          {t(
            "GeniusPay fait payer vos clients en francs CFA, à son propre taux de change. Si votre boutique est en euros ou en dollars, une partie de chaque vente est perdue au change, en plus des frais : environ 7 % pour l'euro aux taux constatés en novembre 2026. Vos clients voient avant de payer le montant en francs CFA, et votre Solde montre la perte de change sur une ligne à part.",
            "GeniusPay charges your customers in CFA francs, at its own exchange rate. If your shop is in euros or dollars, part of each sale is lost to the exchange, on top of the fees: about 7% for the euro at the rates seen in November 2026. Your customers see the CFA franc amount before paying, and your Balance shows the exchange loss on a line of its own.",
          )}
        </p>
      ),
    },
    {
      title: t("5. Remboursements et litiges", "5. Refunds and disputes"),
      body: (
        <p>
          {t(
            "Vous restez le vendeur : c'est à vous que vos clients s'adressent, et vous décidez d'un remboursement. Un remboursement est déduit de votre Solde. Les frais de GeniusPay sur le paiement d'origine ne sont pas rendus. En cas de litige ou de soupçon de fraude, KORVA peut retenir le montant concerné sur votre Solde le temps de l'examiner, et vous en informe.",
            "You remain the seller: your customers deal with you, and you decide on a refund. A refund is taken from your Balance. GeniusPay's fees on the original payment are not returned. In a dispute or on suspicion of fraud, KORVA may hold the amount concerned on your Balance while it is examined, and tells you so.",
          )}
        </p>
      ),
    },
    {
      title: t("6. Vos engagements", "6. Your commitments"),
      body: (
        <ul className="list-disc space-y-1 pl-6">
          <li>{t("Vendre des biens et services licites, que vous livrez réellement.", "Sell lawful goods and services that you actually deliver.")}</li>
          <li>{t("Donner des informations exactes sur votre entreprise, et un numéro de retrait à votre nom ou à celui de l'entreprise.", "Give accurate information about your business, and a withdrawal number in your own or the business's name.")}</li>
          <li>{t("Déclarer vos ventes et payer vos impôts selon les règles de votre pays.", "Declare your sales and pay your taxes under your country's rules.")}</li>
          <li>{t("Ne pas utiliser le paiement en ligne pour transférer de l'argent sans vente réelle.", "Not use online payment to move money without a real sale.")}</li>
        </ul>
      ),
    },
    {
      title: t("7. Suspension et arrêt", "7. Suspension and ending"),
      body: (
        <p>
          {t(
            "Vous pouvez arrêter le paiement en ligne à tout moment : votre solde reste à vous et se retire normalement après le délai de sécurité. KORVA peut suspendre le paiement en ligne d'une entreprise qui ne respecte pas ces conditions, ou sur demande de GeniusPay ou d'une autorité. Dans ce cas, l'argent qui vous revient vous est versé, sauf les montants retenus au titre d'un litige ou d'une fraude.",
            "You may stop online payment at any time: your balance remains yours and is withdrawn as usual after the safety delay. KORVA may suspend online payment for a business that does not respect these terms, or at the request of GeniusPay or an authority. In that case the money owed to you is paid out, except amounts held for a dispute or fraud.",
          )}
        </p>
      ),
    },
    {
      title: t("8. Changements de ces conditions", "8. Changes to these terms"),
      body: (
        <p>
          {t(
            "Si ces conditions changent sur le fond (une commission, un frais, un délai), vous en êtes informé par e-mail et dans votre tableau de bord, et vous devez accepter la nouvelle version avant de recevoir un nouveau paiement en ligne. Rien ne change sans votre accord.",
            "If these terms change in substance (a commission, a fee, a delay), you are told by e-mail and in your dashboard, and you must accept the new version before receiving a new online payment. Nothing changes without your agreement.",
          )}
        </p>
      ),
    },
  ];

  return (
    <div className="bg-paper text-ink" lang={locale}>
      <PublicHeader locale={locale} otherLanguageHref={ONLINE_PAYMENT_TERMS_PATH[en ? "fr" : "en"]} />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-12 sm:px-8">
        <header className="space-y-2">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">
            {t("Conditions du paiement en ligne", "Online payment terms")}
          </h1>
          <p className="text-sm text-ink-soft">{t(`Version du ${version}`, `Version of ${version}`)}</p>
        </header>
        {sections.map((section) => (
          <section key={section.title} className="space-y-3 leading-relaxed">
            <h2 className="font-display text-xl font-semibold">{section.title}</h2>
            {section.body}
          </section>
        ))}
      </main>
      <PublicFooter locale={locale} />
    </div>
  );
}
