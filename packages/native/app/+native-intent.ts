import { dismissPresented } from "../src/enter-from-outside";

export async function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): Promise<string> {
  if (!initial) await dismissPresented();
  return path;
}
