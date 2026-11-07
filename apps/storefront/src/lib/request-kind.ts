/** What a visitor asks a business for when the site cannot sell or book the offer itself. */
export type RequestKind = "quote" | "visit" | "info";

export function requestLabel(kind: RequestKind): [string, string] {
  return kind === "quote"
    ? ["Demander un devis", "Request a quote"]
    : kind === "visit"
      ? ["Demander une visite", "Request a visit"]
      : ["Demander des renseignements", "Ask for information"];
}
