export function parseId(raw: string | undefined): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function parseSeason(raw: string | undefined): number | null {
  return raw === "0" ? 0 : parseId(raw);
}
