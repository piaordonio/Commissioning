const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Parses the "YYYY-MM-DD" Postgres `date` string by hand rather than
// `new Date(iso)` -- that parses as UTC midnight, which renders as the
// previous day in any timezone behind UTC once formatted locally.
export function formatDateCommissioned(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH_ABBR[m - 1]}-${String(d).padStart(2, "0")}-${y}`;
}
