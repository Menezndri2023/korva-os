import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OFFER_MAX_IMAGES } from "@korva/validation";
import { OfferImagesEditor } from "./offer-images-editor";
import { ApiError, uploadFile } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, uploadFile: vi.fn() };
});

const uploadMock = vi.mocked(uploadFile);

function photo(name: string, type = "image/png", size = 1024) {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/** The editor is controlled; this harness owns the array and exposes it for assertions. */
function Harness({ initial, onChange }: { initial: string[]; onChange?: (next: string[]) => void }) {
  const [images, setImages] = useState(initial);
  return (
    <OfferImagesEditor
      images={images}
      onChange={(next) => {
        setImages(next);
        onChange?.(next);
      }}
    />
  );
}

function photoSources() {
  return screen.queryAllByRole("img").map((img) => img.getAttribute("src"));
}

describe("OfferImagesEditor", () => {
  beforeEach(() => {
    uploadMock.mockReset();
    let counter = 0;
    uploadMock.mockImplementation(() => {
      counter += 1;
      return Promise.resolve({
        url: `https://api.test/uploads/org/${counter}.png`,
        filename: `${counter}.png`,
        mimeType: "image/png",
        size: 1024,
      });
    });
  });

  it("uploads several photos at once and appends them in order", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[]} />);

    await user.upload(screen.getByLabelText("Choisir des photos"), [photo("a.png"), photo("b.png")]);

    await waitFor(() =>
      expect(photoSources()).toEqual([
        "https://api.test/uploads/org/1.png",
        "https://api.test/uploads/org/2.png",
      ]),
    );
    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText(`(2/${OFFER_MAX_IMAGES})`)).toBeInTheDocument();
  });

  it("marks the first photo as the main one and can promote another", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["https://x/1.png", "https://x/2.png", "https://x/3.png"]} />);

    await user.click(screen.getAllByRole("button", { name: "Principale" })[1]);

    expect(photoSources()).toEqual(["https://x/3.png", "https://x/1.png", "https://x/2.png"]);
  });

  it("moves a photo and removes one", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["https://x/1.png", "https://x/2.png"]} />);

    await user.click(screen.getByRole("button", { name: "Déplacer la photo 1 vers la droite" }));
    expect(photoSources()).toEqual(["https://x/2.png", "https://x/1.png"]);

    await user.click(screen.getByRole("button", { name: "Retirer la photo 1" }));
    expect(photoSources()).toEqual(["https://x/1.png"]);
  });

  it("never goes past the per-offer maximum, and says so", async () => {
    const full = Array.from({ length: OFFER_MAX_IMAGES - 1 }, (_, i) => `https://x/${i}.png`);
    const user = userEvent.setup();
    render(<Harness initial={full} />);

    await user.upload(screen.getByLabelText("Choisir des photos"), [photo("a.png"), photo("b.png")]);

    await waitFor(() => expect(photoSources()).toHaveLength(OFFER_MAX_IMAGES));
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(new RegExp(`${OFFER_MAX_IMAGES} photos maximum`))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajouter des photos" })).toBeDisabled();
  });

  it("refuses a wrong format or an oversized file before uploading it", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness initial={[]} />);

    await user.upload(screen.getByLabelText("Choisir des photos"), [
      photo("doc.pdf", "application/pdf"),
      photo("huge.png", "image/png", 6 * 1024 * 1024),
    ]);

    expect(await screen.findByText(/Formats acceptés/)).toBeInTheDocument();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(photoSources()).toEqual([]);
  });

  it("keeps the photos already sent when a later upload fails", async () => {
    uploadMock
      .mockResolvedValueOnce({
        url: "https://api.test/uploads/org/ok.png",
        filename: "ok.png",
        mimeType: "image/png",
        size: 1024,
      })
      .mockRejectedValueOnce(new ApiError("STORAGE_ERROR", "Stockage indisponible"));
    const user = userEvent.setup();
    render(<Harness initial={[]} />);

    await user.upload(screen.getByLabelText("Choisir des photos"), [photo("a.png"), photo("b.png")]);

    expect(await screen.findByText(/Stockage indisponible/)).toBeInTheDocument();
    expect(photoSources()).toEqual(["https://api.test/uploads/org/ok.png"]);
  });
});
