"use client";

import { Select } from "@/components/Select";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccessDenied } from "@/components/AlertBox";
import { Avatar } from "@/components/Avatar";
import { ConfirmDialog } from "@/components/Modal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Icon } from "@/components/Icon";
import { NotesCell } from "@/components/NotesCell";
import { AcknowledgementCell } from "./AcknowledgementCell";
import { FollowUpLogModal } from "./FollowUpLogModal";
import { PageHeader } from "@/components/PageHeader";
import { Pagination } from "@/components/Pagination";
import { StatusPill } from "@/components/Pill";
import { api, errorMessage } from "@/lib/api";
import { useAuth, useUser } from "@/stores/auth";
import { useAsync, useDebounced } from "@/lib/hooks";
import { fmtDate, cleanSearch, todayISO } from "@/lib/utils";
import { useToast } from "@/stores/toast";
import { useShell, useTopic } from "@/stores/shell";
import type { PageResponse } from "@/types";
import { EnrollmentFormModal } from "@/components/modals/EnrollmentFormModal";
import type { Enrollment, EnrollmentSummary } from "@/types/enrollments";

const PAGE_SIZE = 10;

/** Port of the prototype EnrollmentsView (L14126). */
export function EnrollmentsView() {
  const { can } = useAuth();
  const user = useUser();
  const toast = useToast();
  const { publish } = useShell();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Enrollment | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<Enrollment | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // the list fills the window down to the bottom (no page scroll): the rows scroll inside it, pagination stays below
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
    // re-fit when anything above the list changes height (subtitle / filters loading, wrapping on small screens)
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => fit());
    ro?.observe(document.body);
    return () => {
      window.removeEventListener("resize", fit);
      ro?.disconnect();
    };
  }, [fit]);
  const [touches, setTouches] = useState<{ enrollment: Enrollment; type: "call" | "email" } | null>(null);
  const q = useDebounced(search);
  const allowed = can("list", "enrollment");

  const list = useAsync<PageResponse<Enrollment>>(
    allowed ? () => api.get("/enrollments", { q, status: statusFilter, page, size: PAGE_SIZE, sort: "createdAt,desc" }) : null,
    [allowed, q, statusFilter, page]
  );
  const summary = useAsync<EnrollmentSummary>(allowed ? () => api.get("/enrollments/summary") : null, [allowed]);
  const reloadAll = () => {
    list.reload();
    summary.reload();
  };
  useTopic("enrollments", reloadAll);

  if (!allowed) return <AccessDenied action="list" entity="enrollment" role={user.role} />;

  const doDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete("/enrollments/" + deleting.id);
      toast("Enrollment deleted");
      setDeleting(null);
      publish("enrollments");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setDeleteBusy(false);
    }
  };

  const s = summary.data;
  const rows = list.data?.content || [];

  return (
    <div>
      <PageHeader
        title="Enrollments"
        subtitle={s ? s.total + " total · " + s.approved + " approved · " + s.active + " active" : " "}
        actions={
          can("create", "enrollment") && (
            <button
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
              className="btn btn-primary"
            >
              <Icon name="Plus" size={13} /> New Enrollment
            </button>
          )
        }
      />

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-xs" style={{ minWidth: 200 }}>
          <Icon name="Search" size={14} className="absolute" style={{ left: 10, top: 10, color: "var(--ink-faint)" }} />
          <input
            value={search}
            onChange={(e) => {
              setSearch(cleanSearch(e.target.value));
              setPage(0);
            }}
            placeholder="Search provider or payer..."
            className="input"
            style={{ paddingLeft: 32 }}
          />
        </div>
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
          className="input"
          style={{ width: 180 }}
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="in_progress">In Progress</option>
          <option value="submitted">Submitted</option>
          <option value="approved">Approved</option>
          <option value="needs_attention">Needs Attention</option>
          <option value="on_hold">On Hold</option>
          <option value="terminated">Terminated</option>
        </Select>
      </div>

      {list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : (
        <div
          ref={(el) => {
            cardRef.current = el;
            if (el && cardHeight === null) requestAnimationFrame(fit);
          }}
          className="card overflow-hidden flex flex-col"
          style={{ height: cardHeight ?? "calc(100vh - 260px)", minHeight: 280 }}
          data-enrollments-card
        >
          {list.loading && !list.data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <EmptyState icon="ClipboardList" title="No enrollments match" />
          ) : (
            <>
              <div className="table-scroll flex-1 min-h-0" style={{ overflow: "auto" }}>
                <table className="sticky-head">
                  <thead>
                    <tr>
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
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody style={list.loading ? { opacity: 0.6 } : undefined}>
                    {rows.map((e) => (
                      <tr key={e.id}>
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
                              <span className="text-[11px] text-ink-faint" style={{ whiteSpace: "nowrap" }} title="Payer Submission workflow" data-workflow-status>
                                {e.workflowStatus}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="text-xs text-ink-light" style={{ whiteSpace: "nowrap" }}>{e.submittedDate ? fmtDate(e.submittedDate) : "—"}</td>
                        <td className="text-xs text-ink-light" style={{ whiteSpace: "nowrap" }}>{e.effectiveDate ? fmtDate(e.effectiveDate) : "—"}</td>
                        <td className="font-mono text-xs">{e.tatDays ? e.tatDays + "d" : "—"}</td>
                        <td className="text-xs text-ink-light" style={{ whiteSpace: "nowrap" }} data-last-follow-up>{e.followUpDate ? fmtDate(e.followUpDate) : "—"}</td>
                        <td className="text-xs" style={{ whiteSpace: "nowrap" }} data-next-follow-up>
                          {e.nextFollowUpDate ? (
                            e.nextFollowUpDate < todayISO() && e.status !== "approved" ? (
                              <span className="font-semibold" style={{ color: "var(--danger)" }} title="Overdue">
                                {fmtDate(e.nextFollowUpDate)} · overdue
                              </span>
                            ) : e.nextFollowUpDate === todayISO() ? (
                              <span className="font-semibold" style={{ color: "#a16207" }}>{fmtDate(e.nextFollowUpDate)} · today</span>
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
                              aria-label={"Call follow-ups of " + e.providerName + " → " + (e.payerName || "")}
                              data-calls={e.callCount || 0}
                            >
                              <Icon name="Phone" size={12} /> {e.callCount || 0}
                            </button>
                            <button
                              className="btn btn-ghost text-xs"
                              style={{ padding: "3px 7px" }}
                              onClick={() => setTouches({ enrollment: e, type: "email" })}
                              title="Email follow-ups"
                              aria-label={"Email follow-ups of " + e.providerName + " → " + (e.payerName || "")}
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
                            title={"Notes · " + e.providerName + " → " + (e.payerName || "")}
                            canEdit={can("update", "enrollment")}
                            onSaved={list.reload}
                          />
                        </td>
                        <td>
                          <AcknowledgementCell enrollment={e} canUpload={can("update", "enrollment")} onUploaded={list.reload} />
                        </td>
                        <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                          {can("update", "enrollment") && (
                            <button
                              onClick={() => {
                                setEditing(e);
                                setShowForm(true);
                              }}
                              className="btn btn-ghost text-xs"
                            >
                              <Icon name="Edit" size={11} /> Edit
                            </button>
                          )}
                          {can("delete", "enrollment") && (
                            <button onClick={() => setDeleting(e)} className="btn-ghost p-1 hover:text-danger" aria-label="Delete enrollment">
                              <Icon name="Trash2" size={11} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {list.data && (
                <div className="border-t border-line flex-shrink-0" data-pagination>
                <Pagination page={list.data.page} totalPages={list.data.totalPages} totalElements={list.data.totalElements} size={list.data.size} onChange={setPage} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showForm && (
        <EnrollmentFormModal
          enrollment={editing}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            publish("enrollments");
          }}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}

      {touches && <FollowUpLogModal enrollment={touches.enrollment} type={touches.type} canLog={can("update", "enrollment")} onClose={() => setTouches(null)} onChanged={list.reload} />}

      {deleting && (
        <ConfirmDialog
          title="Delete enrollment"
          message={"Delete enrollment for " + deleting.providerName + " → " + deleting.payerName + "?"}
          busy={deleteBusy}
          onConfirm={doDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
