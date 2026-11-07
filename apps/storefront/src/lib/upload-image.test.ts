import { describe, expect, it } from "vitest";
import { uploadImage } from "./upload-image";

describe("uploadImage", () => {
  it("offers the API's resized widths for an uploaded photo", () => {
    expect(uploadImage("https://api.korvasuite.com/api/v1/uploads/o/p.jpg", [320, 640], "50vw")).toEqual({
      src: "https://api.korvasuite.com/api/v1/uploads/o/p.jpg?w=640",
      srcSet:
        "https://api.korvasuite.com/api/v1/uploads/o/p.jpg?w=320 320w, https://api.korvasuite.com/api/v1/uploads/o/p.jpg?w=640 640w",
      sizes: "50vw",
    });
  });

  it("leaves an external address alone", () => {
    expect(uploadImage("https://images.example.com/x.jpg", [320], "50vw")).toEqual({ src: "https://images.example.com/x.jpg" });
  });
});
