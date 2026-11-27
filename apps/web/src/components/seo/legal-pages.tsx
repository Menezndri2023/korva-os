import Link from "next/link";
import { KORVA_SUPPORT, KORVA_VAT, SIGNUP_TRIAL, type Locale } from "@korva/types";
import { LEGAL_ENTITY, PUBLISHER } from "@/lib/brand";
import { LEGAL_PATHS, LEGAL_TITLES, type LegalPage } from "@/lib/legal-paths";
import { ONLINE_PAYMENT_TERMS_PATH } from "./online-payment-terms";
import { PlanLadder } from "@/components/landing/plan-ladder";
import { PublicFooter, PublicHeader } from "./trade-page";

/**
 * KORVA's legal pages — what a payment provider's compliance team (Paystack, YouCan Pay) and a
 * customer look for before trusting the site: who sells, under which terms, what happens to their
 * money and their data, and how to reach a person.
 *
 * Every rule written here is one the code applies (checked 2026-11-27): the Pro trial
 * (SIGNUP_TRIAL), "pay first" before a paid plan opens, cancellation at the end of the paid
 * period, an unpaid invoice becoming overdue after 7 days (SUBSCRIPTION_INVOICE_GRACE_DAYS), no
 * self-serve account deletion (done on request). Change the page when the rule changes.
 */

/** Date these texts were last changed in substance — shown on every page. */
export const LEGAL_PAGES_VERSION = "2026-11-27";

type Section = { title: string; body: React.ReactNode };

function Mail() {
  return (
    <a href={`mailto:${KORVA_SUPPORT.email}`} className="underline underline-offset-4">
      {KORVA_SUPPORT.email}
    </a>
  );
}

