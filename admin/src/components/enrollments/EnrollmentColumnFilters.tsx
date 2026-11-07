"use client";

import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { STATUS } from "@/lib/constants";
import { fmtDate, fmtDateShort, todayISO } from "@/lib/utils";
import type { Enrollment } from "@/types/enrollments";

/**
 * Enrollments lists (admin Enrollments, provider My Enrollments): a filter box with ↑ / ↓ sort buttons above every column. A box matches what the column shows
 * (dates also as MM/DD/YYYY); Status, Follow-ups and Acknowledgement are dropdowns instead.
 * The arrows sort by that column (dates and numbers by their value); Notes is free text, so it has no sorting.
 */
export type ColumnKey = "provider" | "payer" | "status" | "submitted" | "approved" | "tat" | "last" | "next" | "followups" | "notes" | "ack";
export type ColumnFilters = Partial<Record<ColumnKey, string>>;
export type Sort = { key: ColumnKey; dir: "asc" | "desc" } | null;

const statusLabel = (s: string) => STATUS[s]?.label || s.replace(/_/g, " ");
const date = (v: string | null | undefined) => (v ? fmtDate(v) + " " + fmtDateShort(v) : "");

type Choice = { value: string; label: string; match: (e: Enrollment) => boolean };
const calls = (e: Enrollment) => e.callCount || 0;
const emails = (e: Enrollment) => e.emailCount || 0;

export const COLUMNS: { key: ColumnKey; label: string; text: (e: Enrollment) => string; sort?: (e: Enrollment) => string | number; width: number; choices?: Choice[] }[] = [
  { key: "provider", label: "Provider", text: (e) => e.providerName || "", sort: (e) => (e.providerName || "").toLowerCase(), width: 170 },
  { key: "payer", label: "Payer", text: (e) => e.payerName || "", sort: (e) => (e.payerName || "").toLowerCase(), width: 140 },
  {
    key: "status",
    label: "Status",
    text: () => "",
    sort: (e) => statusLabel(e.status),
    width: 200,
    choices: Object.entries(STATUS).map(([value, { label }]) => ({ value, label, match: (e: Enrollment) => e.status === value })),
  },
  { key: "submitted", label: "Submitted", text: (e) => date(e.submittedDate), sort: (e) => e.submittedDate || "", width: 150 },
  { key: "approved", label: "Approved", text: (e) => date(e.effectiveDate), sort: (e) => e.effectiveDate || "", width: 150 },
  { key: "tat", label: "TAT", text: (e) => (e.tatDays ? e.tatDays + "d " + e.tatDays : ""), sort: (e) => e.tatDays ?? -1, width: 115 },
  { key: "last", label: "Last Follow Up", text: (e) => date(e.followUpDate), sort: (e) => e.followUpDate || "", width: 180 },
  {
    key: "next",
    label: "Next Follow Up",
    text: (e) => date(e.nextFollowUpDate) + (e.nextFollowUpDate && e.nextFollowUpDate < todayISO() && e.status !== "approved" ? " overdue" : ""),
    sort: (e) => e.nextFollowUpDate || "",
    width: 180,
  },
  {
    key: "followups",
    label: "Follow-ups",
    text: () => "",
    sort: (e) => calls(e) + emails(e),
    width: 215,
    choices: [
      { value: "calls", label: "With calls", match: (e) => calls(e) > 0 },
      { value: "emails", label: "With emails", match: (e) => emails(e) > 0 },
      { value: "none", label: "No follow-ups yet", match: (e) => calls(e) + emails(e) === 0 },
    ],
  },
  { key: "notes", label: "Notes", text: (e) => e.notes || "", width: 180 },
  {
    key: "ack",
    label: "Acknowledgement",
    text: () => "",
    sort: (e) => (e.acknowledgementFileId ? 1 : 0),
    width: 185,
    choices: [
      { value: "uploaded", label: "Uploaded", match: (e) => !!e.acknowledgementFileId },
      { value: "missing", label: "Not uploaded", match: (e) => !e.acknowledgementFileId },
    ],
  },
];

