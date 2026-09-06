import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
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
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);
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
  if (path === "/contacts/duplicates") return Promise.resolve([]);
  if (path.startsWith("/leads")) return Promise.resolve([]);
  if (path.startsWith("/deals")) return Promise.resolve([]);
  if (path.startsWith("/orders")) return Promise.resolve([]);
  if (path.startsWith("/carts")) return Promise.resolve([]);
  if (path.startsWith("/bookings")) return Promise.resolve([]);
  if (path.startsWith("/credit-balances")) return Promise.resolve([]);
  if (path.startsWith("/offers")) return Promise.resolve([]);
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
    postMock.mockReset();
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

  it("fetches and displays leads filtered by contactId", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/contacts/contact-1") return Promise.resolve(contact);
      if (path === "/leads?contactId=contact-1") {
        return Promise.resolve([
          {
            id: "lead-1",
            contactId: "contact-1",
            status: "new",
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

    expect(await screen.findByText("Nouveaux")).toBeInTheDocument();
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

  it("fetches and displays credit balances (package offer + remaining/total credits)", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/contacts/contact-1") return Promise.resolve(contact);
      if (path === "/credit-balances?contactId=contact-1") {
        return Promise.resolve([
          {
            id: "cb-1",
            contactId: "contact-1",
            offerId: "offer-1",
            totalCredits: 10,
            remainingCredits: 7,
          },
        ]);
      }
      if (path === "/offers?type=package") {
        return Promise.resolve([{ id: "offer-1", name: "10-session pass" }]);
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<ContactDetailPage />);

    expect(await screen.findByText("10-session pass")).toBeInTheDocument();
    expect(screen.getByText("7 / 10 séances")).toBeInTheDocument();
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
        type: "person",
        firstName: "Augusta",
        lastName: "Lovelace",
        email: "ada@example.com",
        phone: "0102030405",
        company: "Analytical Engines",
        tags: ["vip"],
        customFields: {},
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

  it("adds a note and refetches the notes list", async () => {
    postMock.mockResolvedValue({ id: "note-1" });
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />);
    await screen.findByRole("heading", { name: "Ada Lovelace" });

    await user.type(screen.getByLabelText("Contenu de la note"), "Rappeler demain");
    const notesForm = screen.getByLabelText("Contenu de la note").closest("form")!;
    await user.click(within(notesForm).getByRole("button", { name: "Ajouter" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/notes", {
        entity: "contact",
        entityId: "contact-1",
        content: "Rappeler demain",
      }),
    );
  });

  it("blocks adding an empty note and sends no request", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />);
    await screen.findByRole("heading", { name: "Ada Lovelace" });

    const notesForm = screen.getByLabelText("Contenu de la note").closest("form")!;
    await user.click(within(notesForm).getByRole("button", { name: "Ajouter" }));

    await waitFor(() => expect(postMock).not.toHaveBeenCalled());
  });

  it("adds a task with a due date, converted to an ISO string", async () => {
    postMock.mockResolvedValue({ id: "task-1" });
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />);
    await screen.findByRole("heading", { name: "Ada Lovelace" });

    await user.type(screen.getByLabelText("Titre de la tâche"), "Envoyer le devis");
    await user.type(screen.getByLabelText("Échéance"), "2026-09-01T10:00");
    const tasksForm = screen.getByLabelText("Titre de la tâche").closest("form")!;
    await user.click(within(tasksForm).getByRole("button", { name: "Ajouter" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/tasks", {
        entity: "contact",
        entityId: "contact-1",
        title: "Envoyer le devis",
        dueAt: new Date("2026-09-01T10:00").toISOString(),
      }),
    );
  });

  it("adds a task without a due date: dueAt is omitted from the payload", async () => {
    postMock.mockResolvedValue({ id: "task-1" });
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />);
    await screen.findByRole("heading", { name: "Ada Lovelace" });

    await user.type(screen.getByLabelText("Titre de la tâche"), "Relancer");
    const tasksForm = screen.getByLabelText("Titre de la tâche").closest("form")!;
    await user.click(within(tasksForm).getByRole("button", { name: "Ajouter" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/tasks", {
        entity: "contact",
        entityId: "contact-1",
        title: "Relancer",
      }),
    );
  });

  it("marks a pending task as done via PATCH and refetches the tasks list", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/contacts/contact-1") return Promise.resolve(contact);
      if (path === "/tasks?entity=contact&entityId=contact-1") {
        return Promise.resolve([
          {
            id: "task-1",
            title: "Envoyer le devis",
            status: "pending",
            createdAt: "",
            updatedAt: "",
          },
        ]);
      }
      return mockGetByPath(path);
    });
    patchMock.mockResolvedValue({ id: "task-1", status: "done" });
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Terminer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/tasks/task-1", { status: "done" }),
    );
  });

  it("adds an activity with the selected type and optional content", async () => {
    postMock.mockResolvedValue({ id: "activity-1" });
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />);
    await screen.findByRole("heading", { name: "Ada Lovelace" });

    await user.selectOptions(screen.getByLabelText("Type d'activité"), "call");
    await user.type(screen.getByLabelText("Détails de l'activité"), "Appel de suivi");
    const activityForm = screen.getByLabelText("Détails de l'activité").closest("form")!;
    await user.click(within(activityForm).getByRole("button", { name: "Ajouter" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/activities", {
        entity: "contact",
        entityId: "contact-1",
        type: "call",
        content: "Appel de suivi",
      }),
    );
  });

  describe("duplicate detection and merge", () => {
    const duplicate = {
      id: "contact-2",
      type: "person",
      firstName: "Ada",
      lastName: "L.",
      email: "ada@example.com",
      phone: "0102030405",
      tags: [],
    };

    function mockWithDuplicate() {
      getMock.mockImplementation((path: string) => {
        if (path === "/contacts/duplicates") {
          return Promise.resolve([
            { field: "email", value: "ada@example.com", contacts: [contact, duplicate] },
          ]);
        }
        return mockGetByPath(path);
      });
    }

    it("shows no duplicates section when there are no candidates", async () => {
      renderWithProviders(<ContactDetailPage />);
      await screen.findByRole("heading", { name: "Ada Lovelace" });
      expect(screen.queryByText("Doublons potentiels")).not.toBeInTheDocument();
    });

    it("lists a duplicate candidate found via a shared email/phone group", async () => {
      mockWithDuplicate();
      renderWithProviders(<ContactDetailPage />);
      await screen.findByRole("heading", { name: "Ada Lovelace" });

      expect(await screen.findByText("Doublons potentiels")).toBeInTheDocument();
      expect(screen.getByText("Ada L.")).toBeInTheDocument();
      expect(screen.getByText("ada@example.com · 0102030405")).toBeInTheDocument();
    });

    it("merges the duplicate into this contact after confirmation", async () => {
      mockWithDuplicate();
      postMock.mockResolvedValue(contact);
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />);
      await screen.findByRole("heading", { name: "Ada Lovelace" });
      await screen.findByText("Ada L.");

      await user.click(screen.getByRole("button", { name: "Fusionner" }));
      expect(postMock).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Confirmer la fusion" }));

      await waitFor(() =>
        expect(postMock).toHaveBeenCalledWith("/contacts/contact-1/merge", {
          duplicateContactId: "contact-2",
        }),
      );
    });

    it("shows a clear error when both contacts have their own customer account", async () => {
      mockWithDuplicate();
      postMock.mockRejectedValue(
        new ApiError(
          "CONTACT_MERGE_BOTH_HAVE_CUSTOMER_ACCOUNTS",
          "Both contacts have a customer account",
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />);
      await screen.findByRole("heading", { name: "Ada Lovelace" });
      await screen.findByText("Ada L.");

      await user.click(screen.getByRole("button", { name: "Fusionner" }));
      await user.click(screen.getByRole("button", { name: "Confirmer la fusion" }));

      expect(
        await screen.findByText(
          "Fusion impossible : ces deux contacts ont chacun leur propre compte client. Supprimez ou transférez l'un des deux comptes avant de réessayer.",
        ),
      ).toBeInTheDocument();
    });
  });
});
