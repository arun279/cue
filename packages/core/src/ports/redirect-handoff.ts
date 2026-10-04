export interface RedirectHandoff {
  read(): { readonly state: string; readonly verifier: string } | null;
  write(state: string, verifier: string): void;
  clear(): void;
}