function CompanyCard({ locale }: { locale: Locale }) {
  const en = locale === "en";
  const rows: [string, React.ReactNode][] = [
    [en ? "Company" : "Société", `${LEGAL_ENTITY.name} ${LEGAL_ENTITY.form}`],
    [en ? "Legal form" : "Forme", LEGAL_ENTITY.formLong[locale]],
    [en ? "Share capital" : "Capital social", LEGAL_ENTITY.capital],
    [en ? "Registered office" : "Siège social", LEGAL_ENTITY.address],
    [en ? "Trade register" : "Registre du commerce", `RC ${LEGAL_ENTITY.rc}, ${LEGAL_ENTITY.rcCourt}`],
    ["ICE", LEGAL_ENTITY.ice],
    [en ? "Tax identifier (IF)" : "Identifiant fiscal (IF)", LEGAL_ENTITY.if],
    [en ? "Business tax (TP)" : "Taxe professionnelle (TP)", LEGAL_ENTITY.tp],
    [en ? "Manager" : "Gérant", LEGAL_ENTITY.manager],
    [en ? "E-mail" : "E-mail", <Mail key="mail" />],
    [
      en ? "Phone and WhatsApp" : "Téléphone et WhatsApp",
      <a key="wa" href={KORVA_SUPPORT.whatsappUrl} className="underline underline-offset-4">
        {KORVA_SUPPORT.phoneDisplay}
      </a>,
    ],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-rule p-4 text-sm sm:grid-cols-[12rem_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-semibold">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function sectionsFor(page: LegalPage, locale: Locale): Section[] {
  const en = locale === "en";
  const t = (fr: string, english: string) => (en ? english : fr);
  const link = (target: LegalPage) => (
    <Link href={LEGAL_PATHS[target][locale]} className="underline underline-offset-4">
      {LEGAL_TITLES[target][locale]}
    </Link>
  );
  const company = `${LEGAL_ENTITY.name} ${LEGAL_ENTITY.form}`;

  switch (page) {
    case "pricing":
      return [
        {
          title: t("Les formules", "The plans"),
          body: (
            <>
              <p>
                {t(
                  "Choisissez votre pays pour voir vos prix. Vous payez au mois, pour 6 mois (10 % de remise) ou pour un an (deux mois offerts), sans engagement : vous résiliez quand vous voulez.",
                  "Pick your country to see your prices. You pay monthly, for 6 months (10% off) or for a year (two months free), with no commitment: you cancel whenever you like.",
                )}
              </p>
              <PlanLadder locale={locale} />
            </>
          ),
        },
        {
          title: t("TVA et factures", "VAT and invoices"),
          body: (
            <p>
              {t(
                `Chaque paiement donne une facture PDF émise par ${company}, à télécharger dans Paramètres > Abonnement. Au Maroc, les prix comprennent la TVA de ${KORVA_VAT.rate} %, détaillée sur la facture. Hors du Maroc, l'abonnement est facturé sans TVA marocaine (exportation de services).`,
                `Every payment comes with a PDF invoice issued by ${company}, in Settings > Subscription. In Morocco, prices include ${KORVA_VAT.rate}% VAT, shown on the invoice. Outside Morocco, the subscription is invoiced without Moroccan VAT (export of services).`,
              )}
            </p>
          ),
        },
        {
          title: t("Payer", "Paying"),
          body: (
            <p>
              {t(
                "Le paiement se fait sur la page sécurisée de notre prestataire de paiement ; les moyens disponibles dans votre pays (mobile money, carte bancaire) s'affichent au moment de payer. KORVA ne voit ni ne conserve votre numéro de carte. Remboursements et résiliation : ",
                "You pay on our payment provider's secure page; the methods available in your country (mobile money, bank card) are shown when you pay. KORVA never sees or stores your card number. Refunds and cancellation: ",
              )}
              {link("refunds")}.
            </p>
          ),
        },
      ];

    case "about":
      return [
        {
          title: "KORVA OS",
          body: (
            <p>
              {t(
                "KORVA OS est le logiciel de gestion et le site internet des petites entreprises : clients, ventes, rendez-vous, caisse, stock, factures et paiement en ligne par mobile money ou carte, dans un seul compte. Il est conçu d'abord pour l'Afrique francophone et utilisable partout, en français et en anglais.",
                "KORVA OS is the management software and website for small businesses: customers, sales, appointments, till, stock, invoices and online payment by mobile money or card, in one account. It is built first for French-speaking Africa and usable anywhere, in French and English.",
              )}
            </p>
          ),
        },
        {
          title: t("L'entreprise derrière KORVA", "The company behind KORVA"),
          body: (
            <>
              <p>
                {t(
                  `KORVA OS est conçu, développé et vendu par ${company}, groupe technologique basé à Casablanca qui conseille entreprises et institutions en Afrique, au Maghreb et à l'international en solutions digitales, infrastructures informatiques et stratégies d'innovation.`,
                  `KORVA OS is designed, built and sold by ${company}, a technology group based in Casablanca that advises businesses and institutions in Africa, the Maghreb and internationally on digital solutions, IT infrastructure and innovation strategy.`,
                )}
              </p>
              <p>
                {t(
                  `Le groupe est dirigé par son fondateur, ${LEGAL_ENTITY.manager}, ivoirien, entre Casablanca et Abidjan : KORVA est pensé par quelqu'un qui connaît les commerçants des deux rives.`,
                  `The group is led by its founder, ${LEGAL_ENTITY.manager}, an Ivorian working between Casablanca and Abidjan: KORVA is designed by someone who knows the shopkeepers on both sides.`,
                )}
              </p>
              <p>
                <a href={PUBLISHER.url} className="underline underline-offset-4">vit-global.tech</a>
                {PUBLISHER.links.map((profile) => (
                  <span key={profile.url}>
                    {" · "}
                    <a href={profile.url} rel="noopener" target="_blank" className="underline underline-offset-4">
                      {profile.label}
                    </a>
                  </span>
                ))}
              </p>
            </>
          ),
        },
        {
          title: t("Nos engagements", "What we commit to"),
          body: (
            <ul className="list-disc space-y-1 pl-6">
              <li>{t("Une personne vous répond, par e-mail ou WhatsApp, en français ou en anglais.", "A person answers you, by e-mail or WhatsApp, in French or English.")}</li>
              <li>{t("Vos données vous appartiennent ; elles sont sauvegardées chaque nuit, avec une copie hors de notre serveur.", "Your data is yours; it is backed up every night, with a copy off our server.")}</li>
              <li>{t("Des prix publics, pays par pays, sans engagement, et une facture pour chaque paiement.", "Public prices, country by country, no commitment, and an invoice for every payment.")}</li>
            </ul>
          ),
        },
        {
          title: t("Nous joindre", "Reach us"),
          body: <CompanyCard locale={locale} />,
        },
      ];

    case "notice":
      return [
        {
          title: t("Éditeur", "Publisher"),
          body: (
            <>
              <p>
                {t(
                  `KORVA OS (korvasuite.com) est un service édité et vendu par ${company}, société de droit marocain dont l'activité est : ${LEGAL_ENTITY.activity.fr.toLowerCase()}.`,
                  `KORVA OS (korvasuite.com) is a service published and sold by ${company}, a company under Moroccan law whose business is: ${LEGAL_ENTITY.activity.en.toLowerCase()}.`,
                )}
              </p>
              <CompanyCard locale={locale} />
            </>
          ),
        },
        {
          title: t("Directeur de la publication", "Publication director"),
          body: <p>{LEGAL_ENTITY.manager}, {t("gérant", "manager")}.</p>,
        },
        {
          title: t("Hébergement", "Hosting"),
          body: <p>{LEGAL_ENTITY.hosting[locale]}.</p>,
        },
        {
          title: t("Sites des entreprises", "Business websites"),
          body: (
            <p>
              {t(
                "Les sites publiés sur sites.korvasuite.com appartiennent aux entreprises qui les créent. Chacune est responsable de son contenu, de ses prix et de ses ventes ; KORVA en fournit seulement l'outil.",
                "Websites published on sites.korvasuite.com belong to the businesses that create them. Each is responsible for its content, prices and sales; KORVA only provides the tool.",
              )}
            </p>
          ),
        },
        {
          title: t("Propriété intellectuelle", "Intellectual property"),
          body: (
            <p>
              {t(
                `Le logiciel KORVA OS, sa marque et ses contenus appartiennent à ${company}. Les contenus ajoutés par les entreprises (textes, photos, catalogues) restent leur propriété.`,
                `The KORVA OS software, its brand and its content belong to ${company}. Content added by businesses (texts, photos, catalogues) remains theirs.`,
              )}
            </p>
          ),
        },
        {
          title: t("Autres textes", "Other texts"),
          body: (
            <ul className="list-disc space-y-1 pl-6">
              <li>{link("terms")}</li>
              <li>{link("refunds")}</li>
              <li>{link("privacy")}</li>
              <li>
                <Link href={ONLINE_PAYMENT_TERMS_PATH[locale]} className="underline underline-offset-4">
                  {t("Conditions du paiement en ligne", "Online payment terms")}
                </Link>
              </li>
            </ul>
          ),
        },
      ];

    case "contact":
      return [
        {
          title: t("Nous écrire ou nous appeler", "Write to us or call us"),
          body: (
            <>
              <p>
                {t(
                  "Une question sur votre compte, une facture, un paiement ou un remboursement : écrivez-nous ou envoyez un message WhatsApp. Une personne vous répond, en français ou en anglais.",
                  "A question about your account, an invoice, a payment or a refund: write to us or send a WhatsApp message. A person answers you, in French or English.",
                )}
              </p>
              <CompanyCard locale={locale} />
            </>
          ),
        },
        {
          title: t("Un achat sur le site d'une entreprise", "A purchase on a business's website"),
          body: (
            <p>
              {t(
                "Pour une commande, une réservation ou un remboursement sur le site d'une entreprise, contactez d'abord cette entreprise : ses coordonnées sont sur son site. Si elle ne vous répond pas, écrivez-nous en donnant le numéro de commande.",
                "For an order, a booking or a refund on a business's website, contact that business first: its details are on its site. If it does not answer, write to us with the order number.",
              )}
            </p>
          ),
        },
      ];

    case "terms":
      return [
        {
          title: t("1. Objet", "1. Purpose"),
          body: (
            <p>
              {t(
                `Ces conditions régissent l'utilisation de KORVA OS, logiciel de gestion en ligne (clients, ventes, rendez-vous, caisse, stock, site internet) vendu par abonnement aux entreprises, commerçants, indépendants et associations par ${company} (« KORVA »). Créer un compte vaut acceptation de ces conditions.`,
                `These terms govern the use of KORVA OS, online management software (customers, sales, appointments, till, stock, website) sold by subscription to businesses, shopkeepers, freelancers and associations by ${company} ("KORVA"). Creating an account means accepting these terms.`,
              )}
            </p>
          ),
        },
        {
          title: t("2. Compte", "2. Account"),
          body: (
            <ul className="list-disc space-y-1 pl-6">
              <li>{t("Vous donnez des informations exactes sur vous et votre entreprise.", "You give accurate information about yourself and your business.")}</li>
              <li>{t("Vous gardez votre mot de passe secret. Les personnes que vous invitez agissent sous votre responsabilité.", "You keep your password secret. People you invite act under your responsibility.")}</li>
              <li>{t("Vous utilisez KORVA pour une activité licite.", "You use KORVA for a lawful activity.")}</li>
            </ul>
          ),
        },
        {
          title: t("3. Formules et prix", "3. Plans and prices"),
          body: (
            <>
              <p>
                {t(
                  "KORVA propose une formule gratuite et des formules payantes (Starter, Pro, Business). Les prix sont affichés sur ",
                  "KORVA offers a free plan and paid plans (Starter, Pro, Business). Prices are shown on ",
                )}
                <Link href={en ? "/en#formules" : "/#formules"} className="underline underline-offset-4">
                  {t("la page des formules", "the plans page")}
                </Link>
                {t(
                  ", pays par pays, dans la devise du pays de votre entreprise. Le prix est celui affiché au moment du paiement.",
                  ", country by country, in the currency of your business's country. The price is the one shown when you pay.",
                )}
              </p>
              <p>
                {t(
                  `Pour une entreprise établie au Maroc, les prix s'entendent TVA de ${KORVA_VAT.rate} % comprise, détaillée sur chaque facture. Pour une entreprise établie hors du Maroc, l'abonnement est facturé sans TVA marocaine, au titre de l'exportation de services.`,
                  `For a business established in Morocco, prices include ${KORVA_VAT.rate}% VAT, shown on each invoice. For a business established outside Morocco, the subscription is invoiced without Moroccan VAT, as an export of services.`,
                )}
              </p>
              <p>
                {t(
                  `À l'inscription, vous pouvez essayer la formule ${SIGNUP_TRIAL.plan === "pro" ? "Pro" : SIGNUP_TRIAL.plan} gratuitement pendant ${SIGNUP_TRIAL.days} jours, sans carte bancaire. L'essai ne se transforme jamais en abonnement payant sans votre paiement.`,
                  `At signup you can try the ${SIGNUP_TRIAL.plan === "pro" ? "Pro" : SIGNUP_TRIAL.plan} plan free for ${SIGNUP_TRIAL.days} days, with no bank card. The trial never turns into a paid subscription without your payment.`,
                )}
              </p>
            </>
          ),
        },
        {
          title: t("4. Paiement de l'abonnement", "4. Paying the subscription"),
          body: (
            <ul className="list-disc space-y-1 pl-6">
              <li>
                {t(
                  "Un abonnement se paie d'avance, au choix pour 1 mois, 6 mois (10 % de remise) ou 1 an (deux mois offerts). Une formule payante s'ouvre dès que son paiement est reçu, pour la durée payée.",
                  "A subscription is paid in advance, for 1 month, 6 months (10% off) or 1 year (two months free), as you choose. A paid plan opens as soon as its payment is received, for the period paid.",
                )}
              </li>
              <li>
                {t(
                  "Vous payez par mobile money ou par carte bancaire, sur la page sécurisée de notre prestataire de paiement. KORVA ne voit ni ne conserve jamais votre numéro de carte.",
                  "You pay by mobile money or bank card, on our payment provider's secure page. KORVA never sees or stores your card number.",
                )}
              </li>
              <li>
                {t(
                  "À chaque nouvelle période, une facture est émise et reste disponible dans Paramètres > Abonnement.",
                  "For each new period an invoice is issued and stays available in Settings > Subscription.",
                )}
              </li>
              <li>
                {t(
                  "Une facture non payée 7 jours après son échéance met l'abonnement en retard de paiement ; KORVA peut alors suspendre les fonctions payantes jusqu'au paiement. Vos données ne sont pas supprimées pour un retard.",
                  "An invoice still unpaid 7 days after its due date puts the subscription in arrears; KORVA may then suspend paid features until payment. Your data is not deleted because of a late payment.",
                )}
              </li>
            </ul>
          ),
        },
        {
          title: t("5. Changer de formule ou résilier", "5. Changing plan or cancelling"),
          body: (
            <p>
              {t(
                "Vous changez de formule ou résiliez à tout moment, depuis Paramètres > Abonnement, sans frais. Les règles exactes, et les cas où nous remboursons, sont détaillés dans ",
                "You change plan or cancel at any time, from Settings > Subscription, at no cost. The exact rules, and when we refund, are set out in ",
              )}
              {link("refunds")}.
            </p>
          ),
        },
        {
          title: t("6. Paiement en ligne de vos clients", "6. Your customers' online payments"),
          body: (
            <p>
              {t(
                "Si vous activez le paiement en ligne sur votre site ou à votre caisse, il est régi par des conditions à part, que vous acceptez au moment de l'activer : ",
                "If you turn on online payment on your website or at your till, it is governed by separate terms that you accept when turning it on: ",
              )}
              <Link href={ONLINE_PAYMENT_TERMS_PATH[locale]} className="underline underline-offset-4">
                {t("Conditions du paiement en ligne", "Online payment terms")}
              </Link>
              {t(". Vous restez le vendeur auprès de vos clients.", ". You remain the seller towards your customers.")}
            </p>
          ),
        },
        {
          title: t("7. Vos données", "7. Your data"),
          body: (
            <p>
              {t(
                "Les données que vous saisissez (clients, ventes, catalogue) vous appartiennent. KORVA les traite pour vous fournir le service, comme expliqué dans la ",
                "The data you enter (customers, sales, catalogue) belongs to you. KORVA processes it to provide the service, as explained in the ",
              )}
              {link("privacy")}.
            </p>
          ),
        },
        {
          title: t("8. Disponibilité et responsabilité", "8. Availability and liability"),
          body: (
            <p>
              {t(
                "KORVA fait de son mieux pour que le service soit disponible et sauvegardé, sans pouvoir garantir l'absence de toute interruption. Sauf faute grave, la responsabilité de KORVA est limitée aux sommes que vous avez payées pour l'abonnement au cours des 12 derniers mois.",
                "KORVA does its best to keep the service available and backed up, without being able to guarantee there will never be an interruption. Except for gross negligence, KORVA's liability is limited to what you paid for the subscription over the last 12 months.",
              )}
            </p>
          ),
        },
        {
          title: t("9. Suspension", "9. Suspension"),
          body: (
            <p>
              {t(
                "KORVA peut suspendre un compte utilisé pour une activité illicite, une fraude ou en violation de ces conditions, après vous avoir prévenu sauf urgence.",
                "KORVA may suspend an account used for an unlawful activity, fraud or in breach of these terms, after warning you except in an emergency.",
              )}
            </p>
          ),
        },
        {
          title: t("10. Changements", "10. Changes"),
          body: (
            <p>
              {t(
                "Si ces conditions changent, vous êtes prévenu par e-mail au moins 15 jours avant. Un changement de prix ne s'applique qu'à la période suivante.",
                "If these terms change, you are told by e-mail at least 15 days in advance. A price change only applies from the next period.",
              )}
            </p>
          ),
        },
        {
          title: t("11. Droit applicable", "11. Governing law"),
          body: (
            <p>
              {t(
                "Ces conditions sont soumises au droit marocain. En cas de désaccord, nous cherchons d'abord une solution amiable ; à défaut, le tribunal de commerce de Casablanca est compétent.",
                "These terms are governed by Moroccan law. In a disagreement we first look for an amicable solution; failing that, the commercial court of Casablanca has jurisdiction.",
              )}
            </p>
          ),
        },
      ];

    case "refunds":
      return [
        {
          title: t("Résilier", "Cancelling"),
          body: (
            <ul className="list-disc space-y-1 pl-6">
              <li>
                {t(
                  "Vous résiliez à tout moment, sans frais ni préavis, dans Paramètres > Abonnement.",
                  "You cancel at any time, with no fee or notice, in Settings > Subscription.",
                )}
              </li>
              <li>
                {t(
                  "La résiliation prend effet à la fin de la période déjà payée (1 mois, 6 mois ou 1 an) : vous gardez votre formule jusque-là, et vous pouvez revenir sur votre décision avant cette date.",
                  "Cancellation takes effect at the end of the period already paid (1 month, 6 months or 1 year): you keep your plan until then, and you can change your mind before that date.",
                )}
              </li>
              <li>
                {t(
                  "Après la résiliation, vos données ne sont pas supprimées : vous pouvez reprendre une formule à tout moment. Pour faire supprimer définitivement votre compte, écrivez-nous.",
                  "After cancellation your data is not deleted: you can take a plan again at any time. To have your account permanently deleted, write to us.",
                )}
              </li>
            </ul>
          ),
        },
        {
          title: t("Remboursements de l'abonnement", "Subscription refunds"),
          body: (
            <>
              <p>
                {t(
                  "Une période commencée n'est pas remboursée, même en partie, puisque vous gardez l'accès jusqu'à sa fin. C'est aussi vrai pour une période de 6 mois ou d'un an : il n'y a pas de remboursement au prorata des mois restants. L'essai gratuit permet de tout essayer avant de payer.",
                  "A period that has started is not refunded, even partly, since you keep access until it ends. This also applies to a 6-month or yearly period: there is no pro rata refund of the remaining months. The free trial lets you try everything before paying.",
                )}
              </p>
              <p>{t("Nous remboursons en revanche :", "We do refund:")}</p>
              <ul className="list-disc space-y-1 pl-6">
                <li>{t("un paiement en double ou une erreur de facturation de notre part ;", "a duplicate payment or a billing error on our side;")}</li>
                <li>
                  {t(
                    "une période payée pendant laquelle le service a été indisponible pendant une longue durée par notre faute, au prorata des jours perdus.",
                    "a paid period during which the service was unavailable for a long time through our fault, in proportion to the days lost.",
                  )}
                </li>
              </ul>
              <p>
                {t(
                  "En passant à une formule supérieure ou à une durée plus longue en cours de période, ce qui reste de votre période déjà payée est déduit du prix de la nouvelle. Une période de 6 mois ou d'un an déjà payée ne peut pas être échangée contre une formule moins chère avant sa fin : vous la gardez jusqu'au bout, puis vous choisissez.",
                  "When you move to a higher plan or a longer period mid-period, what remains of the period you already paid is deducted from the new price. A 6-month or yearly period already paid cannot be swapped for a cheaper plan before it ends: you keep it to the end, then choose.",
                )}
              </p>
            </>
          ),
        },
        {
          title: t("Demander un remboursement", "Asking for a refund"),
          body: (
            <p>
              {t("Écrivez à ", "Write to ")}
              <Mail />
              {t(
                " avec le numéro de la facture. Nous répondons sous 5 jours ouvrés. Un remboursement accordé est renvoyé sur le moyen de paiement d'origine (numéro mobile money ou carte), sous 14 jours.",
                " with the invoice number. We answer within 5 working days. An approved refund is sent back to the original means of payment (mobile money number or card) within 14 days.",
              )}
            </p>
          ),
        },
        {
          title: t("Achats sur le site d'une entreprise", "Purchases on a business's website"),
          body: (
            <p>
              {t(
                "Un achat fait sur le site d'une entreprise utilisant KORVA est un achat auprès de cette entreprise : c'est elle qui décide d'un remboursement, selon ses propres conditions. Les règles qui s'appliquent entre l'entreprise et KORVA sont dans les ",
                "A purchase made on the website of a business using KORVA is a purchase from that business: it decides on a refund, under its own terms. The rules between the business and KORVA are in the ",
              )}
              <Link href={ONLINE_PAYMENT_TERMS_PATH[locale]} className="underline underline-offset-4">
                {t("Conditions du paiement en ligne", "Online payment terms")}
              </Link>
              .
            </p>
          ),
        },
      ];

    case "privacy":
      return [
        {
          title: t("Qui est responsable", "Who is responsible"),
          body: (
            <p>
              {t(
                `${company} (Casablanca, Maroc) est responsable des données des comptes KORVA. Pour les données que les entreprises enregistrent sur leurs propres clients, KORVA agit pour le compte de chaque entreprise, qui en reste responsable. Les données sont traitées conformément à la loi marocaine n° 09-08 sur la protection des données personnelles.`,
                `${company} (Casablanca, Morocco) is responsible for the data of KORVA accounts. For the data businesses record about their own customers, KORVA acts on behalf of each business, which remains responsible for it. Data is processed under Moroccan law no. 09-08 on the protection of personal data.`,
              )}
            </p>
          ),
        },
        {
          title: t("Ce que nous collectons", "What we collect"),
          body: (
            <ul className="list-disc space-y-1 pl-6">
              <li>{t("Votre compte : nom, e-mail, téléphone, mot de passe (chiffré), entreprise, pays.", "Your account: name, e-mail, phone, password (hashed), business, country.")}</li>
              <li>{t("Ce que vous saisissez dans KORVA : clients, ventes, factures, rendez-vous, catalogue.", "What you enter in KORVA: customers, sales, invoices, appointments, catalogue.")}</li>
              <li>{t("Les paiements : montant, date, statut, moyen. Jamais votre numéro de carte, qui reste chez le prestataire de paiement.", "Payments: amount, date, status, method. Never your card number, which stays with the payment provider.")}</li>
              <li>{t("Les journaux techniques et les erreurs, pour faire fonctionner et sécuriser le service.", "Technical logs and errors, to run and secure the service.")}</li>
            </ul>
          ),
        },
        {
          title: t("Pourquoi", "Why"),
          body: (
            <p>
              {t(
                "Pour vous fournir le service, vous facturer, vous envoyer les e-mails utiles (confirmation, factures, alertes), vous aider quand vous nous écrivez, et protéger le service contre la fraude. Nous ne vendons jamais vos données.",
                "To provide the service, bill you, send you useful e-mails (confirmations, invoices, alerts), help you when you write to us, and protect the service against fraud. We never sell your data.",
              )}
            </p>
          ),
        },
        {
          title: t("Avec qui nous travaillons", "Who we work with"),
          body: (
            <>
              <p>
                {t(
                  "Ces prestataires traitent des données pour nous, seulement pour ce service. Certains sont hors du Maroc :",
                  "These providers process data for us, only for this service. Some are outside Morocco:",
                )}
              </p>
              <ul className="list-disc space-y-1 pl-6">
                <li>{t("Contabo GmbH (Allemagne) : serveurs ;", "Contabo GmbH (Germany): servers;")}</li>
                <li>{t("MongoDB, Inc. (États-Unis) : base de données MongoDB Atlas ;", "MongoDB, Inc. (United States): MongoDB Atlas database;")}</li>
                <li>{t("Resend (États-Unis) : envoi des e-mails ;", "Resend (United States): sending e-mails;")}</li>
                <li>{t("Sentry (États-Unis) : détection des erreurs ;", "Sentry (United States): error detection;")}</li>
                <li>{t("Google : l'assistant KORVA IA (Gemini), quand vous l'utilisez ;", "Google: the KORVA AI assistant (Gemini), when you use it;")}</li>
                <li>{t("nos prestataires de paiement, pour les paiements que vous faites ou recevez.", "our payment providers, for the payments you make or receive.")}</li>
              </ul>
            </>
          ),
        },
        {
          title: t("Cookies", "Cookies"),
          body: (
            <p>
              {t(
                "KORVA utilise les cookies nécessaires à la connexion. La mesure d'audience et la publicité de Google ne se chargent qu'après votre accord, que vous pouvez retirer à tout moment par le lien « Cookies » en bas de page.",
                "KORVA uses the cookies needed to sign in. Google's audience measurement and advertising only load after your consent, which you can withdraw at any time through the \"Cookies\" link at the bottom of the page.",
              )}
            </p>
          ),
        },
        {
          title: t("Combien de temps", "How long"),
          body: (
            <p>
              {t(
                "Tant que votre compte existe. Après une demande de suppression, les données sont effacées sous 30 jours, sauf les factures, que la loi nous oblige à garder 10 ans.",
                "As long as your account exists. After a deletion request, data is erased within 30 days, except invoices, which the law requires us to keep for 10 years.",
              )}
            </p>
          ),
        },
        {
          title: t("Vos droits", "Your rights"),
          body: (
            <p>
              {t("Vous pouvez demander à voir, corriger ou supprimer vos données, ou vous opposer à un traitement, en écrivant à ", "You can ask to see, correct or delete your data, or object to processing, by writing to ")}
              <Mail />
              {t(
                ". Vous pouvez aussi saisir la Commission nationale de contrôle de la protection des données à caractère personnel (CNDP).",
                ". You may also contact Morocco's data protection authority, the CNDP.",
              )}
            </p>
          ),
        },
      ];
  }
}

/** One of KORVA's legal pages, in French or English. */
export function LegalPageView({ page, locale }: { page: LegalPage; locale: Locale }) {
  const en = locale === "en";
  const version = new Date(`${LEGAL_PAGES_VERSION}T12:00:00Z`).toLocaleDateString(en ? "en-GB" : "fr-FR", {
    dateStyle: "long",
  });
  return (
    <div className="bg-paper text-ink" lang={locale}>
      <PublicHeader locale={locale} otherLanguageHref={LEGAL_PATHS[page][en ? "fr" : "en"]} />
      {/* The pricing page holds four plan cards side by side: it needs the landing's width. */}
      <main className={`mx-auto ${page === "pricing" ? "max-w-6xl" : "max-w-3xl"} space-y-8 px-4 py-12 sm:px-8`}>
        <header className="space-y-2">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">{LEGAL_TITLES[page][locale]}</h1>
          {page !== "contact" && page !== "about" && page !== "pricing" && (
            <p className="text-sm text-ink-soft">{en ? `Version of ${version}` : `Version du ${version}`}</p>
          )}
        </header>
        {sectionsFor(page, locale).map((section) => (
          <section key={section.title} className="space-y-3 leading-relaxed">
            <h2 className="font-display text-xl font-semibold">{section.title}</h2>
            {section.body}
          </section>
        ))}
        <p className="text-sm text-ink-soft">
          KORVA OS · {en ? "a product of" : "un produit de"}{" "}
          <a href={PUBLISHER.url} className="underline underline-offset-4">
            {PUBLISHER.name}
          </a>
        </p>
      </main>
      <PublicFooter locale={locale} />
    </div>
  );
}
