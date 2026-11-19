import type { OfferType } from "./catalog.ts";
import type { StorefrontTemplateKey } from "./storefront-themes.ts";

/**
 * The organization's TYPE OF ACTIVITY — what it sells and how, as opposed to its trade.
 *
 * Seventeen trades (VERTICAL_TEMPLATES) fold into these eight. The trade is good for suggestions
 * (offer names, wording, a starter workflow); the type of activity is what decides the product:
 * the kind of public site, the main sales channel, which offer types the catalogue proposes first,
 * and which trade-specific screens the dashboard shows. See docs/KORVA_OS_V3_STRUCTURE_PRODUIT.md
 * §2, validated 2026-10-19: "le métier décide QUOI, le plan décide COMBIEN".
 *
 * STORED, not inferred. Until this existed the trade was recovered by matching the free-text
 * `Organization.type` against `suggestedType` (verticalForOrganizationType), so an owner who
 * edited that text lost their trade without knowing it.
 *
 * Optional on Organization: an organization created before it, or whose trade could not be
 * recognised, keeps today's behaviour everywhere this is read.
 */
export const BUSINESS_MODELS = [
  "retail",
  "restaurant",
  "appointments",
  "lodging",
  "training",
  "quotes",
  "real_estate",
  "association",
] as const;
export type BusinessModel = (typeof BUSINESS_MODELS)[number];

/** How the business mainly sells — drives what its public site puts first. */
export type PrimaryChannel = "orders" | "bookings" | "quotes" | "leads";

export interface BusinessModelDefinition {
  key: BusinessModel;
  label: string;
  /** One line shown under the label when the owner picks it. */
  description: string;
  /** The kind of public site, as the owner would name it. */
  siteKind: string;
  primaryChannel: PrimaryChannel;
  /** Used when the trade itself names no template (an "Autre" trade, or one not recognised). */
  defaultStorefrontTemplate: StorefrontTemplateKey;
  /** Offer types proposed first in the catalogue, most likely first. Others stay available. */
  offerTypes: OfferType[];
  /** Trade-specific dashboard screens. Everything else follows enabled modules as before. */
  screens: { kitchen: boolean; training: boolean };
  /**
   * The sales tools this trade works with (TRADE_TOOLS). The others are hidden from its menu even
   * when their module is on — a salon has no use for "Retours" — and the owner can bring one back
   * from Settings › Autres outils (Organization.extraTools). Hiding never removes data or blocks
   * the API: it is the menu, not a permission.
   */
  tools: readonly TradeTool[];
  /** The trade's own words for the shared screens. */
  vocabulary: TradeVocabulary;
  /** Sells goods it keeps in stock: shows warehouses, suppliers and purchase orders in the
   *  catalogue. A salon or a consultancy has none of them. */
  stock: boolean;
}

/**
 * Menu entries a trade may not need. Everything else in the menu (clients, cash desk, Solde,
 * statistics, marketing, KORVA IA…) is useful to every trade and only follows its module.
 */
export const TRADE_TOOLS = ["orders", "returns", "bookings"] as const;
export type TradeTool = (typeof TRADE_TOOLS)[number];

export const TRADE_TOOL_LABELS: Record<TradeTool, string> = {
  orders: "Commandes",
  returns: "Retours",
  bookings: "Réservations",
};

export interface TradeVocabulary {
  /** The catalogue: "Produits", "Menu", "Prestations"… */
  catalog: string;
  /** The bookings screen: "Rendez-vous", "Réservations de table", "Visites"… */
  bookings: string;
  /** The CRM: "Clients", "Prospects et clients", "Membres". */
  crm: string;
}

/** Wording for an organization with no type of activity: the generic names it always had. */
export const DEFAULT_TRADE_VOCABULARY: TradeVocabulary = {
  catalog: "Catalogue",
  bookings: "Réservations",
  crm: "CRM",
};

