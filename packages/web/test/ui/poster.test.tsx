import { Poster } from "@ui/screens/up-next/Poster";
import { act } from "react";
import { expect, it } from "vitest";
import { mount } from "./_mount";

it("leaves only the designed placeholder after an image error", () => {
  mount(
    <a href="/show/1">
      <Poster title="Broken Art" posters={["https://images.example/poster.jpg"]} variant="s48" />
    </a>,
  );

  const image = document.querySelector<HTMLImageElement>('[data-testid="poster-image"]');
  act(() => image?.dispatchEvent(new Event("error", { bubbles: true })));

  expect(document.querySelector('[data-testid="poster-image"]')).toBeNull();
  expect(document.querySelector(".poster__initials")).toHaveTextContent("BA");
  expect(document.querySelector("a button")).toBeNull();
});
