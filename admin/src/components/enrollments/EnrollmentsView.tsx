"use client";

import { Select } from "@/components/Select";

import { useState } from "react";
import { AccessDenied } from "@/components/AlertBox";
import { Avatar } from "@/components/Avatar";
import { ConfirmDialog } from "@/components/Modal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Icon } from "@/components/Icon";
import { NotesCell } from "@/components/NotesCell";
import { AcknowledgementCell } from "./AcknowledgementCell";
import { PageHeader } from "@/components/PageHeader";
import { Pagination } from "@/components/Pagination";
import { StatusPill } from "@/components/Pill";
import { api, errorMessage } from "@/lib/api";
import { useAuth, useUser } from "@/stores/auth";
import { useAsync, useDebounced } from "@/lib/hooks";
import { fmtDate, cleanSearch } from "@/lib/utils";
import { useToast } from "@/stores/toast";
import { useShell, useTopic } from "@/stores/shell";
import type { PageResponse } from "@/types";
import { EnrollmentFormModal } from "@/components/modals/EnrollmentFormModal";
import type { Enrollment, EnrollmentSummary } from "@/types/enrollments";

const PAGE_SIZE = 50;

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
        <div className="card overflow-hidden">
          {list.loading && !list.data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <EmptyState icon="ClipboardList" title="No enrollments match" />
          ) : (
            <>
              <div className="table-scroll overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Payer</th>
                      <th>Status</th>
                      <th>Submitted</th>
                      <th>Approved</th>
                      <th>TAT</th>
                      <th>Notes</th>
                      <th>Acknowledgement</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody style={list.loading ? { opacity: 0.6 } : undefined}>
                    {rows.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            <Avatar name={e.providerName} size={26} />
                            <span className="text-sm font-medium">{e.providerName}</span>
                          </div>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ background: e.payerColor || "var(--ink-light)" }}></div>
                            <span className="text-sm">{e.payerName || "—"}</span>
                          </div>
                        </td>
                        <td>
                          <StatusPill status={e.status} />
                        </td>
                        <td className="text-xs text-ink-light">{e.submittedDate ? fmtDate(e.submittedDate) : "—"}</td>
                        <td className="text-xs text-ink-light">{e.effectiveDate ? fmtDate(e.effectiveDate) : "—"}</td>
                        <td className="font-mono text-xs">{e.tatDays ? e.tatDays + "d" : "—"}</td>
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
              {list.data && list.data.totalPages > 1 && (
                <Pagination page={list.data.page} totalPages={list.data.totalPages} totalElements={list.data.totalElements} size={list.data.size} onChange={setPage} />
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
