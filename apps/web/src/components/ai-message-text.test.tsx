import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AiMessageText } from "./ai-message-text";

describe("AiMessageText", () => {
  it("shows bold and lists as such, without the asterisks", () => {
    const { container } = render(
      <AiMessageText
        text={"Le top des ventes :\n1. **Attiéké** : 21 000 XOF\n2. **Garba** : 1 000 XOF\n\nTotal : **22 000 XOF**."}
      />,
    );
    expect(container.textContent).not.toContain("**");
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(screen.getByText("22 000 XOF").tagName).toBe("STRONG");
  });

  it("never turns the model's text into markup", () => {
    const { container } = render(<AiMessageText text={'<img src=x onerror="alert(1)"> **ok**'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });
});
