import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContactDetailPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "contact-1" }),
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const patchMock = vi.mocked(apiClient.patch);
const deleteMock = vi.mocked(apiClient.delete);

const contact = {
  id: "contact-1",
  type: "person",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  phone: "0102030405",
  company: "Analytical Engines",
  tags: ["vip"],
};

function mockGetByPath(path: string) {
  if (path === "/contacts/contact-1") return Promise.resolve(contact);
  if (path.startsWith("/leads")) return Promise.resolve([]);
  if (path.startsWith("/orders")) return Promise.resolve([]);
  if (path.startsWith("/carts")) return Promise.resolve([]);
  if (path.startsWith("/bookings")) return Promise.resolve([]);
  if (path.startsWith("/invoices")) return Promise.resolve([]);
  if (path.startsWith("/quotes")) return Promise.resolve([]);
  if (path.startsWith("/conversations")) return Promise.resolve([]);
  if (path.startsWith("/notes")) return Promise.resolve([]);
  if (path.startsWith("/tasks")) return Promise.resolve([]);
  if (path.startsWith("/activities")) return Promise.resolve([]);
  throw new Error(`unexpected GET ${path}`);
}

describe("ContactDetailPage (LOT F7)", () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    pushMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
  });

  it("loads and displays the contact's identity fields", async () => {
    renderWithProviders(<ContactDetailPage />);
    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("0102030405")).toBeInTheDocument();
    expect(screen.getByText("Analytical Engines")).toBeInTheDocument();
    expect(screen.getByText("vip")).toBeInTheDocument();
  });

  it("shows a message and a link back when the contact does not exist (404)", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/contacts/contact-1") {
        return Promise.reject(new ApiError("CONTACT_NOT_FOUND", "Contact not found"));
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<ContactDetailPage />);

    expect(await screen.findByText("Contact not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retour aux contacts" })).toBeInTheDocument();
  });

  it("shows the backend message on a 403 PERMISSION_DENIED error", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/contacts/contact-1") {
        return Promise.reject(new ApiError("PERMISSION_DENIED", "Réservé aux administrateurs"));
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<ContactDetailPage />);

    expect(await screen.findByText("Réservé aux administrateurs")).toBeInTheDocument();
  });

  it("shows only the leads that belong to this contact (client-side filter)", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/contacts/contact-1") return Promise.resolve(contact);
      if (path.startsWith("/leads")) {
        return Promise.resolve([
          {
            id: "lead-1",
            contactId: "contact-1",
            status: "open",
            pipelineId: "p1",
            stageId: "s1",
            customFields: {},
            createdAt: "",
            updatedAt: "",
          },
          {
            id: "lead-2",
            contactId: "other-contact",
            status: "won",
            pipelineId: "p1",
            stageId: "s1",
            customFields: {},
            createdAt: "",
            updatedAt: "",
          },
        ]);
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<ContactDetailPage />);
    await screen.findByRole("heading", { name: "Ada Lovelace" });

    expect(await screen.findByText("open")).toBeInTheDocument();
    expect(screen.queryByText("won")).not.toBeInTheDocument();
  });

  it("fetches and displays orders filtered by contactId", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/contacts/contact-1") return Promise.resolve(contact);
      if (path === "/orders?contactId=contact-1") {
        return Promise.resolve([
          { id: "order-1", number: "ORD-1", status: "confirmed", total: 100, currency: "EUR" },
        ]);
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<ContactDetailPage />);

    expect(await screen.findByText("ORD-1")).toBeInTheDocument();
  });

  it("shows empty-state text for a relation with no data", async () => {
    renderWithProviders(<ContactDetailPage />);
    expect(await screen.findByText("Aucune commande.")).toBeInTheDocument();
    expect(screen.getByText("Aucune réservation.")).toBeInTheDocument();
  });

  it("opens the edit form prefilled and submits PATCH with the typed values", async () => {
    patchMock.mockResolvedValue(contact);
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />);
    await screen.findByRole("heading", { name: "Ada Lovelace" });

    await user.click(screen.getByRole("button", { name: "Modifier" }));
    expect(screen.getByLabelText("Prénom")).toHaveValue("Ada");

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

  it("deletes the contact after confirmation and redirects to the list", async () => {
    deleteMock.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />);
    await screen.findByRole("heading", { name: "Ada Lovelace" });

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(deleteMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmer ?" }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/contacts/contact-1"));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard/crm"));
  });

  it("on CONTACT_IN_USE: shows the explicit message, keeps the contact, and does not navigate away", async () => {
    deleteMock.mockRejectedValue(
      new ApiError(
        "CONTACT_IN_USE",
        "This contact is still referenced by other records and cannot be deleted",
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />);
    await screen.findByRole("heading", { name: "Ada Lovelace" });

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer ?" }));

    expect(
      await screen.findByText(
        "Ce contact ne peut pas être supprimé car il est encore utilisé par d'autres éléments de votre organisation.",
      ),
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
  });
});
