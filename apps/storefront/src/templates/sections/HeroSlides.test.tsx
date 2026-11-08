import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HeroSlides, heroImagesOf } from "./HeroSlides";

describe("HeroSlides", () => {
  it("is a single photo without dots when there is one", () => {
    const { container } = render(<HeroSlides images={["https://cdn.test/1.jpg"]} />);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows one photo at a time with a dot to choose each", () => {
    const { container } = render(
      <HeroSlides images={["https://cdn.test/1.jpg", "https://cdn.test/2.jpg", "https://cdn.test/3.jpg"]} />,
    );
    const visible = () => [...container.querySelectorAll("img")].filter((img) => img.classList.contains("opacity-100"));
    expect(visible()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Photo 3 sur 3" }));
    expect(visible()[0]?.getAttribute("src")).toContain("3.jpg");
  });

  it("drops a broken photo and renders nothing once none is left", () => {
    const { container } = render(<HeroSlides images={["https://cdn.test/broken.jpg"]} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container).toBeEmptyDOMElement();
  });

  it("puts the main photo first, then the Business slideshow", () => {
    expect(heroImagesOf({ heroImage: "a", heroSlides: ["b", "c"] })).toEqual(["a", "b", "c"]);
    expect(heroImagesOf({ heroSlides: ["b"] })).toEqual(["b"]);
  });
});