export const BUSINESS_MODEL_DEFINITIONS: Record<BusinessModel, BusinessModelDefinition> = {
  retail: {
    key: "retail",
    label: "Boutique",
    description: "Vous vendez des produits, en magasin ou en ligne.",
    siteKind: "Site e-commerce",
    primaryChannel: "orders",
    defaultStorefrontTemplate: "boutique",
    offerTypes: ["product", "package", "digital_product", "subscription"],
    screens: { kitchen: false, training: false },
    tools: ["orders", "returns"],
    vocabulary: { catalog: "Produits", bookings: "Réservations", crm: "Clients" },
    stock: true,
  },
  restaurant: {
    key: "restaurant",
    label: "Restauration",
    description: "Restaurant, traiteur, vente à emporter ou en livraison.",
    siteKind: "Menu en ligne et commande",
    primaryChannel: "orders",
    defaultStorefrontTemplate: "table",
    offerTypes: ["product", "package", "booking"],
    screens: { kitchen: true, training: false },
    tools: ["orders", "bookings"],
    vocabulary: { catalog: "Menu", bookings: "Réservations de table", crm: "Clients" },
    stock: true,
  },
  appointments: {
    key: "appointments",
    label: "Rendez-vous",
    description: "Vos clients réservent une prestation : salon, soins, sport, services à domicile.",
    siteKind: "Vitrine et prise de rendez-vous",
    primaryChannel: "bookings",
    defaultStorefrontTemplate: "salon",
    offerTypes: ["booking", "package", "subscription", "product"],
    screens: { kitchen: false, training: false },
    tools: ["bookings"],
    vocabulary: { catalog: "Prestations", bookings: "Rendez-vous", crm: "Clients" },
    stock: false,
  },
  lodging: {
    key: "lodging",
    label: "Hébergement",
    description: "Gîtes, chambres d'hôtes, hôtels : vos clients réservent des séjours.",
    siteKind: "Vitrine et réservation de séjours",
    primaryChannel: "bookings",
    defaultStorefrontTemplate: "sejour",
    offerTypes: ["booking", "package", "product"],
    screens: { kitchen: false, training: false },
    tools: ["bookings"],
    vocabulary: { catalog: "Chambres et séjours", bookings: "Réservations", crm: "Clients" },
    stock: false,
  },
  training: {
    key: "training",
    label: "Formation",
    description: "Formations, ateliers, cours : vos clients s'inscrivent à des sessions.",
    siteKind: "Académie en ligne",
    primaryChannel: "bookings",
    defaultStorefrontTemplate: "academie",
    offerTypes: ["booking", "package", "digital_product", "subscription"],
    screens: { kitchen: false, training: true },
    tools: ["orders", "bookings"],
    vocabulary: { catalog: "Formations et offres", bookings: "Inscriptions", crm: "Apprenants" },
    stock: false,
  },
  quotes: {
    key: "quotes",
    label: "Services sur devis",
    description: "Conseil, artisanat, agence, événementiel : vous travaillez sur devis.",
    siteKind: "Vitrine et demande de devis",
    primaryChannel: "quotes",
    defaultStorefrontTemplate: "vitrine",
    offerTypes: ["service", "package", "subscription", "booking"],
    screens: { kitchen: false, training: false },
    tools: ["bookings"],
    vocabulary: { catalog: "Prestations", bookings: "Rendez-vous", crm: "Prospects et clients" },
    stock: false,
  },
  real_estate: {
    key: "real_estate",
    label: "Immobilier",
    description: "Agence, gestion locative, syndic : vous présentez des biens.",
    siteKind: "Site d'annonces",
    primaryChannel: "leads",
    defaultStorefrontTemplate: "agence",
    offerTypes: ["service", "booking"],
    screens: { kitchen: false, training: false },
    tools: ["bookings"],
    vocabulary: { catalog: "Biens", bookings: "Visites", crm: "Prospects et clients" },
    stock: false,
  },
  association: {
    key: "association",
    label: "Association",
    description: "Association, ONG : adhésions, dons et vie des membres.",
    siteKind: "Vitrine, adhésions et dons",
    primaryChannel: "orders",
    defaultStorefrontTemplate: "vitrine",
    offerTypes: ["subscription", "product", "booking"],
    screens: { kitchen: false, training: false },
    tools: ["orders", "bookings"],
    vocabulary: { catalog: "Adhésions et dons", bookings: "Événements", crm: "Membres" },
    stock: false,
  },
};

/**
 * The trade tools shown in the menu: the trade's own, plus any the owner brought back. An
 * organization with no type of activity sees them all, as before this existed.
 */
export function visibleTradeTools(
  businessModel: BusinessModel | undefined,
  extraTools: readonly TradeTool[] | undefined,
): Set<TradeTool> {
  if (!businessModel) return new Set(TRADE_TOOLS);
  return new Set([...BUSINESS_MODEL_DEFINITIONS[businessModel].tools, ...(extraTools ?? [])]);
}

export function tradeVocabulary(businessModel: BusinessModel | undefined): TradeVocabulary {
  return businessModel ? BUSINESS_MODEL_DEFINITIONS[businessModel].vocabulary : DEFAULT_TRADE_VOCABULARY;
}

/**
 * Guided characteristics for the offers of some types of activity: a room's capacity and
 * amenities, a property's surface and rooms. They are stored in Offer.attributes under these
 * labels — the free-form characteristics the storefront already shows on the offer page — so no
 * schema per trade is needed, and an owner can still add anything else freely.
 *
 * Shown for the activity's main offer type only (BusinessModelDefinition.offerTypes[0]): a
 * guesthouse's nights, an agency's listings.
 */
