import { VERTICAL_TEMPLATES, type Locale, type VerticalTemplate } from "@korva/types";

/**
 * The public page of each trade (/metiers/<slug>): the words people actually type in a search
 * engine or ask an assistant ("logiciel de gestion pour salon de coiffure"), mapped onto the
 * trades KORVA already configures (VERTICAL_TEMPLATES). Slugs are French and stable: changing one
 * loses its search ranking.
 */
export interface SeoTrade {
  slug: string;
  template: VerticalTemplate;
  /** The page's H1 and the heart of its title. */
  heading: string;
  /** Who it is for, in the plural, for running text ("les salons de coiffure"). */
  audience: string;
  /** A real situation of the trade, for the page's opening. */
  scene: string;
  /** The same page in English, at /en/trades/<en.slug>. */
  en: { slug: string; heading: string; audience: string; scene: string };
}

/** A trade page's words in a language. */
export function tradeWords(trade: SeoTrade, locale: Locale) {
  return locale === "en"
    ? trade.en
    : { slug: trade.slug, heading: trade.heading, audience: trade.audience, scene: trade.scene };
}

export function tradePath(trade: SeoTrade, locale: Locale): string {
  return locale === "en" ? `/en/trades/${trade.en.slug}` : `/metiers/${trade.slug}`;
}

