import type { UserSettings } from "./schemas";

export interface UserProfile {
  readonly username: string;
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
