import { Fragment, type ReactNode } from "react";

/**
 * The few bits of Markdown models write — **bold**, bullet and numbered lists, paragraphs —
 * turned into React elements. Never HTML: the text is the model's, so nothing in it is ever
 * interpreted as markup. Without this a merchant read "**21 000 XOF**" with the asterisks.
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(part)) return <Fragment key={index}>{part.slice(1, -1)}</Fragment>;
    return <Fragment key={index}>{part.replace(/(^|\s)\*(\S[^*]*\S|\S)\*(?=\s|$|[.,;:!?])/g, "$1$2")}</Fragment>;
  });
}

type Block = { kind: "p"; lines: string[] } | { kind: "ul" | "ol"; items: string[] };

export function AiMessageText({ text }: { text: string }) {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      const item = (bullet ?? numbered)![1]!;
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (line.trim() === "") {
      blocks.push({ kind: "p", lines: [] });
    } else if (last && last.kind === "p") {
      last.lines.push(line);
    } else {
      blocks.push({ kind: "p", lines: [line] });
    }
  }
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        if (block.kind === "p") {
          if (block.lines.length === 0) return null;
          return (
            <p key={index}>
              {block.lines.map((line, i) => (
                <Fragment key={i}>
                  {i > 0 && <br />}
                  {inline(line.replace(/^#{1,6}\s+/, ""))}
                </Fragment>
              ))}
            </p>
          );
        }
        const List = block.kind;
        return (
          <List key={index} className={`space-y-1 pl-5 ${block.kind === "ul" ? "list-disc" : "list-decimal"}`}>
            {block.items.map((item, i) => (
              <li key={i}>{inline(item)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

/** What the assistant is doing, in the merchant's words — never a tool name or raw data. */
export const AI_TOOL_LABELS: Record<string, string> = {
  get_business_overview: "consulte l'activité",
  get_sales_report: "consulte les ventes",
  search_contacts: "cherche dans les clients",
  get_customer: "ouvre une fiche client",
  create_customer: "crée une fiche client",
  search_offers: "parcourt le catalogue",
  get_offer: "ouvre une offre",
  create_task: "crée une tâche",
  send_email: "prépare un e-mail",
  send_whatsapp: "prépare un message WhatsApp",
  list_recommendations: "consulte les recommandations",
  dismiss_recommendation: "écarte une recommandation",
  resolve_recommendation: "clôt une recommandation",
  propose_recommendation: "propose une recommandation",
  get_order: "ouvre une commande",
  create_order: "crée une commande",
  get_invoice: "ouvre une facture",
  suggest_reorder: "vérifie le stock",
  detect_dead_stock: "repère les articles qui dorment",
  analyze_suppliers: "compare les fournisseurs",
  list_resources: "regarde l'équipe et les salles",
  get_availability: "vérifie l'agenda",
  search_bookings: "consulte les réservations",
  create_booking: "enregistre une réservation",
  cancel_booking: "annule une réservation",
  search_leads: "cherche dans les demandes",
  update_lead: "met à jour une demande",
  create_deal: "crée une affaire",
  update_deal: "met à jour une affaire",
  search_deals: "consulte les affaires",
  win_deal: "marque une affaire gagnée",
  lose_deal: "marque une affaire perdue",
  create_quote: "prépare un devis",
  get_quote: "ouvre un devis",
  search_quotes: "consulte les devis",
};

export const AI_TOOL_LABELS_EN: Record<keyof typeof AI_TOOL_LABELS, string> = {
  get_business_overview: "is looking at the business",
  get_sales_report: "is looking at sales",
  search_contacts: "is searching customers",
  get_customer: "is opening a customer record",
  create_customer: "is creating a customer record",
  search_offers: "is browsing the catalogue",
  get_offer: "is opening an offer",
  create_task: "is creating a task",
  send_email: "is preparing an e-mail",
  send_whatsapp: "is preparing a WhatsApp message",
  list_recommendations: "is looking at recommendations",
  dismiss_recommendation: "is dismissing a recommendation",
  resolve_recommendation: "is closing a recommendation",
  propose_recommendation: "is proposing a recommendation",
  get_order: "is opening an order",
  create_order: "is creating an order",
  get_invoice: "is opening an invoice",
  suggest_reorder: "is checking stock",
  detect_dead_stock: "is spotting items that do not sell",
  analyze_suppliers: "is comparing suppliers",
  list_resources: "is looking at the team and rooms",
  get_availability: "is checking the diary",
  search_bookings: "is looking at bookings",
  create_booking: "is recording a booking",
  cancel_booking: "is cancelling a booking",
  search_leads: "is searching requests",
  update_lead: "is updating a request",
  create_deal: "is creating a deal",
  update_deal: "is updating a deal",
  search_deals: "is looking at deals",
  win_deal: "is marking a deal won",
  lose_deal: "is marking a deal lost",
  create_quote: "is preparing a quote",
  get_quote: "is opening a quote",
  search_quotes: "is looking at quotes",
};
