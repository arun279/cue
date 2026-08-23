import type { UserSettings } from "./schemas";

/** The Profile identity row's model: who is signed in, by name and face. */
export interface UserProfile {
  readonly username: string;
  /** What the identity row prints: Trakt's optional display name, else the username. */
  readonly displayName: string;
  readonly avatar: string | null;
}

export function assembleUserProfile(settings: UserSettings): UserProfile {
  const { user } = settings;
  const name = user.name?.trim() ?? "";
  return {
    username: user.username,
    displayName: name === "" ? user.username : name,
    avatar: user.images?.avatar?.full ?? null,
  };
}
