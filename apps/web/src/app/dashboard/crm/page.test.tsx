import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContactsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

// This page's queries are gated on auth bootstrap readiness (Bug #6) — these tests exercise
// the page's own behavior once that readiness is established, not the readiness gate itself
// (covered separately in use-auth-ready.test.ts).
vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);
const patchMock = vi.mocked(apiClient.patch);
const deleteMock = vi.mocked(apiClient.delete);

describe("ContactsPage (migrated to @korva/ui Button/Input/Card in F2-B.7)", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockResolvedValue([]);
  });

  it("renders the search input and the toggle button", async () => {
    renderWithProviders(<ContactsPage />);
    expect(screen.getByPlaceholderText("Rechercher un contact...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nouveau contact" })).toBeInTheDocument();
    await waitFor(() => expect(getMock).toHaveBeenCalled());
  });

  it("toggles the create form open and closed via the same button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);

    expect(screen.queryByPlaceholderText("Prénom")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nouveau contact" }));
    expect(screen.getByPlaceholderText("Prénom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByPlaceholderText("Prénom")).not.toBeInTheDocument();
  });

  it("filters via the search input (queryFn receives the typed value)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/contacts?"));

    await user.type(screen.getByPlaceholderText("Rechercher un contact..."), "ada");
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith("/contacts?search=ada"),
    );
  });

  it("submits the create form and calls POST /contacts with exactly the typed fields", async () => {
    postMock.mockResolvedValue({
      id: "1",
      type: "person",
      tags: [],
    });
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);

    await user.click(screen.getByRole("button", { name: "Nouveau contact" }));
    await user.type(screen.getByPlaceholderText("Prénom"), "Ada");
    await user.type(screen.getByPlaceholderText("Nom"), "Lovelace");
    await user.type(screen.getByPlaceholderText("Email"), "ada@example.com");
    await user.type(screen.getByPlaceholderText("Téléphone"), "0102030405");
    await user.type(screen.getByPlaceholderText("Entreprise"), "Analytical Engines");
    await user.click(screen.getByRole("button", { name: "Créer le contact" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/contacts", {
        type: "person",
        tags: [],
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        phone: "0102030405",
        company: "Analytical Engines",
      }),
    );
  });

  it("shows a loading state on the submit button while the request is pending", async () => {
    postMock.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);

    // All fields filled, not just email: createContactSchema's optional string fields use
    // .min(1), which rejects react-hook-form's default "" for an untouched field — a
    // pre-existing trait of this page unrelated to the migration (same category as the
    // register.tsx native-validation quirk found in F2-B.4). Leaving a field empty here would
    // make zodResolver reject the submission silently (no error UI exists for these fields
    // beyond email), so mutate() would never be called and this test would falsely fail.
    await user.click(screen.getByRole("button", { name: "Nouveau contact" }));
    await user.type(screen.getByPlaceholderText("Prénom"), "Ada");
    await user.type(screen.getByPlaceholderText("Nom"), "Lovelace");
    await user.type(screen.getByPlaceholderText("Email"), "ada@example.com");
    await user.type(screen.getByPlaceholderText("Téléphone"), "0102030405");
    await user.type(screen.getByPlaceholderText("Entreprise"), "Analytical Engines");
    await user.click(screen.getByRole("button", { name: "Créer le contact" }));

    expect(await screen.findByRole("button", { name: "Création..." })).toBeDisabled();
  });
});

