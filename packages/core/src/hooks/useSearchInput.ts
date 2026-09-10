import { useCallback, useEffect, useState } from "react";

const DEBOUNCE_MS = 300;
const RECENT_LIMIT = 5;

export interface SearchInput {
  readonly input: string;
  setInput(value: string): void;
  readonly query: string;
  readonly settling: boolean;
  readonly recent: readonly string[];
  remember(query: string): void;
}

export function useSearchInput(): SearchInput {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<readonly string[]>([]);
  const trimmed = input.trim();

  useEffect(() => {
    const timer = setTimeout(() => setQuery(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const remember = useCallback((value: string) => {
    if (value.length === 0) return;
    setRecent((previous) =>
      [value, ...previous.filter((query) => query !== value)].slice(0, RECENT_LIMIT),
    );
  }, []);

  return {
    input,
    setInput,
    query,
    settling: trimmed.length > 0 && query !== trimmed,
    recent,
    remember,
  };
}
