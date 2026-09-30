const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Parses the "YYYY-MM-DD" Postgres `date` string by hand rather than
// `new Date(iso)` -- that parses as UTC midnight, which renders as the
// previous day in any timezone behind UTC once formatted locally.
export function formatDateCommissioned(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH_ABBR[m - 1]}-${String(d).padStart(2, "0")}-${y}`;
}

// For a Postgres `timestamptz` (e.g. issues.created_at) -- unlike the plain
// `date` case above, this already carries a real instant, so new Date(iso)
// is safe and doesn't need the hand-parsing workaround.
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return `${MONTH_ABBR[d.getMonth()]}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;
}