const PAGES: Record<string, Omit<SeoTrade, "template">> = {
  beauty_wellness: {
    slug: "salon-de-coiffure-beaute",
    heading: "Logiciel de gestion pour salon de coiffure et institut de beauté",
    audience: "les salons de coiffure, instituts de beauté et spas",
    scene: "Les rendez-vous se prennent sur WhatsApp, le cahier déborde et les clientes oublient leur heure.",
    en: {
      slug: "hair-beauty-salon",
      heading: "Management software for hair salons and beauty institutes",
      audience: "hair salons, beauty institutes and spas",
      scene: "Appointments are made on WhatsApp, the book overflows and clients forget their time slot.",
    },
  },
  restaurant: {
    slug: "restaurant-maquis",
    heading: "Logiciel de gestion pour restaurant, maquis et traiteur",
    audience: "les restaurants, maquis, traiteurs et fast-foods",
    scene: "Les commandes arrivent par téléphone, la cuisine attend le papier et la caisse se compte le soir.",
    en: {
      slug: "restaurant",
      heading: "Management software for restaurants, eateries and caterers",
      audience: "restaurants, eateries, caterers and fast-food outlets",
      scene: "Orders come in by phone, the kitchen waits for the paper and the till is counted at night.",
    },
  },
  professional_services: {
    slug: "cabinet-conseil-services",
    heading: "Logiciel de devis, factures et clients pour cabinets et prestataires",
    audience: "les cabinets de conseil, comptables, juristes et prestataires",
    scene: "Les devis partent en Word, les factures se relancent à la main et le temps passé n'est pas suivi.",
    en: {
      slug: "consulting-services",
      heading: "Quotes, invoices and clients software for firms and service providers",
      audience: "consulting firms, accountants, lawyers and service providers",
      scene: "Quotes go out in Word, invoices are chased by hand and time spent is never tracked.",
    },
  },
  training: {
    slug: "centre-de-formation",
    heading: "Logiciel de gestion pour centre de formation et école",
    audience: "les centres de formation, écoles privées, coachs et formateurs",
    scene: "Les inscriptions se notent sur papier, les paiements arrivent en plusieurs fois et les attestations se font une à une.",
    en: {
      slug: "training-centre",
      heading: "Management software for training centres and schools",
      audience: "training centres, private schools, coaches and trainers",
      scene: "Enrolments are written on paper, payments arrive in instalments and certificates are made one by one.",
    },
  },
  commerce: {
    slug: "boutique-commerce",
    heading: "Logiciel de caisse, stock et boutique en ligne pour commerçants",
    audience: "les boutiques, commerces et vendeurs en ligne",
    scene: "Le stock se compte à la main, les commandes WhatsApp se perdent et le chiffre du jour reste flou.",
    en: {
      slug: "shop-retail",
      heading: "Till, stock and online shop software for retailers",
      audience: "shops, retailers and online sellers",
      scene: "Stock is counted by hand, WhatsApp orders get lost and the day’s takings stay vague.",
    },
  },
  health_practice: {
    slug: "cabinet-de-sante",
    heading: "Logiciel de rendez-vous pour cabinet de santé et praticiens",
    audience: "les cabinets de kinésithérapie, d'ostéopathie, de nutrition et les praticiens",
    scene: "Le secrétariat passe la journée au téléphone et les rendez-vous manqués ne sont jamais remplacés.",
    en: {
      slug: "health-practice",
      heading: "Appointment software for health practices and practitioners",
      audience: "physiotherapy, osteopathy and nutrition practices and practitioners",
      scene: "The front desk spends the day on the phone and missed appointments are never refilled.",
    },
  },
  trades_construction: {
    slug: "artisan-btp",
    heading: "Logiciel de devis et factures pour artisans et entreprises du BTP",
    audience: "les artisans, plombiers, électriciens et entreprises du bâtiment",
    scene: "Les devis s'écrivent le soir, les acomptes se perdent et les chantiers se suivent de tête.",
    en: {
      slug: "trades-construction",
      heading: "Quote and invoice software for tradespeople and builders",
      audience: "tradespeople, plumbers, electricians and building firms",
      scene: "Quotes are written at night, deposits get lost and jobs are tracked from memory.",
    },
  },
  real_estate: {
    slug: "agence-immobiliere",
    heading: "Logiciel pour agence immobilière : biens, prospects et visites",
    audience: "les agences immobilières, gestionnaires de biens et promoteurs",
    scene: "Les annonces sont éparpillées, les prospects arrivent de partout et les visites se calent par messages.",
    en: {
      slug: "estate-agency",
      heading: "Software for estate agencies: properties, leads and viewings",
      audience: "estate agencies, property managers and developers",
      scene: "Listings are scattered, leads come from everywhere and viewings are arranged by message.",
    },
  },
  hospitality: {
    slug: "hotel-residence",
    heading: "Logiciel de réservation pour hôtel, résidence et maison d'hôtes",
    audience: "les hôtels, résidences meublées, maisons d'hôtes et gîtes",
    scene: "Les réservations arrivent par téléphone, le planning des chambres tient sur un tableau et les acomptes se suivent mal.",
    en: {
      slug: "hotel-guesthouse",
      heading: "Booking software for hotels, apartments and guesthouses",
      audience: "hotels, serviced apartments, guesthouses and B&Bs",
      scene: "Bookings arrive by phone, the room plan lives on a whiteboard and deposits are hard to track.",
    },
  },
  fashion_retail: {
    slug: "boutique-de-mode",
    heading: "Logiciel de boutique en ligne et de caisse pour la mode",
    audience: "les boutiques de mode, couturiers, créateurs et vendeurs de pagnes",
    scene: "Les tailles et couleurs se mélangent dans le stock et les clientes commandent par messages vocaux.",
    en: {
      slug: "fashion-boutique",
      heading: "Online shop and till software for fashion",
      audience: "fashion boutiques, tailors, designers and fabric sellers",
      scene: "Sizes and colours get mixed up in stock and customers order by voice note.",
    },
  },
  food_retail: {
    slug: "epicerie-alimentation",
    heading: "Logiciel de caisse et de stock pour épicerie et commerce alimentaire",
    audience: "les épiceries, supérettes, boulangeries et commerces alimentaires",
    scene: "Les ruptures se découvrent trop tard et les ventes du jour se comptent à la fermeture.",
    en: {
      slug: "grocery-food",
      heading: "Till and stock software for grocery and food shops",
      audience: "grocery stores, mini-markets, bakeries and food shops",
      scene: "Stock-outs are found too late and the day’s sales are counted at closing time.",
    },
  },
  fitness_sport: {
    slug: "salle-de-sport",
    heading: "Logiciel de gestion pour salle de sport et coach",
    audience: "les salles de sport, studios de danse et de yoga, et les coachs",
    scene: "Les abonnements expirent sans relance et les cours se remplissent par groupes WhatsApp.",
    en: {
      slug: "gym-fitness",
      heading: "Management software for gyms and personal trainers",
      audience: "gyms, dance and yoga studios, and personal trainers",
      scene: "Memberships lapse without a reminder and classes fill up through WhatsApp groups.",
    },
  },
  digital_agency: {
    slug: "agence-digitale",
    heading: "Logiciel de devis, projets et factures pour agence digitale",
    audience: "les agences web, studios de communication et freelances",
    scene: "Chaque projet vit dans un fil de messages et la facturation suit avec des semaines de retard.",
    en: {
      slug: "digital-agency",
      heading: "Quote, project and invoice software for digital agencies",
      audience: "web agencies, communication studios and freelancers",
      scene: "Every project lives in a message thread and invoicing lags weeks behind.",
    },
  },
  events_creative: {
    slug: "evenementiel",
    heading: "Logiciel de gestion pour l'événementiel, la photo et la décoration",
    audience: "les organisateurs d'événements, photographes, décorateurs et traiteurs de fête",
    scene: "Les dates se réservent oralement et les acomptes se négocient au cas par cas.",
    en: {
      slug: "events-photography",
      heading: "Management software for events, photography and decoration",
      audience: "event planners, photographers, decorators and party caterers",
      scene: "Dates are booked verbally and deposits are negotiated case by case.",
    },
  },
  nonprofit_association: {
    slug: "association-ong",
    heading: "Logiciel de gestion pour association et ONG : membres, adhésions et dons",
    audience: "les associations, ONG, clubs et amicales",
    scene: "Les cotisations se notent dans un cahier et personne ne sait qui est à jour.",
    en: {
      slug: "association-ngo",
      heading: "Management software for associations and NGOs: members, memberships and donations",
      audience: "associations, NGOs, clubs and societies",
      scene: "Dues are written in a notebook and nobody knows who is up to date.",
    },
  },
  childcare_personal_services: {
    slug: "services-a-la-personne",
    heading: "Logiciel de gestion pour crèche et services à la personne",
    audience: "les crèches, garderies, aides à domicile et services aux familles",
    scene: "Les plannings changent chaque semaine et les paiements des familles se suivent à la main.",
    en: {
      slug: "childcare-home-services",
      heading: "Management software for nurseries and home services",
      audience: "nurseries, childminders, home helps and family services",
      scene: "Schedules change every week and families’ payments are tracked by hand.",
    },
  },
  agriculture_direct_sale: {
    slug: "agriculture-vente-directe",
    heading: "Logiciel de vente directe pour producteurs et coopératives agricoles",
    audience: "les producteurs, maraîchers, éleveurs et coopératives",
    scene: "Les commandes de la semaine arrivent par téléphone et les livraisons se calent sur un bout de papier.",
    en: {
      slug: "farm-direct-sales",
      heading: "Direct sales software for farmers and cooperatives",
      audience: "farmers, market gardeners, livestock breeders and cooperatives",
      scene: "The week’s orders come by phone and deliveries are planned on a scrap of paper.",
    },
  },
};

export const SEO_TRADES: SeoTrade[] = VERTICAL_TEMPLATES.flatMap((template) => {
  const page = PAGES[template.key];
  return page ? [{ ...page, template }] : [];
});

export function seoTradeBySlug(slug: string, locale: Locale = "fr"): SeoTrade | undefined {
  return SEO_TRADES.find((trade) => (locale === "en" ? trade.en.slug : trade.slug) === slug);
}
