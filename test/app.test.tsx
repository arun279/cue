import { render, screen } from "@testing-library/react";
import { App } from "@ui/App";
import { describe, expect, it } from "vitest";

describe("App", () => {
  it("renders the product name and an injected platform in the health line", () => {
    render(<App platform="web" />);
    expect(screen.getByRole("heading", { name: "Cue" })).toBeInTheDocument();
    expect(screen.getByTestId("health")).toHaveTextContent(
      "status: ok · platform: web · cue: S01E01",
    );
  });
});