describe("ContactsPage — edit contact (LOT F4)", () => {
  const contactOne = {
    id: "contact-1",
    type: "person",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: "0102030405",
    company: "Analytical Engines",
    tags: ["vip"],
  };
  const contactTwo = {
    id: "contact-2",
    type: "person",
    firstName: "Grace",
    lastName: "Hopper",
    email: "grace@example.com",
    phone: "0607080910",
    company: "Navy",
    tags: [],
  };

  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    getMock.mockResolvedValue([contactOne, contactTwo]);
  });

  async function openEditForm(user: ReturnType<typeof userEvent.setup>, name: string) {
    renderWithProviders(<ContactsPage />);
    const row = (await screen.findByText(name)).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Modifier" }));
  }

  it("opens the edit form when Modifier is clicked", async () => {
    const user = userEvent.setup();
    await openEditForm(user, "Ada Lovelace");
    expect(screen.getByLabelText("Prénom")).toBeInTheDocument();
  });

  it("prefills the edit form with the contact's current values", async () => {
    const user = userEvent.setup();
    await openEditForm(user, "Ada Lovelace");

    expect(screen.getByLabelText("Prénom")).toHaveValue("Ada");
    expect(screen.getByLabelText("Nom")).toHaveValue("Lovelace");
    expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com");
    expect(screen.getByLabelText("Téléphone")).toHaveValue("0102030405");
    expect(screen.getByLabelText("Entreprise")).toHaveValue("Analytical Engines");
    expect(screen.getByLabelText("Tags (séparés par des virgules)")).toHaveValue("vip");
  });

  it("blocks submission when a required field is cleared (updateContactSchema)", async () => {
    const user = userEvent.setup();
    await openEditForm(user, "Ada Lovelace");

    await user.clear(screen.getByLabelText("Prénom"));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(patchMock).not.toHaveBeenCalled());
  });

  it("submits PATCH /contacts/:id with exactly the form fields, id in the URL", async () => {
    patchMock.mockResolvedValue(contactOne);
    const user = userEvent.setup();
    await openEditForm(user, "Ada Lovelace");

    await user.clear(screen.getByLabelText("Prénom"));
    await user.type(screen.getByLabelText("Prénom"), "Augusta");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/contacts/contact-1", {
        firstName: "Augusta",
        lastName: "Lovelace",
        email: "ada@example.com",
        phone: "0102030405",
        company: "Analytical Engines",
        tags: ["vip"],
      }),
    );
  });

  it("uses the correct id in the URL when editing a different contact", async () => {
    patchMock.mockResolvedValue(contactTwo);
    const user = userEvent.setup();
    await openEditForm(user, "Grace Hopper");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/contacts/contact-2", expect.anything()),
    );
  });

  it("disables the submit button and shows a saving state while pending", async () => {
    patchMock.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    await openEditForm(user, "Ada Lovelace");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByRole("button", { name: "Enregistrement..." })).toBeDisabled();
  });

  it("on success: refetches the contacts list and closes the edit form", async () => {
    patchMock.mockResolvedValue(contactOne);
    const user = userEvent.setup();
    await openEditForm(user, "Ada Lovelace");

    const getCallsBefore = getMock.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(screen.queryByLabelText("Prénom")).not.toBeInTheDocument());
    await waitFor(() => expect(getMock.mock.calls.length).toBeGreaterThan(getCallsBefore));
  });

  it("on API error: shows the message and keeps the form with the typed values", async () => {
    patchMock.mockRejectedValue(new ApiError("VALIDATION_ERROR", "Email déjà utilisé"));
    const user = userEvent.setup();
    await openEditForm(user, "Ada Lovelace");

    await user.clear(screen.getByLabelText("Prénom"));
    await user.type(screen.getByLabelText("Prénom"), "Augusta");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Email déjà utilisé")).toBeInTheDocument();
    expect(screen.getByLabelText("Prénom")).toHaveValue("Augusta");
  });

  it("on a 403 PERMISSION_DENIED error: shows the message without touching the row", async () => {
    patchMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "Réservé aux administrateurs"));
    const user = userEvent.setup();
    await openEditForm(user, "Ada Lovelace");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Réservé aux administrateurs")).toBeInTheDocument();
    expect(screen.getByLabelText("Prénom")).toBeInTheDocument();
  });
});

