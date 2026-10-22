import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PublicOrganization } from "@/lib/public-types";
import { CustomerReviewsSection } from "./CustomerReviews";

function organization(reviewSummary?: PublicOrganization["reviewSummary"]) {
  return { name: "Chez Awa", slug: "chez-awa", reviewSummary } as PublicOrganization;
}

describe("CustomerReviewsSection", () => {
  it("is absent until the first review", () => {
    const { container } = render(
      <CustomerReviewsSection organization={organization({ average: null, count: 0, latest: [] })} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(render(<CustomerReviewsSection organization={organization()} />).container).toBeEmptyDOMElement();
  });

  it("shows the average, who signed, and the business's answer", () => {
    render(
      <CustomerReviewsSection
        organization={organization({
          average: 4.5,
          count: 2,
          latest: [
            {
              rating: 5,
              comment: "Livré chaud, très bon.",
              createdAt: "2026-10-01T10:00:00.000Z",
              authorName: "Awa K.",
              offerName: "Attiéké poisson",
              reply: { body: "Merci Awa !", repliedAt: "2026-10-02T10:00:00.000Z" },
            },
            { rating: 4, createdAt: "2026-09-01T10:00:00.000Z" },
          ],
        })}
      />,
    );
    expect(screen.getByText("4,5")).toBeInTheDocument();
    expect(screen.getByText("2 avis de clients vérifiés")).toBeInTheDocument();
    expect(screen.getByText("Awa K.")).toBeInTheDocument();
    expect(screen.getByText("Client vérifié")).toBeInTheDocument();
    expect(screen.getByText("Réponse de Chez Awa")).toBeInTheDocument();
    expect(screen.getByText("Merci Awa !")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "4 sur 5 étoiles" })).toBeInTheDocument();
  });
});
