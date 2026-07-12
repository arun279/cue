import { assembleUserProfile } from "@data/trakt/user-profile";
import { describe, expect, it } from "vitest";

describe("assembleUserProfile", () => {
  it("prefers the display name and carries the avatar URL", () => {
    expect(
      assembleUserProfile({
        user: {
          username: "sean",
          name: "Sean Porter",
          images: { avatar: { full: "https://media.trakt.tv/avatar.jpg" } },
        },
      }),
    ).toEqual({
      username: "sean",
      displayName: "Sean Porter",
      avatar: "https://media.trakt.tv/avatar.jpg",
    });
  });

  it("falls back to the username when the name is absent or blank", () => {
    expect(assembleUserProfile({ user: { username: "sean" } }).displayName).toBe("sean");
    expect(assembleUserProfile({ user: { username: "sean", name: "  " } }).displayName).toBe(
      "sean",
    );
  });

  it("nulls the avatar when the images block is missing", () => {
    expect(assembleUserProfile({ user: { username: "sean" } }).avatar).toBeNull();
    expect(assembleUserProfile({ user: { username: "sean", images: {} } }).avatar).toBeNull();
  });
});
