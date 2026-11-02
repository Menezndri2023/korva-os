import type { Locale } from "@korva/types";

/**
 * KORVA's advice articles ("Conseils" / "Guides"): practical answers to what small business
 * owners actually search for, each ending on what KORVA does about it. Written here rather than in
 * a CMS — no tool to pay for, and every article ships as a static page Google and AI assistants
 * can read. To publish one, add it to ARTICLES with both languages.
 *
 * Only claim what KORVA really does today: these pages are read as facts.
 */
export type ArticleBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "ul"; items: string[] };

interface ArticleText {
  slug: string;
  title: string;
  description: string;
  body: ArticleBlock[];
}

export interface Article {
  /** ISO date of publication, shown and given to search engines. */
  published: string;
  fr: ArticleText;
  en: ArticleText;
}

export const ARTICLES: Article[] = [
  {
    published: "2026-11-02",
    fr: {
      slug: "encaisser-wave-orange-money-boutique",
      title: "Encaisser par Wave, Orange Money ou carte dans sa boutique, sans terminal",
      description:
        "Comment accepter le mobile money et la carte au comptoir avec un simple QR code, sans terminal de paiement, et retrouver chaque encaissement le soir.",
      body: [
        {
          type: "p",
          text: "Vos clients ont de moins en moins d'espèces sur eux. Ils ont Wave, Orange Money, MTN ou Moov dans leur téléphone, parfois une carte bancaire. Le problème, au comptoir, c'est de savoir si l'argent est vraiment arrivé, et de s'y retrouver le soir entre les espèces, les transferts et les captures d'écran.",
        },
        { type: "h2", text: "Ce qui pose problème avec les transferts « au numéro »" },
        {
          type: "ul",
          items: [
            "Le client envoie sur votre numéro personnel : impossible de distinguer les ventes de vos dépenses.",
            "Il faut vérifier chaque SMS de confirmation, souvent pendant qu'une file d'attente se forme.",
            "Le soir, rien ne relie un transfert à la vente qu'il paie : la caisse ne tombe jamais juste.",
          ],
        },
        { type: "h2", text: "La solution : un QR code par vente" },
        {
          type: "p",
          text: "Vous tapez le montant, l'écran affiche un QR code. Le client le scanne avec son téléphone et paie avec le moyen de son choix : Wave, Orange Money, MTN, Moov ou carte. L'écran passe à « Payé » tout seul quand le paiement est confirmé. Pas de terminal à acheter, un téléphone ou une tablette suffit.",
        },
        { type: "h2", text: "Ce que fait KORVA" },
        {
          type: "ul",
          items: [
            "La Caisse KORVA crée le QR code et une facture pour chaque vente, même sans fiche client.",
            "L'argent arrive dans votre Solde KORVA ; vous le retirez sur votre numéro mobile money quand vous voulez, ou automatiquement.",
            "Le soir, la caisse du jour montre ce qui a été encaissé, par moyen de paiement et par employé, et vous la fermez en comptant le tiroir (formule Pro).",
          ],
        },
        {
          type: "p",
          text: "La caisse par QR code est disponible dès la formule Gratuite : vous ne payez qu'une commission sur les ventes encaissées en ligne.",
        },
      ],
    },
    en: {
      slug: "accept-mobile-money-card-payments-shop",
      title: "Accept mobile money and card payments in your shop, without a card terminal",
      description:
        "How to take mobile money and card payments at the counter with a simple QR code, with no payment terminal, and find every payment again at the end of the day.",
      body: [
        {
          type: "p",
          text: "Your customers carry less and less cash. They have Wave, Orange Money, MTN or Moov on their phone, sometimes a bank card. The problem at the counter is knowing whether the money really arrived, and making sense of cash, transfers and screenshots at the end of the day.",
        },
        { type: "h2", text: "What goes wrong with transfers to your number" },
        {
          type: "ul",
          items: [
            "The customer sends money to your personal number: sales and personal spending get mixed up.",
            "Every confirmation text has to be checked, often while a queue builds up.",
            "At night, nothing links a transfer to the sale it pays for: the till never balances.",
          ],
        },
        { type: "h2", text: "The solution: one QR code per sale" },
        {
          type: "p",
          text: "You type the amount and the screen shows a QR code. The customer scans it with their phone and pays the way they like: Wave, Orange Money, MTN, Moov or card. The screen turns to “Paid” by itself once the payment is confirmed. No terminal to buy — a phone or a tablet is enough.",
        },
        { type: "h2", text: "What KORVA does" },
        {
          type: "ul",
          items: [
            "The KORVA till creates the QR code and an invoice for every sale, even without a customer record.",
            "The money arrives in your KORVA balance; withdraw it to your mobile money number whenever you like, or automatically.",
            "At the end of the day, today's till shows what was taken, by payment method and by employee, and you close it by counting the drawer (Pro plan).",
          ],
        },
        {
          type: "p",
          text: "QR code payments are available from the Free plan: you only pay a commission on sales taken online.",
        },
      ],
    },
  },
  {
    published: "2026-11-02",
    fr: {
      slug: "reduire-rendez-vous-manques-salon",
      title: "Réduire les rendez-vous manqués dans un salon de coiffure ou de beauté",
      description:
        "Les rendez-vous oubliés coûtent cher à un salon. Rappels, réservation en ligne et suivi des absences : les gestes qui remplissent vraiment l'agenda.",
      body: [
        {
          type: "p",
          text: "Un client qui ne vient pas, c'est un créneau perdu qu'on ne revend pas, et une coiffeuse payée à attendre. Dans la plupart des salons, ce n'est pas de la mauvaise volonté : le client a simplement oublié.",
        },
        { type: "h2", text: "Pourquoi les clients oublient" },
        {
          type: "ul",
          items: [
            "Le rendez-vous a été pris par téléphone ou sur WhatsApp, il n'est noté nulle part chez le client.",
            "Il a été pris longtemps à l'avance.",
            "Personne n'a le temps d'appeler chaque client la veille.",
          ],
        },
        { type: "h2", text: "Les trois gestes qui changent tout" },
        {
          type: "ul",
          items: [
            "Un rappel automatique la veille, par WhatsApp de préférence : c'est le message que le client lit vraiment.",
            "La réservation en ligne : le client choisit lui-même un créneau libre, il s'en souvient mieux.",
            "Le suivi des absences : marquer « présent » ou « absent » permet de repérer les habitués des oublis.",
          ],
        },
        { type: "h2", text: "Ce que fait KORVA" },
        {
          type: "ul",
          items: [
            "Votre site KORVA prend les rendez-vous en ligne, sur les vrais créneaux de chaque membre de l'équipe.",
            "Un rappel part automatiquement environ 24 heures avant le rendez-vous, par WhatsApp ou, à défaut, par e-mail.",
            "Chaque rendez-vous se marque présent ou absent, et une place libérée par une annulation prévient le premier client de la liste d'attente.",
          ],
        },
        {
          type: "p",
          text: "L'agenda en ligne et les rappels sont inclus dès la formule Gratuite.",
        },
      ],
    },
    en: {
      slug: "reduce-no-shows-hair-beauty-salon",
      title: "Reduce missed appointments in a hair or beauty salon",
      description:
        "Forgotten appointments are expensive for a salon. Reminders, online booking and tracking no-shows: the habits that really fill the diary.",
      body: [
        {
          type: "p",
          text: "A customer who does not turn up is a slot you cannot sell again, and a stylist paid to wait. In most salons it is not ill will: the customer simply forgot.",
        },
        { type: "h2", text: "Why customers forget" },
        {
          type: "ul",
          items: [
            "The appointment was made by phone or on WhatsApp and is written down nowhere on the customer's side.",
            "It was made a long time in advance.",
            "Nobody has time to call every customer the day before.",
          ],
        },
        { type: "h2", text: "The three habits that change everything" },
        {
          type: "ul",
          items: [
            "An automatic reminder the day before, ideally on WhatsApp: it is the message customers actually read.",
            "Online booking: customers who pick a free slot themselves remember it better.",
            "Tracking no-shows: marking “attended” or “no-show” shows you who tends to forget.",
          ],
        },
        { type: "h2", text: "What KORVA does" },
        {
          type: "ul",
          items: [
            "Your KORVA website takes bookings online, on each team member's real free slots.",
            "A reminder goes out automatically about 24 hours before the appointment, on WhatsApp or otherwise by e-mail.",
            "Each appointment can be marked attended or no-show, and a slot freed by a cancellation alerts the first customer on the waiting list.",
          ],
        },
        {
          type: "p",
          text: "Online booking and reminders are included from the Free plan.",
        },
      ],
    },
  },
  {
    published: "2026-11-02",
    fr: {
      slug: "faire-devis-professionnel-rapidement",
      title: "Faire un devis professionnel en quelques minutes, et le faire signer",
      description:
        "Artisans, agences, prestataires : comment envoyer un devis clair, le faire accepter en ligne et le transformer en facture sans tout retaper.",
      body: [
        {
          type: "p",
          text: "Un devis envoyé tard, c'est souvent un client qui a déjà dit oui à quelqu'un d'autre. Et un devis écrit à la main ou dans un message WhatsApp inspire moins confiance qu'un document propre, numéroté, avec les montants clairs.",
        },
        { type: "h2", text: "Ce qu'un bon devis contient" },
        {
          type: "ul",
          items: [
            "Vos coordonnées et celles du client.",
            "Chaque prestation ou fourniture sur sa ligne, avec quantité et prix unitaire.",
            "Le sous-total, la TVA si vous y êtes soumis, et le total.",
            "Une date de validité : au-delà, les prix peuvent changer.",
          ],
        },
        { type: "h2", text: "Faire accepter le devis sans aller-retour" },
        {
          type: "p",
          text: "Le plus long n'est pas d'écrire le devis, c'est d'obtenir la réponse. Un devis que le client peut accepter en ligne, depuis son téléphone, se signe le jour même au lieu d'attendre un rendez-vous.",
        },
        { type: "h2", text: "Ce que fait KORVA" },
        {
          type: "ul",
          items: [
            "Dès la formule Starter, vous créez le devis à partir de votre catalogue de prestations ; il est numéroté et disponible en PDF.",
            "Le client le consulte et le signe en ligne depuis son espace client, en tapant son nom.",
            "Un devis accepté se convertit en facture en un clic, sans rien retaper ; les factures impayées peuvent être relancées automatiquement par WhatsApp ou e-mail (formule Pro).",
          ],
        },
      ],
    },
    en: {
      slug: "make-professional-quote-fast",
      title: "Make a professional quote in minutes, and get it signed",
      description:
        "Tradespeople, agencies, service providers: how to send a clear quote, get it accepted online and turn it into an invoice without typing it all again.",
      body: [
        {
          type: "p",
          text: "A quote sent late is often a customer who has already said yes to someone else. And a handwritten quote, or one in a WhatsApp message, inspires less trust than a clean, numbered document with clear amounts.",
        },
        { type: "h2", text: "What a good quote contains" },
        {
          type: "ul",
          items: [
            "Your details and the customer's.",
            "Each service or supply on its own line, with quantity and unit price.",
            "The subtotal, VAT if you charge it, and the total.",
            "A validity date: after it, prices may change.",
          ],
        },
        { type: "h2", text: "Get the quote accepted without back and forth" },
        {
          type: "p",
          text: "Writing the quote is not the slow part — getting the answer is. A quote the customer can accept online, from their phone, gets signed the same day instead of waiting for a meeting.",
        },
        { type: "h2", text: "What KORVA does" },
        {
          type: "ul",
          items: [
            "From the Starter plan, you build the quote from your catalogue of services; it is numbered and available as a PDF.",
            "The customer reads and signs it online from their customer area, by typing their name.",
            "An accepted quote becomes an invoice in one click, with nothing to type again; unpaid invoices can be chased automatically on WhatsApp or by e-mail (Pro plan).",
          ],
        },
      ],
    },
  },
];

export function articleBySlug(slug: string, locale: Locale): Article | undefined {
  return ARTICLES.find((article) => article[locale].slug === slug);
}

/** /conseils/<slug> in French, /en/guides/<slug> in English. */
export function articlePath(article: Article, locale: Locale): string {
  return locale === "en" ? `/en/guides/${article.en.slug}` : `/conseils/${article.fr.slug}`;
}

export function articlesIndexPath(locale: Locale): string {
  return locale === "en" ? "/en/guides" : "/conseils";
}