export interface OfferFieldDefinition {
  /** Also the attribute key, as displayed to customers. */
  label: string;
  kind: "number" | "text" | "date" | "select" | "checklist";
  /** For select and checklist. A checklist is stored as "A, B, C". */
  options?: readonly string[];
}

export const BUSINESS_MODEL_OFFER_FIELDS: Partial<Record<BusinessModel, readonly OfferFieldDefinition[]>> = {
  // A dish. Allergens are what a customer most needs before ordering, and what a restaurant is
  // asked for most often; the list is the 14 allergens EU law makes restaurants declare.
  restaurant: [
    {
      label: "Allergènes",
      kind: "checklist",
      options: [
        "Gluten",
        "Crustacés",
        "Œufs",
        "Poisson",
        "Arachides",
        "Soja",
        "Lait",
        "Fruits à coque",
        "Céleri",
        "Moutarde",
        "Sésame",
        "Sulfites",
        "Lupin",
        "Mollusques",
      ],
    },
    {
      label: "Régime",
      kind: "checklist",
      options: ["Végétarien", "Végan", "Halal", "Sans gluten", "Sans porc"],
    },
    { label: "Piment", kind: "select", options: ["Doux", "Moyen", "Fort", "Très fort"] },
    { label: "Portion", kind: "text" },
    { label: "Temps de préparation (min)", kind: "number" },
  ],
  // A service by appointment. The duration, buffer and deposit are typed Offer fields already;
  // these are what a customer asks before booking.
  appointments: [
    { label: "Lieu", kind: "select", options: ["Sur place", "À domicile", "Sur place ou à domicile", "En ligne"] },
    { label: "Pour qui", kind: "select", options: ["Femme", "Homme", "Enfant", "Mixte"] },
    { label: "Niveau", kind: "select", options: ["Tous niveaux", "Débutant", "Intermédiaire", "Avancé"] },
    { label: "À prévoir", kind: "text" },
  ],
  training: [
    { label: "Format", kind: "select", options: ["Présentiel", "En ligne", "Hybride"] },
    { label: "Niveau", kind: "select", options: ["Débutant", "Intermédiaire", "Avancé", "Tous niveaux"] },
    { label: "Durée totale", kind: "text" },
    { label: "Prérequis", kind: "text" },
    { label: "Places", kind: "number" },
    { label: "Attestation", kind: "select", options: ["Attestation de fin de formation", "Certificat", "Aucune"] },
    { label: "Langue", kind: "text" },
  ],
  // A service sold on quote: how the price is counted is the first thing a prospect asks, and
  // the area served the first thing that rules them in or out.
  quotes: [
    {
      label: "Tarification",
      kind: "select",
      options: ["Au forfait", "À l'heure", "À la journée", "Au m²", "Sur devis uniquement"],
    },
    { label: "Zone d'intervention", kind: "text" },
    { label: "Délai indicatif", kind: "text" },
    { label: "Déplacement", kind: "select", options: ["Inclus", "En supplément", "Sans objet"] },
    { label: "Garantie", kind: "text" },
  ],
  association: [
    { label: "Périodicité", kind: "select", options: ["Mensuelle", "Trimestrielle", "Annuelle", "Ponctuelle"] },
    { label: "Avantages inclus", kind: "text" },
    { label: "Public", kind: "text" },
  ],
  lodging: [
    { label: "Capacité (personnes)", kind: "number" },
    { label: "Lits", kind: "text" },
    { label: "Superficie (m²)", kind: "number" },
    {
      label: "Équipements",
      kind: "checklist",
      options: [
        "Wi-Fi",
        "Climatisation",
        "Ventilateur",
        "Salle de bain privée",
        "Télévision",
        "Petit-déjeuner inclus",
        "Parking",
        "Piscine",
        "Cuisine équipée",
      ],
    },
  ],
  real_estate: [
    { label: "Transaction", kind: "select", options: ["Vente", "Location"] },
    {
      label: "Type de bien",
      kind: "select",
      options: ["Appartement", "Maison", "Villa", "Studio", "Terrain", "Bureau", "Local commercial"],
    },
    { label: "Surface (m²)", kind: "number" },
    { label: "Pièces", kind: "number" },
    { label: "Chambres", kind: "number" },
    { label: "Quartier", kind: "text" },
    { label: "Ville", kind: "text" },
    { label: "Charges mensuelles", kind: "number" },
    { label: "Disponible à partir du", kind: "date" },
  ],
};

/**
 * The English of every guided label and option above. Attributes are stored under the French
 * label (the dashboard is French-first and an owner's own keys are free text), so an English site
 * translates on display: offerAttributeText below. A storefront test fails when a label or option
 * is added above without its English here.
 */
