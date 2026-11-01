import { VERTICAL_TEMPLATES, type VerticalTemplate } from "@korva/types";

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
}

const PAGES: Record<string, Omit<SeoTrade, "template">> = {
  beauty_wellness: {
    slug: "salon-de-coiffure-beaute",
    heading: "Logiciel de gestion pour salon de coiffure et institut de beauté",
    audience: "les salons de coiffure, instituts de beauté et spas",
    scene: "Les rendez-vous se prennent sur WhatsApp, le cahier déborde et les clientes oublient leur heure.",
  },
  restaurant: {
    slug: "restaurant-maquis",
    heading: "Logiciel de gestion pour restaurant, maquis et traiteur",
    audience: "les restaurants, maquis, traiteurs et fast-foods",
    scene: "Les commandes arrivent par téléphone, la cuisine attend le papier et la caisse se compte le soir.",
  },
  professional_services: {
    slug: "cabinet-conseil-services",
    heading: "Logiciel de devis, factures et clients pour cabinets et prestataires",
    audience: "les cabinets de conseil, comptables, juristes et prestataires",
    scene: "Les devis partent en Word, les factures se relancent à la main et le temps passé n'est pas suivi.",
  },
  training: {
    slug: "centre-de-formation",
    heading: "Logiciel de gestion pour centre de formation et école",
    audience: "les centres de formation, écoles privées, coachs et formateurs",
    scene: "Les inscriptions se notent sur papier, les paiements arrivent en plusieurs fois et les attestations se font une à une.",
  },
  commerce: {
    slug: "boutique-commerce",
    heading: "Logiciel de caisse, stock et boutique en ligne pour commerçants",
    audience: "les boutiques, commerces et vendeurs en ligne",
    scene: "Le stock se compte à la main, les commandes WhatsApp se perdent et le chiffre du jour reste flou.",
  },
  health_practice: {
    slug: "cabinet-de-sante",
    heading: "Logiciel de rendez-vous pour cabinet de santé et praticiens",
    audience: "les cabinets de kinésithérapie, d'ostéopathie, de nutrition et les praticiens",
    scene: "Le secrétariat passe la journée au téléphone et les rendez-vous manqués ne sont jamais remplacés.",
  },
  trades_construction: {
    slug: "artisan-btp",
    heading: "Logiciel de devis et factures pour artisans et entreprises du BTP",
    audience: "les artisans, plombiers, électriciens et entreprises du bâtiment",
    scene: "Les devis s'écrivent le soir, les acomptes se perdent et les chantiers se suivent de tête.",
  },
  real_estate: {
    slug: "agence-immobiliere",
    heading: "Logiciel pour agence immobilière : biens, prospects et visites",
    audience: "les agences immobilières, gestionnaires de biens et promoteurs",
    scene: "Les annonces sont éparpillées, les prospects arrivent de partout et les visites se calent par messages.",
  },
  hospitality: {
    slug: "hotel-residence",
    heading: "Logiciel de réservation pour hôtel, résidence et maison d'hôtes",
    audience: "les hôtels, résidences meublées, maisons d'hôtes et gîtes",
    scene: "Les réservations arrivent par téléphone, le planning des chambres tient sur un tableau et les acomptes se suivent mal.",
  },
  fashion_retail: {
    slug: "boutique-de-mode",
    heading: "Logiciel de boutique en ligne et de caisse pour la mode",
    audience: "les boutiques de mode, couturiers, créateurs et vendeurs de pagnes",
    scene: "Les tailles et couleurs se mélangent dans le stock et les clientes commandent par messages vocaux.",
  },
  food_retail: {
    slug: "epicerie-alimentation",
    heading: "Logiciel de caisse et de stock pour épicerie et commerce alimentaire",
    audience: "les épiceries, supérettes, boulangeries et commerces alimentaires",
    scene: "Les ruptures se découvrent trop tard et les ventes du jour se comptent à la fermeture.",
  },
  fitness_sport: {
    slug: "salle-de-sport",
    heading: "Logiciel de gestion pour salle de sport et coach",
    audience: "les salles de sport, studios de danse et de yoga, et les coachs",
    scene: "Les abonnements expirent sans relance et les cours se remplissent par groupes WhatsApp.",
  },
  digital_agency: {
    slug: "agence-digitale",
    heading: "Logiciel de devis, projets et factures pour agence digitale",
    audience: "les agences web, studios de communication et freelances",
    scene: "Chaque projet vit dans un fil de messages et la facturation suit avec des semaines de retard.",
  },
  events_creative: {
    slug: "evenementiel",
    heading: "Logiciel de gestion pour l'événementiel, la photo et la décoration",
    audience: "les organisateurs d'événements, photographes, décorateurs et traiteurs de fête",
    scene: "Les dates se réservent oralement et les acomptes se négocient au cas par cas.",
  },
  nonprofit_association: {
    slug: "association-ong",
    heading: "Logiciel de gestion pour association et ONG : membres, adhésions et dons",
    audience: "les associations, ONG, clubs et amicales",
    scene: "Les cotisations se notent dans un cahier et personne ne sait qui est à jour.",
  },
  childcare_personal_services: {
    slug: "services-a-la-personne",
    heading: "Logiciel de gestion pour crèche et services à la personne",
    audience: "les crèches, garderies, aides à domicile et services aux familles",
    scene: "Les plannings changent chaque semaine et les paiements des familles se suivent à la main.",
  },
  agriculture_direct_sale: {
    slug: "agriculture-vente-directe",
    heading: "Logiciel de vente directe pour producteurs et coopératives agricoles",
    audience: "les producteurs, maraîchers, éleveurs et coopératives",
    scene: "Les commandes de la semaine arrivent par téléphone et les livraisons se calent sur un bout de papier.",
  },
};

export const SEO_TRADES: SeoTrade[] = VERTICAL_TEMPLATES.flatMap((template) => {
  const page = PAGES[template.key];
  return page ? [{ ...page, template }] : [];
});

export function seoTradeBySlug(slug: string): SeoTrade | undefined {
  return SEO_TRADES.find((trade) => trade.slug === slug);
}
