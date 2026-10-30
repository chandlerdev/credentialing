// Formatting helpers ported from the prototype (fmtDate, fmtDateShort, fmtTs, daysBetween).

const parse = (d: string | Date) => {
  if (d instanceof Date) return d;
  // date-only strings are treated as local dates (avoid UTC off-by-one)
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m - 1, day);
  }
  return new Date(d);
};

export const fmtDate = (d?: string | Date | null) => {
  if (!d) return "—";
  const date = parse(d);
  if (isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export const fmtDateShort = (d?: string | Date | null) => {
  if (!d) return "—";
  const date = parse(d);
  if (isNaN(date.getTime())) return String(d);
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return m + "/" + day + "/" + date.getFullYear();
};

export const fmtTs = (ts?: string | Date | null) => {
  if (!ts) return "—";
  const d = parse(ts);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

/** The viewer's time-zone abbreviation for a moment: IST, EST / EDT, CST / CDT, PST… (else e.g. GMT+4). */
export const tzAbbr = (d: Date) => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone === "Asia/Kolkata" || zone === "Asia/Calcutta") return "IST";
  return new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value || "";
};

/** A date and time with the time zone it is shown in: "Oct 30, 2026, 7:21 AM IST". */
export const fmtTsZone = (ts?: string | Date | null) => {
  if (!ts) return "—";
  const d = parse(ts);
  if (isNaN(d.getTime())) return String(ts);
  return fmtTs(d) + " " + tzAbbr(d);
};

export const todayISO = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

export const daysBetween = (a?: string | Date | null, b?: string | Date | null) => {
  if (!a || !b) return 0;
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
};

export const daysFromNow = (d?: string | null) => (d ? daysBetween(todayISO(), d) : null);

export const fmtMoney = (n?: number | string | null) => {
  const v = Number(n || 0);
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const fmtMoney0 = (n?: number | string | null) => "$" + Number(n || 0).toLocaleString("en-US");

export const fmtDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
};

export const fullName = (p?: { firstName?: string | null; lastName?: string | null } | null) =>
  p ? [p.firstName, p.lastName].filter(Boolean).join(" ") : "";

/** Search box input: drops leading spaces and collapses repeated spaces, so a search of only spaces is never accepted. */
export const cleanSearch = (v: string) => v.replace(/^\s+/, "").replace(/\s{2,}/g, " ");
