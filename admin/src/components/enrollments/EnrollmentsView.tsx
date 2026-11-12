"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccessDenied } from "@/components/AlertBox";
import { Avatar } from "@/components/Avatar";
import { ConfirmDialog } from "@/components/Modal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Icon } from "@/components/Icon";
import { NotesCell } from "@/components/NotesCell";
import { AcknowledgementCell } from "./AcknowledgementCell";
import { columnQuery, ColumnFilterRow, type ColumnFilters, type ColumnKey, type Sort } from "./EnrollmentColumnFilters";
import { FollowUpLogModal } from "./FollowUpLogModal";
import { CallModal, EmailModal, loadWorkflowMeta } from "@/components/submissions/PayerWorkflow";
import type { PayerCard, WorkflowMeta } from "@/types/payerWorkflow";
import { PageHeader } from "@/components/PageHeader";
import { Pagination } from "@/components/Pagination";
import { StatusPill } from "@/components/Pill";
import { api, errorMessage } from "@/lib/api";
import { useAuth, useUser } from "@/stores/auth";
import { useAsync, useDebounced } from "@/lib/hooks";
import { fmtDate, todayISO } from "@/lib/utils";
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
  // a filter box + ↑ / ↓ sort above every column (filtered, sorted and paged on the server)
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<Sort>(null);
  const [page, setPage] = useState(0);
  const changeFilter = (key: ColumnKey, v: string) => {
    setFilters((f) => ({ ...f, [key]: v }));
    setPage(0);
  };
  const anyFilter = Object.values(filters).some((v) => (v || "").trim()) || sort !== null;
  const clearFilters = () => {
    setFilters({});
    setSort(null);
    setPage(0);
  };
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
  // Call / Email the payer right from the list (the same dialogs as Payer Submissions)
  const [contact, setContact] = useState<{ card: PayerCard; type: "call" | "email" } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const meta = useAsync<WorkflowMeta>(loadWorkflowMeta, []);
  const contactPayer = async (e: Enrollment, type: "call" | "email") => {
    setOpening(type + e.id);
    try {
      setContact({ card: await api.get<PayerCard>("/payer-workflows/" + e.id + "/card"), type });
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setOpening(null);
    }
  };
  const query = useDebounced(JSON.stringify(columnQuery(filters, sort)));
  const allowed = can("list", "enrollment");

  const list = useAsync<PageResponse<Enrollment>>(
    allowed ? () => api.get("/enrollments", { ...JSON.parse(query), page, size: PAGE_SIZE }) : null,
    [allowed, query, page]
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
          <div className="flex items-center gap-2">
            {anyFilter && (
              <button type="button" className="btn btn-secondary" onClick={clearFilters} data-clear-filters>
                <Icon name="X" size={14} /> Clear filters and sorting
              </button>
            )}
            {can("create", "enrollment") && (
              <button
                onClick={() => {
                  setEditing(null);
                  setShowForm(true);
                }}
                className="btn btn-primary"
              >
                <Icon name="Plus" size={13} /> New Enrollment
              </button>
            )}
          </div>
        }
      />

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
          ) : rows.length === 0 && !anyFilter ? (
            <EmptyState icon="ClipboardList" title="No enrollments yet" />
          ) : (
            <>
              <div className="table-scroll flex-1 min-h-0" style={{ overflow: "auto" }}>
                <table className="sticky-head">
                  <thead>
                    <ColumnFilterRow
                      filters={filters}
                      sort={sort}
                      onFilter={changeFilter}
                      onSort={(x) => {
                        setSort(x);
                        setPage(0);
                      }}
                      extraCells={1}
                    />
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
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody style={list.loading ? { opacity: 0.6 } : undefined}>
                    {rows.length === 0 && (
                      <tr data-no-match>
                        <td colSpan={12} className="text-center text-sm text-ink-light" style={{ padding: "40px 16px" }}>
                          No enrollments match these filters.
                        </td>
                      </tr>
                    )}
                    {rows.map((e) => (
                      <tr key={e.id} data-enrollment={e.id}>
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
                            {(e.payerSupportPhone || e.payerSupportEmail) && can("update", "enrollment") && <span className="w-px h-4 bg-line mx-0.5" />}
                            {/* like Payer Submissions: Call only with the payer's support phone, Email only with its support email */}
                            {can("update", "enrollment") && e.payerSupportPhone && (
                              <button
                                onClick={() => contactPayer(e, "call")}
                                className="btn btn-secondary text-xs"
                                style={{ padding: "3px 8px", color: "var(--accent-strong)", borderColor: "var(--accent)" }}
                                disabled={opening === "call" + e.id}
                                title={"Call " + (e.payerName || "the payer") + " · " + e.payerSupportPhone}
                                aria-label={"Call " + (e.payerName || "payer") + " for " + e.providerName}
                                data-call-payer={e.id}
                              >
                                {opening === "call" + e.id ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name="PhoneCall" size={11} />} Call
                              </button>
                            )}
                            {can("update", "enrollment") && e.payerSupportEmail && (
                              <button
                                onClick={() => contactPayer(e, "email")}
                                className="btn btn-secondary text-xs"
                                style={{ padding: "3px 8px", color: "var(--accent-strong)", borderColor: "var(--accent)" }}
                                disabled={opening === "email" + e.id}
                                title={"Email " + (e.payerName || "the payer") + " · " + e.payerSupportEmail}
                                aria-label={"Email " + (e.payerName || "payer") + " for " + e.providerName}
                                data-email-payer={e.id}
                              >
                                {opening === "email" + e.id ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name="Send" size={11} />} Email
                              </button>
                            )}
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

      {contact?.type === "call" && <CallModal card={contact.card} onClose={() => setContact(null)} onLogged={() => publish("enrollments")} />}
      {contact?.type === "email" && meta.data && <EmailModal card={contact.card} meta={meta.data} onClose={() => setContact(null)} onLogged={() => publish("enrollments")} />}
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
