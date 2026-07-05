import { expect, test } from "@playwright/test";

test("app shell renders with title Cue and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  await page.goto("/");

  await expect(page).toHaveTitle("Cue");
  await expect(page.getByRole("heading", { name: "Cue" })).toBeVisible();
  await expect(page.getByTestId("health")).toContainText("status: ok");
  expect(errors).toEqual([]);
});
