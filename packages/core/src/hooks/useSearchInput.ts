import { useEffect, useState } from "react";

const DEBOUNCE_MS = 300;

const DWELL_MS = 1500;

const RECENT_LIMIT = 5;

export interface SearchInput {
  readonly input: string;
  setInput(value: string): void;
  readonly query: string;
  readonly settling: boolean;
  readonly recent: readonly string[];
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

  useEffect(() => {
    if (query.length === 0) return;
    const timer = setTimeout(
      () =>
        setRecent((previous) =>
          [query, ...previous.filter((term) => term !== query)].slice(0, RECENT_LIMIT),
        ),
      DWELL_MS,
    );
    return () => clearTimeout(timer);
  }, [query]);

  return {
    input,
    setInput,
    query,
    settling: trimmed.length > 0 && query !== trimmed,
    recent,
  };
}
