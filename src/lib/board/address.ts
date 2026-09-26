/** One-line address of a card for lists and the board (Incident.address is JSON written by the workstations). */
export function formatAddress(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return typeof raw === "string" && raw ? raw : null;
  const a = raw as Record<string, unknown>;
  const str = (k: string) => (typeof a[k] === "string" && a[k] ? String(a[k]) : null);
  const main = [
    str("city"),
    str("district") && str("okrug") ? `(${str("okrug")}, ${str("district")})` : str("district"),
    str("street"),
    str("house") && `д. ${str("house")}`,
    str("building") && `корп. ${str("building")}`,
    str("structure") && `стр. ${str("structure")}`,
    str("entrance") && `под. ${str("entrance")}`,
    str("flat") && `кв. ${str("flat")}`,
  ].filter(Boolean);
  if (main.length > 1 || (main.length === 1 && !str("descriptive"))) {
    const d = str("descriptive");
    return d ? `${main.join(", ")} · ${d}` : main.join(", ");
  }
  return str("descriptive") ?? (main[0] || null);
}
