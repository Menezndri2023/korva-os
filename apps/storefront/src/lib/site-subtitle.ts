import type { BusinessModel } from "@korva/types";

type Translate = (fr: string, en: string) => string;

/**
 * The line under the business's name: its own tagline, or — for a business that has not written
 * one yet — what a visitor can do here, by trade. A name alone told a new visitor nothing.
 */
export function siteSubtitle(
  organization: { tagline?: string; businessModel?: BusinessModel },
  t: Translate,
): string {
  if (organization.tagline) return organization.tagline;
  switch (organization.businessModel) {
    case "retail":
      return t("Choisissez vos articles et commandez en ligne, en quelques gestes.", "Pick your items and order online, in a few taps.");
    case "restaurant":
      return t("Parcourez la carte et commandez vos plats en ligne.", "Browse the menu and order your dishes online.");
    case "appointments":
      return t("Prenez rendez-vous en ligne, en quelques secondes.", "Book an appointment online, in seconds.");
    case "lodging":
      return t("Réservez votre séjour en ligne, vos dates en quelques clics.", "Book your stay online, your dates in a few clicks.");
    case "training":
      return t("Inscrivez-vous en ligne à nos formations et ateliers.", "Sign up online for our courses and workshops.");
    case "quotes":
      return t("Demandez votre devis en ligne, réponse rapide.", "Ask for your quote online, quick reply.");
    case "real_estate":
      return t("Découvrez nos biens et demandez une visite en ligne.", "Browse our properties and ask for a visit online.");
    case "association":
      return t("Adhérez, soutenez nos actions et suivez nos activités.", "Join, support our work and follow our activities.");
    default:
      return t("Découvrez nos offres et contactez-nous en un geste.", "Discover our offers and reach us in one tap.");
  }
}
