import { describe, expect, it } from "vitest";
import { PublicApiError } from "./public-api-client";
import { GENERIC_VISITOR_MESSAGE, visitorMessage } from "./visitor-messages";

describe("visitor messages", () => {
  it("never shows the API's English sentence to a visitor", () => {
    const error = new PublicApiError("INVALID_CREDENTIALS", "Invalid email or password");
    expect(error.message).toBe("Adresse e-mail ou mot de passe incorrect.");
    expect(error.apiMessage).toBe("Invalid email or password");
  });

  it("falls back to a French sentence for a code it does not know", () => {
    expect(new PublicApiError("SOME_FUTURE_CODE", "Something").message).toBe(GENERIC_VISITOR_MESSAGE);
    expect(visitorMessage(undefined)).toBe(GENERIC_VISITOR_MESSAGE);
  });
});