export function applyColumnFilters(list: Enrollment[], filters: ColumnFilters, sort: Sort): Enrollment[] {
  const active = COLUMNS.filter((c) => (filters[c.key] || "").trim());
  let out = active.length
    ? list.filter((e) =>
        active.every((c) => {
          const v = filters[c.key]!.trim();
          if (c.choices) return c.choices.find((o) => o.value === v)?.match(e) ?? true;
          return c.text(e).toLowerCase().includes(v.toLowerCase());
        }),
      )
    : list.slice();
  const sortBy = sort && COLUMNS.find((c) => c.key === sort.key)?.sort;
  if (sort && sortBy) {
    const k = sort.dir === "asc" ? 1 : -1;
    out = out.sort((a, b) => {
      const x = sortBy(a), y = sortBy(b);
      // empty values always last
      const ex = x === "" || x === -1, ey = y === "" || y === -1;
      if (ex !== ey) return ex ? 1 : -1;
      return x < y ? -k : x > y ? k : 0;
    });
  }
  return out;
}

/** The admin list filters on the server (it is paged there): the same filters / sort as query parameters. */
const SERVER_SORT: Record<ColumnKey, string> = { provider: "provider", payer: "payer", status: "status", submitted: "submitted", approved: "approved", tat: "tat", last: "last", next: "next", followups: "followups", notes: "", ack: "ack" };
export function columnQuery(filters: ColumnFilters, sort: Sort): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of COLUMNS) {
    const v = (filters[c.key] || "").trim();
    if (!v) continue;
    if (c.key === "status") out.status = v;
    else out["f." + c.key] = v;
  }
  out.sort = sort && SERVER_SORT[sort.key] ? SERVER_SORT[sort.key] + "," + sort.dir : "createdAt,desc";
  return out;
}

/** The row of filter boxes and sort arrows, above the column headings (sticky with them); `extraCells` pads trailing columns (Actions). */
export function ColumnFilterRow({ filters, sort, onFilter, onSort, extraCells = 0 }: { filters: ColumnFilters; sort: Sort; onFilter: (key: ColumnKey, v: string) => void; onSort: (s: Sort) => void; extraCells?: number }) {
  const arrow = (key: ColumnKey, dir: "asc" | "desc") => {
    const on = sort?.key === key && sort.dir === dir;
    return (
      <button
        type="button"
        onClick={() => onSort(on ? null : { key, dir })}
        className="p-0.5 rounded hover:bg-white"
        title={(dir === "asc" ? "Sort ascending" : "Sort descending") + (on ? " (click again to clear)" : "")}
        aria-label={(dir === "asc" ? "Sort ascending by " : "Sort descending by ") + COLUMNS.find((c) => c.key === key)!.label}
        aria-pressed={on}
        style={{ color: on ? "var(--accent)" : "var(--ink-faint)" }}
      >
        <Icon name={dir === "asc" ? "ArrowUp" : "ArrowDown"} size={13} strokeWidth={on ? 3 : 2} />
      </button>
    );
  };
  return (
    <tr className="filter-row" data-column-filters>
      {COLUMNS.map((c) => (
        <th key={c.key} style={{ minWidth: c.width, padding: "8px 8px", height: 50, background: "var(--bg-soft-2, #eef3f8)", textTransform: "none", letterSpacing: 0 }} data-column={c.key}>
          <div className="flex items-center gap-1">
            {c.choices ? (
              <div className="flex-1 min-w-0">
                <Select
                  value={filters[c.key] || ""}
                  onChange={(e) => onFilter(c.key, e.target.value)}
                  className="input text-xs"
                  style={{ padding: "5px 8px", background: "var(--bg)", fontWeight: 400 }}
                  aria-label={"Filter " + c.label}
                >
                  <option value="">All</option>
                  {c.choices.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <input
                value={filters[c.key] || ""}
                onChange={(e) => onFilter(c.key, e.target.value.slice(0, 60))}
                className="input text-xs flex-1 min-w-0"
                style={{ padding: "5px 8px", background: "var(--bg)", fontWeight: 400 }}
                placeholder={c.label}
                aria-label={"Filter " + c.label}
              />
            )}
            {c.sort && arrow(c.key, "asc")}
            {c.sort && arrow(c.key, "desc")}
          </div>
        </th>
      ))}
      {Array.from({ length: extraCells }, (_, i) => (
        <th key={"extra" + i} style={{ background: "var(--bg-soft-2, #eef3f8)" }} />
      ))}
    </tr>
  );
}