describe("ContactsPage — delete contact (LOT F6)", () => {
  const contactOne = {
    id: "contact-1",
    type: "person",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: "0102030405",
    company: "Analytical Engines",
    tags: [],
  };
  const contactTwo = {
    id: "contact-2",
    type: "person",
    firstName: "Grace",
    lastName: "Hopper",
    email: "grace@example.com",
    phone: "0607080910",
    company: "Navy",
    tags: [],
  };

  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    getMock.mockResolvedValue([contactOne, contactTwo]);
  });

  function rowFor(name: string) {
    return screen.findByText(name).then((cell) => cell.closest("tr")!);
  }

  it("shows a Supprimer button for each contact", async () => {
    renderWithProviders(<ContactsPage />);
    const rowOne = await rowFor("Ada Lovelace");
    const rowTwo = await rowFor("Grace Hopper");
    expect(within(rowOne).getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
    expect(within(rowTwo).getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
  });

  it("first click shows Confirmer ?/Annuler and sends no DELETE", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    const row = await rowFor("Ada Lovelace");

    await user.click(within(row).getByRole("button", { name: "Supprimer" }));

    expect(within(row).getByRole("button", { name: "Confirmer ?" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Annuler" })).toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("cancelling the confirmation sends no DELETE and restores the initial state", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    const row = await rowFor("Ada Lovelace");

    await user.click(within(row).getByRole("button", { name: "Supprimer" }));
    await user.click(within(row).getByRole("button", { name: "Annuler" }));

    expect(within(row).getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Confirmer ?" })).not.toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("confirming sends exactly DELETE /contacts/:id with no body", async () => {
    deleteMock.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    const row = await rowFor("Ada Lovelace");

    await user.click(within(row).getByRole("button", { name: "Supprimer" }));
    await user.click(within(row).getByRole("button", { name: "Confirmer ?" }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/contacts/contact-1"));
  });

  it("with multiple contacts, deleting one uses only that contact's id", async () => {
    deleteMock.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    const rowTwo = await rowFor("Grace Hopper");

    await user.click(within(rowTwo).getByRole("button", { name: "Supprimer" }));
    await user.click(within(rowTwo).getByRole("button", { name: "Confirmer ?" }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/contacts/contact-2"));
    expect(deleteMock).not.toHaveBeenCalledWith("/contacts/contact-1");
  });

  it("pending disables only the confirming row; the other contact stays usable", async () => {
    deleteMock.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    const rowOne = await rowFor("Ada Lovelace");
    const rowTwo = await rowFor("Grace Hopper");

    await user.click(within(rowOne).getByRole("button", { name: "Supprimer" }));
    await user.click(within(rowOne).getByRole("button", { name: "Confirmer ?" }));

    expect(await within(rowOne).findByRole("button", { name: "Suppression..." })).toBeDisabled();
    expect(within(rowTwo).getByRole("button", { name: "Supprimer" })).not.toBeDisabled();
  });

  it("on success: closes the confirmation and refetches the contacts list", async () => {
    deleteMock.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    const row = await rowFor("Ada Lovelace");

    const getCallsBefore = getMock.mock.calls.length;
    await user.click(within(row).getByRole("button", { name: "Supprimer" }));
    await user.click(within(row).getByRole("button", { name: "Confirmer ?" }));

    await waitFor(() =>
      expect(within(row).queryByRole("button", { name: "Confirmer ?" })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(getMock.mock.calls.length).toBeGreaterThan(getCallsBefore));
  });

  it("on a 404 CONTACT_NOT_FOUND error: shows the message and keeps the contact", async () => {
    deleteMock.mockRejectedValue(new ApiError("CONTACT_NOT_FOUND", "Contact not found"));
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    const row = await rowFor("Ada Lovelace");

    await user.click(within(row).getByRole("button", { name: "Supprimer" }));
    await user.click(within(row).getByRole("button", { name: "Confirmer ?" }));

    expect(await screen.findByText("Contact not found")).toBeInTheDocument();
    expect(await rowFor("Ada Lovelace")).toBeInTheDocument();
  });

  it("on a 403 PERMISSION_DENIED error: shows the message and keeps the contact", async () => {
    deleteMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "Réservé aux administrateurs"),
    );
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    const row = await rowFor("Ada Lovelace");

    await user.click(within(row).getByRole("button", { name: "Supprimer" }));
    await user.click(within(row).getByRole("button", { name: "Confirmer ?" }));

    expect(await screen.findByText("Réservé aux administrateurs")).toBeInTheDocument();
    expect(await rowFor("Ada Lovelace")).toBeInTheDocument();
  });

  it("on a 409 CONTACT_IN_USE error: shows an explicit message, keeps the contact, and resets the confirmation", async () => {
    deleteMock.mockRejectedValue(
      new ApiError(
        "CONTACT_IN_USE",
        "This contact is still referenced by other records and cannot be deleted",
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    const row = await rowFor("Ada Lovelace");

    await user.click(within(row).getByRole("button", { name: "Supprimer" }));
    await user.click(within(row).getByRole("button", { name: "Confirmer ?" }));

    expect(
      await screen.findByText(
        "Ce contact ne peut pas être supprimé car il est encore utilisé par d'autres éléments de votre organisation.",
      ),
    ).toBeInTheDocument();
    // The raw backend message is not shown verbatim — it is replaced by the clearer one above.
    expect(
      screen.queryByText(
        "This contact is still referenced by other records and cannot be deleted",
      ),
    ).not.toBeInTheDocument();

    const rowAfter = await rowFor("Ada Lovelace");
    expect(within(rowAfter).getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
    expect(
      within(rowAfter).queryByRole("button", { name: "Confirmer ?" }),
    ).not.toBeInTheDocument();
  });

  it("on a generic ApiError: shows the backend message and keeps the contact", async () => {
    deleteMock.mockRejectedValue(new ApiError("NETWORK_ERROR", "Unable to reach the server"));
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    const row = await rowFor("Ada Lovelace");

    await user.click(within(row).getByRole("button", { name: "Supprimer" }));
    await user.click(within(row).getByRole("button", { name: "Confirmer ?" }));

    expect(await screen.findByText("Unable to reach the server")).toBeInTheDocument();
    expect(await rowFor("Ada Lovelace")).toBeInTheDocument();
  });
});
