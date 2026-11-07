"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Icon } from "@/components/Icon";
import { NotesCell } from "@/components/NotesCell";
import { Pagination } from "@/components/Pagination";
import { StatusPill } from "@/components/Pill";
import { AcknowledgementCell } from "@/components/enrollments/AcknowledgementCell";
import { FollowUpLogModal } from "@/components/enrollments/FollowUpLogModal";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { fmtDate, todayISO } from "@/lib/utils";
import type { Enrollment } from "@/types/enrollments";
import { applyColumnFilters, ColumnFilterRow, type ColumnFilters, type ColumnKey, type Sort } from "@/components/enrollments/EnrollmentColumnFilters";

const PAGE_SIZE = 10;

/**
 * Provider portal → My Enrollments: the provider's own enrollments with the same columns as the admin Enrollments list
 * (no actions). Read-only: the notes, the call / email follow-ups and the acknowledgement can be viewed, not changed.
 */
export function MyEnrollmentsTable({ onLoaded, onFiltering }: { onLoaded?: (list: Enrollment[]) => void; onFiltering?: (clear: (() => void) | null) => void }) {
  const q = useAsync<Enrollment[]>(async () => {
    const list = await api.get<Enrollment[]>("/me/enrollments/full");
    onLoaded?.(list);
    return list;
  }, []);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<Sort>(null);
  const changeFilter = (key: ColumnKey, v: string) => {
    setFilters((f) => ({ ...f, [key]: v }));
    setPage(0);
  };
  const anyFilter = Object.values(filters).some((v) => (v || "").trim()) || sort !== null;
  // the page header shows "Clear filters and sorting" while a filter or sort is on (so the table doesn't move)
  useEffect(() => {
    onFiltering?.(
      anyFilter
        ? () => {
            setFilters({});
            setSort(null);
            setPage(0);
          }
        : null,
    );
  }, [anyFilter, onFiltering]);
  const [touches, setTouches] = useState<{ enrollment: Enrollment; type: "call" | "email" } | null>(null);

  // the list fills the window down to the bottom: the rows scroll inside it, pagination stays below
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const fit = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    const pad = el.closest(".main-pad");
    const bottom = pad ? parseFloat(getComputedStyle(pad).paddingBottom) || 0 : 32;
    const top = el.getBoundingClientRect().top + window.scrollY;
    setCardHeight(Math.max(280, Math.floor(window.innerHeight - top - bottom)));
  }, []);
  useEffect(() => {
    fit();
    window.addEventListener("resize", fit);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => fit());
    ro?.observe(document.body);
    return () => {
      window.removeEventListener("resize", fit);
      ro?.disconnect();
    };
  }, [fit]);

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  const everything = q.data || [];
  const all = applyColumnFilters(everything, filters, sort);
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const current = Math.min(page, totalPages - 1);
  const rows = all.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  return (
    <>
      <div
        ref={(el) => {
          cardRef.current = el;
          if (el && cardHeight === null) requestAnimationFrame(fit);
        }}
        className="card overflow-hidden flex flex-col"
        style={{ height: cardHeight ?? "calc(100vh - 260px)", minHeight: 280 }}
        data-my-enrollments
      >
        {!q.data ? (
          <Loading />
        ) : everything.length === 0 ? (
          <EmptyState icon="ClipboardList" title="No enrollments yet" description="Your organization hasn't started any payer enrollments for you yet." />
        ) : (
          <>
            <div className="table-scroll flex-1 min-h-0" style={{ overflow: "auto" }}>
              <table className="sticky-head">
                <thead>
                  <ColumnFilterRow filters={filters} sort={sort} onFilter={changeFilter} onSort={(x) => { setSort(x); setPage(0); }} />
                  <tr className="label-row">
                    <th>Provider</th>
                    <th>Payer</th>
                    <th>Status</th>
                    <th style={{ whiteSpace: "nowrap" }}>Submitted</th>
                    <th style={{ whiteSpace: "nowrap" }}>Approved</th>
                    <th>TAT</th>
                    <th style={{ whiteSpace: "nowrap" }}>Last Follow Up</th>
                    <th style={{ whiteSpace: "nowrap" }}>Next Follow Up</th>
                    <th>Follow-ups</th>
                    <th>Notes</th>
                    <th>Acknowledgement</th>
                  </tr>
                </thead>
                <tbody>
                  {all.length === 0 && (
                    <tr>
                      <td colSpan={11} className="text-center text-sm text-ink-light py-10" data-no-match>
                        No enrollments match these filters.
                      </td>
                    </tr>
                  )}
                  {rows.map((e) => (
                    <tr key={e.id} data-my-enrollment={e.id}>
                      <td>
                        <div className="flex items-center gap-2" style={{ minWidth: 150 }}>
                          <Avatar name={e.providerName} size={26} />
                          <span className="text-sm font-medium">{e.providerName}</span>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2" style={{ minWidth: 120 }}>
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: e.payerColor || "var(--ink-light)" }}></div>
                          <span className="text-sm">{e.payerName || "—"}</span>
                        </div>
                      </td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          <StatusPill status={e.status} />
                          {e.workflowStatus && (
                            <span className="text-[11px] text-ink-faint" style={{ whiteSpace: "nowrap" }}>
                              {e.workflowStatus}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-xs text-ink-light" style={{ whiteSpace: "nowrap" }}>{e.submittedDate ? fmtDate(e.submittedDate) : "—"}</td>
                      <td className="text-xs text-ink-light" style={{ whiteSpace: "nowrap" }}>{e.effectiveDate ? fmtDate(e.effectiveDate) : "—"}</td>
                      <td className="font-mono text-xs">{e.tatDays ? e.tatDays + "d" : "—"}</td>
                      <td className="text-xs text-ink-light" style={{ whiteSpace: "nowrap" }}>{e.followUpDate ? fmtDate(e.followUpDate) : "—"}</td>
                      <td className="text-xs" style={{ whiteSpace: "nowrap" }}>
                        {e.nextFollowUpDate ? (
                          e.nextFollowUpDate < todayISO() && e.status !== "approved" ? (
                            <span className="font-semibold" style={{ color: "var(--danger)" }}>{fmtDate(e.nextFollowUpDate)} · overdue</span>
                          ) : (
                            <span className="text-ink-light">{fmtDate(e.nextFollowUpDate)}</span>
                          )
                        ) : (
                          <span className="text-ink-light">—</span>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <div className="flex items-center gap-1">
                          <button
                            className="btn btn-ghost text-xs"
                            style={{ padding: "3px 7px" }}
                            onClick={() => setTouches({ enrollment: e, type: "call" })}
                            title="Call follow-ups"
                            aria-label={"Call follow-ups of " + (e.payerName || "")}
                            data-calls={e.callCount || 0}
                          >
                            <Icon name="Phone" size={12} /> {e.callCount || 0}
                          </button>
                          <button
                            className="btn btn-ghost text-xs"
                            style={{ padding: "3px 7px" }}
                            onClick={() => setTouches({ enrollment: e, type: "email" })}
                            title="Email follow-ups"
                            aria-label={"Email follow-ups of " + (e.payerName || "")}
                            data-emails={e.emailCount || 0}
                          >
                            <Icon name="Mail" size={12} /> {e.emailCount || 0}
                          </button>
                        </div>
                      </td>
                      <td>
                        <NotesCell<Enrollment>
                          notes={e.notes}
                          updatedAt={e.notesUpdatedAt}
                          updatedBy={e.notesUpdatedBy}
                          path={"/enrollments/" + e.id + "/notes"}
                          title={"Notes · " + (e.payerName || "")}
                          canEdit={false}
                          onSaved={q.reload}
                        />
                      </td>
                      <td>
                        <AcknowledgementCell enrollment={e} canUpload={false} onUploaded={q.reload} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line flex-shrink-0" data-pagination>
              <Pagination page={current} totalPages={totalPages} totalElements={all.length} size={PAGE_SIZE} onChange={setPage} />
            </div>
          </>
        )}
      </div>
      {touches && <FollowUpLogModal enrollment={touches.enrollment} type={touches.type} onClose={() => setTouches(null)} />}
    </>
  );
}
