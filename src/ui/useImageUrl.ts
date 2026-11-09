import { useState } from "react";

export function useImageUrl(url: string | null): readonly [string | null, () => void] {
  const [failed, setFailed] = useState<string | null>(null);
  return [url === failed ? null : url, () => setFailed(url)];
}
