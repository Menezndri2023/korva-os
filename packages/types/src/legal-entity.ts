/**
 * The legal identity of the company that sells KORVA OS — shown on the legal notice and in the
 * terms, and what payment providers (Paystack, YouCan Pay) check against the documents they
 * received. Read from the company's own papers on 2026-11-27: DGI identification bulletin (IF, TP,
 * registered for IS and TVA), RC certificate (Tribunal de
 * commerce de Casablanca, immatriculation of 2026-08-07), OMPIC negative certificate n° 3271679
 * (ICE), and the legal announcement in Le J.A.L du Maroc n° 1330 of 2026-10-29. Never type a
 * figure here that is not on one of those papers.
 */
export const LEGAL_ENTITY = {
  name: "VIT GLOBAL TECHNOLOGIES GROUP",
  form: "SARLAU",
  formLong: {
    fr: "société à responsabilité limitée à associé unique (SARLAU)",
    en: "single-member limited liability company (SARLAU)",
  },
  capital: "20 000 MAD",
  address: "Angle Boulevard Lalla Yacout et Rue El Araar, Résidence Galis, Immeuble 9, 4e étage, Appartement 17, Casablanca, Maroc",
  rc: "742851",
  rcCourt: "Tribunal de commerce de Casablanca",
  ice: "004013219000041",
  /** Identifiant fiscal and taxe professionnelle, from the DGI "Bulletin de notification du n°
   *  d'identification fiscale" of 2026-08-06 (also on the company stamp). The bulletin requires the
   *  IF on every invoice (CGI articles 119 and 145-III). */
  if: "73292932",
  tp: "33304467",
  manager: "N'DRI N'GUESSAN MANASSE",
  activity: {
    fr: "Programmation, conseil et autres activités informatiques",
    en: "Programming, consulting and other IT activities",
  },
  hosting: {
    fr: "Contabo GmbH (serveurs) et MongoDB, Inc. (base de données MongoDB Atlas)",
    en: "Contabo GmbH (servers) and MongoDB, Inc. (MongoDB Atlas database)",
  },
} as const;

/**
 * VIT GLOBAL's VAT on KORVA subscriptions, as confirmed by the owner on 2026-11-27 (pending the
 * accountant's written confirmation): a business established in Morocco pays 20 % VAT, INCLUDED
 * in the price shown; a business established abroad is invoiced without VAT, as an export of
 * services. The exemption wording is the accountant's to confirm.
 */
export const KORVA_VAT = {
  rate: 20,
  /** Country whose businesses are charged VAT. */
  domesticCountry: "MA",
  exportExemption: {
    fr: "TVA non applicable : prestation de services à l'exportation, article 92-I-1° du Code général des impôts",
    en: "VAT not applicable: export of services, article 92-I-1° of the Moroccan General Tax Code",
  },
} as const;

/** Splits a VAT-inclusive price into its parts, to the cent. */
export function splitVatIncluded(total: number, ratePercent: number): { net: number; vat: number } {
  const net = Math.round((total / (1 + ratePercent / 100)) * 100) / 100;
  return { net, vat: Math.round((total - net) * 100) / 100 };
}