export const OFFER_FIELD_TEXT_EN: Readonly<Record<string, string>> = {
  // restaurant
  Allergènes: "Allergens",
  Gluten: "Gluten",
  Crustacés: "Crustaceans",
  Œufs: "Eggs",
  Poisson: "Fish",
  Arachides: "Peanuts",
  Soja: "Soy",
  Lait: "Milk",
  "Fruits à coque": "Tree nuts",
  Céleri: "Celery",
  Moutarde: "Mustard",
  Sésame: "Sesame",
  Sulfites: "Sulphites",
  Lupin: "Lupin",
  Mollusques: "Molluscs",
  Régime: "Diet",
  Végétarien: "Vegetarian",
  Végan: "Vegan",
  Halal: "Halal",
  "Sans gluten": "Gluten-free",
  "Sans porc": "No pork",
  Piment: "Spice",
  Doux: "Mild",
  Moyen: "Medium",
  Fort: "Hot",
  "Très fort": "Very hot",
  Portion: "Portion",
  "Temps de préparation (min)": "Preparation time (min)",
  // appointments
  Lieu: "Where",
  "Sur place": "On site",
  "À domicile": "At your home",
  "Sur place ou à domicile": "On site or at your home",
  "En ligne": "Online",
  "Pour qui": "For",
  Femme: "Women",
  Homme: "Men",
  Enfant: "Children",
  Mixte: "Everyone",
  Niveau: "Level",
  "Tous niveaux": "All levels",
  Débutant: "Beginner",
  Intermédiaire: "Intermediate",
  Avancé: "Advanced",
  "À prévoir": "What to bring",
  // training
  Format: "Format",
  Présentiel: "In person",
  Hybride: "Hybrid",
  "Durée totale": "Total duration",
  Prérequis: "Prerequisites",
  Places: "Seats",
  Attestation: "Certificate",
  "Attestation de fin de formation": "Certificate of completion",
  Certificat: "Certificate",
  Aucune: "None",
  Langue: "Language",
  // quotes
  Tarification: "Pricing",
  "Au forfait": "Flat rate",
  "À l'heure": "Hourly",
  "À la journée": "Daily",
  "Au m²": "Per m²",
  "Sur devis uniquement": "On quote only",
  "Zone d'intervention": "Area served",
  "Délai indicatif": "Typical lead time",
  Déplacement: "Travel",
  Inclus: "Included",
  "En supplément": "Extra",
  "Sans objet": "Not applicable",
  Garantie: "Warranty",
  // association
  Périodicité: "Frequency",
  Mensuelle: "Monthly",
  Trimestrielle: "Quarterly",
  Annuelle: "Yearly",
  Ponctuelle: "One-off",
  "Avantages inclus": "Benefits included",
  Public: "Who it is for",
  // lodging
  "Capacité (personnes)": "Sleeps",
  Lits: "Beds",
  "Superficie (m²)": "Size (m²)",
  Équipements: "Amenities",
  "Wi-Fi": "Wi-Fi",
  Climatisation: "Air conditioning",
  Ventilateur: "Fan",
  "Salle de bain privée": "Private bathroom",
  Télévision: "TV",
  "Petit-déjeuner inclus": "Breakfast included",
  Parking: "Parking",
  Piscine: "Swimming pool",
  "Cuisine équipée": "Equipped kitchen",
  // real estate
  Transaction: "Transaction",
  Vente: "For sale",
  Location: "To let",
  "Type de bien": "Property type",
  Appartement: "Apartment",
  Maison: "House",
  Villa: "Villa",
  Studio: "Studio",
  Terrain: "Land",
  Bureau: "Office",
  "Local commercial": "Commercial premises",
  "Surface (m²)": "Floor area (m²)",
  Pièces: "Rooms",
  Chambres: "Bedrooms",
  Quartier: "District",
  Ville: "City",
  "Charges mensuelles": "Monthly charges",
  "Disponible à partir du": "Available from",
};

/** The kind of a guided label ("date" for "Disponible à partir du"…), whatever the trade. */
export function offerFieldKind(label: string): OfferFieldDefinition["kind"] | undefined {
  for (const fields of Object.values(BUSINESS_MODEL_OFFER_FIELDS)) {
    const field = fields?.find((f) => f.label === label);
    if (field) return field.kind;
  }
  return undefined;
}

/**
 * One stored attribute as a site shows it. In English, a guided label and its options are
 * translated — a checklist option by option; anything the owner typed is shown as typed.
 */
export function offerAttributeText(
  key: string,
  value: string,
  locale: "fr" | "en",
): { label: string; value: string } {
  if (locale !== "en") return { label: key, value };
  const en = (text: string) => OFFER_FIELD_TEXT_EN[text] ?? text;
  const kind = offerFieldKind(key);
  return {
    label: en(key),
    value:
      kind === "checklist"
        ? value
            .split(", ")
            .map((part) => en(part.trim()))
            .join(", ")
        : kind === "select"
          ? en(value)
          : value,
  };
}
