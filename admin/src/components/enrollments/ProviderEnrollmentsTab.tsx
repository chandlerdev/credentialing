"use client";

import { Select } from "@/components/Select";

import { Fragment, useMemo, useRef, useState } from "react";
import { matchesSearch } from "@/lib/search";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/Modal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Icon } from "@/components/Icon";
import { Pill, StatusPill } from "@/components/Pill";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { useAsync } from "@/lib/hooks";
import { fmtDateShort, fmtTs, cleanSearch } from "@/lib/utils";
import { useToast } from "@/stores/toast";
import { useShell, useTopic } from "@/stores/shell";
import type { PageResponse } from "@/types";
import { EnrollmentFormModal } from "@/components/modals/EnrollmentFormModal";
import { addMonthsISO } from "./shared";
import type { Enrollment, EnrollmentDetail, EnrollmentEvent, EnrollmentFile, EnrollmentFileType, EnrollmentPatch, Payer, StaffUser } from "@/types/enrollments";

type TabId = "all" | "in_progress" | "submitted" | "approved" | "needs_attention" | "terminated";

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "in_progress", label: "In Progress" },
  { id: "submitted", label: "Submitted" },
  { id: "approved", label: "Approved" },
  { id: "needs_attention", label: "Needs Attention" },
  { id: "terminated", label: "Terminated" },
];

const FILE_TYPE_LABEL: Record<EnrollmentFileType, string> = {
  welcome_letter: "Welcome Letter",
  application_form: "Application Form",
  contract: "Contract",
  acknowledgement: "Acknowledgement",
  other: "Other",
};
const FILE_TYPE_PILL: Record<EnrollmentFileType, string> = { welcome_letter: "success", application_form: "accent", contract: "info", acknowledgement: "success", other: "neutral" };

const EVENT_META: Record<string, { label: string; icon: string; color: string }> = {
  created: { label: "Created", icon: "FilePlus", color: "var(--ink-light)" },
  status_change: { label: "Status changed", icon: "RefreshCw", color: "var(--info)" },
  submitted: { label: "Submitted", icon: "Send", color: "var(--info)" },
  approved: { label: "Approved", icon: "CheckCircle2", color: "var(--success)" },
  terminated: { label: "Terminated", icon: "XCircle", color: "var(--danger)" },
  note: { label: "Note", icon: "StickyNote", color: "var(--ink-light)" },
  follow_up: { label: "Follow-up", icon: "PhoneCall", color: "var(--accent)" },
  resubmitted: { label: "Resubmitted", icon: "RotateCcw", color: "var(--info)" },
  recredential_started: { label: "Re-credentialing started", icon: "RefreshCw", color: "var(--accent)" },
  submission_queued: { label: "Submission queued", icon: "Clock", color: "var(--warn)" },
  submission_update: { label: "Submission update", icon: "Send", color: "var(--info)" },
  docs_collected: { label: "Documents collected", icon: "Files", color: "var(--ink-light)" },
  ack: { label: "Acknowledged by payer", icon: "Inbox", color: "var(--info)" },
  welcome: { label: "Welcome letter", icon: "Mail", color: "var(--success)" },
  denied: { label: "Denied", icon: "XCircle", color: "var(--danger)" },
};

/**
 * Provider-detail "Enrollments" tab — port of the prototype ProviderEnrollments (L2058).
 * Reusable: rendered by the providers module inside the provider detail page.
 */
export function ProviderEnrollmentsTab({ providerId, onUploadDocs }: { providerId: number; onUploadDocs?: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const { publish } = useShell();
  const [tab, setTab] = useState<TabId>("all");
  const [view, setView] = useState<"table" | "board">("table");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Enrollment | null>(null);
  const canUpdate = can("update", "enrollment");

  const list = useAsync<PageResponse<Enrollment>>(() => api.get("/enrollments", { providerId, size: 500, sort: "createdAt,desc" }), [providerId]);
  const payers = useAsync<Payer[]>(() => api.get("/payers", { activeOnly: false }), []);
  useTopic("enrollments", list.reload);

  const enrollments = useMemo(() => list.data?.content || [], [list.data]);
  const counts: Record<TabId, number> = {
    all: enrollments.length,
    in_progress: enrollments.filter((e) => e.status === "in_progress").length,
    submitted: enrollments.filter((e) => e.status === "submitted").length,
    approved: enrollments.filter((e) => e.status === "approved").length,
    needs_attention: enrollments.filter((e) => e.status === "needs_attention").length,
    terminated: enrollments.filter((e) => e.status === "terminated").length,
  };

  let filtered = enrollments;
  if (tab !== "all") filtered = filtered.filter((e) => e.status === tab);
  if (search.trim()) filtered = filtered.filter((e) => matchesSearch(search, e.payerName, e.formLabel, e.practiceName, e.status));

  const toggle = (id: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const recredDate = (e: Enrollment) => {
    if (e.status !== "approved" || !e.effectiveDate) return null;
    const payer = payers.data?.find((p) => p.id === e.payerId);
    return addMonthsISO(e.effectiveDate, payer?.recredCycleMonths || 24);
  };

  const patch = async (e: Enrollment, body: EnrollmentPatch) => {
    try {
      await api.patch<Enrollment>("/enrollments/" + e.id, body);
      toast("Enrollment updated");
      publish("enrollments");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const allChecked = filtered.length > 0 && filtered.every((e) => checked.has(e.id));

  return (
    <div>
      {/* Sub tabs */}
      <div className="flex items-center gap-1 border-b border-line mb-4 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={"px-4 py-2 text-sm font-medium relative whitespace-nowrap " + (tab === t.id ? "text-accent" : "text-ink-light hover:text-ink")}
          >
            {t.label} <span className="text-ink-faint ml-1">{counts[t.id]}</span>
            {tab === t.id && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: "var(--accent)" }}></div>}
          </button>
        ))}
      </div>

      {/* Filters + actions */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="relative" style={{ maxWidth: "100%" }}>
          <Icon name="Search" size={14} className="absolute" style={{ left: 10, top: 10, color: "var(--ink-faint)" }} />
          <input value={search} onChange={(e) => setSearch(cleanSearch(e.target.value))} placeholder="Search by payer, plan, practice..." className="input" style={{ paddingLeft: 32, width: 320, maxWidth: "100%" }} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex border border-line rounded-md p-0.5">
            <button onClick={() => setView("table")} className={"px-2.5 py-1 rounded text-xs flex items-center gap-1 " + (view === "table" ? "bg-soft" : "")}>
              <Icon name="Table" size={11} /> Table
            </button>
            <button onClick={() => setView("board")} className={"px-2.5 py-1 rounded text-xs flex items-center gap-1 " + (view === "board" ? "bg-soft" : "")}>
              <Icon name="LayoutGrid" size={11} /> Board
            </button>
          </div>
          <button onClick={() => (onUploadDocs ? onUploadDocs() : router.push("/providers/" + providerId + "?tab=documents"))} className="btn btn-secondary">
            <Icon name="Upload" size={13} /> Upload Docs
          </button>
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
      </div>

      {list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <EmptyState icon="ClipboardList" title="No enrollments yet" description="Start an enrollment to begin tracking this provider with payers." />
      ) : view === "board" ? (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {(["draft", "in_progress", "submitted", "approved", "needs_attention", "terminated"] as const).map((st) => {
            const col = filtered.filter((e) => e.status === st || (st === "draft" && e.status === "on_hold"));
            return (
              <div key={st} className="card" style={{ background: "var(--bg-soft)" }}>
                <div className="p-3 border-b border-line flex items-center justify-between">
                  <StatusPill status={st} />
                  <span className="text-xs text-ink-faint">{col.length}</span>
                </div>
                <div className="p-2 space-y-2">
                  {col.map((e) => (
                    <div key={e.id} className="card p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: e.payerColor }}></div>
                        <span className="font-medium text-sm">{e.payerName}</span>
                      </div>
                      <div className="text-xs text-ink-light mt-1">{e.practiceName || "—"}</div>
                      {e.status === "on_hold" && (
                        <div className="mt-1">
                          <StatusPill status="on_hold" />
                        </div>
                      )}
                      <div className="text-[10px] text-ink-faint mt-1">{e.submittedDate ? "Submitted " + fmtDateShort(e.submittedDate) : "Not submitted"}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(filtered.map((e) => e.id)))} aria-label="Select all" />
                  </th>
                  <th>Payer / Plan</th>
                  <th>Practice</th>
                  <th>Status</th>
                  <th>Submission Date</th>
                  <th>Approved Date</th>
                  <th>Assigned To</th>
                  <th>Recredential Date</th>
                  <th>Turnaround Time</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const isExp = expanded.has(e.id);
                  const rd = recredDate(e);
                  return (
                    <Fragment key={e.id}>
                      <tr className="cursor-pointer" onClick={() => toggle(e.id)}>
                        <td onClick={(ev) => ev.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={checked.has(e.id)}
                            onChange={() =>
                              setChecked((s) => {
                                const n = new Set(s);
                                if (n.has(e.id)) n.delete(e.id);
                                else n.add(e.id);
                                return n;
                              })
                            }
                            aria-label="Select enrollment"
                          />
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <Icon name={isExp ? "ChevronDown" : "ChevronRight"} size={13} className="text-ink-faint" />
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: e.payerColor }}></div>
                            <div>
                              <span className="font-medium">{e.payerName}</span>
                              {e.formLabel && <div className="text-[10px] text-ink-faint">{e.formLabel}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="text-ink-light">{e.practiceName || "—"}</td>
                        <td>
                          <StatusPill status={e.status} />
                        </td>
                        <td className="text-ink-light text-xs" onClick={(ev) => ev.stopPropagation()}>
                          <InlineDate
                            value={e.submittedDate}
                            editable={canUpdate}
                            onSave={(v) => patch(e, v ? { submittedDate: v } : { clearSubmittedDate: true })}
                          />
                        </td>
                        <td className="text-ink-light text-xs" onClick={(ev) => ev.stopPropagation()}>
                          <InlineDate
                            value={e.effectiveDate}
                            min={e.submittedDate || undefined}
                            editable={canUpdate}
                            onSave={(v) => patch(e, v ? { effectiveDate: v } : { clearEffectiveDate: true })}
                          />
                        </td>
                        <td className="text-xs" onClick={(ev) => ev.stopPropagation()}>
                          <InlineAssignee
                            enrollment={e}
                            editable={canUpdate}
                            onSave={(id) => patch(e, id ? { assignedUserId: id } : { clearAssignedUser: true })}
                          />
                        </td>
                        <td className="text-xs text-ink-light">{rd ? fmtDateShort(rd) : <span className="text-ink-faint">—</span>}</td>
                        <td className="font-mono text-xs text-ink-light">{e.tatDays ? e.tatDays + " days" : "—"}</td>
                        <td className="text-right" onClick={(ev) => ev.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            {e.fileCount > 0 && (
                              <button className="btn-ghost p-1 relative" onClick={() => toggle(e.id)} aria-label="Files">
                                <Icon name="Files" size={13} />
                                <span
                                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] flex items-center justify-center font-bold"
                                  style={{ background: "var(--accent)", color: "white" }}
                                >
                                  {e.fileCount}
                                </span>
                              </button>
                            )}
                            {canUpdate && (
                              <button
                                className="btn-ghost p-1"
                                onClick={() => {
                                  setEditing(e);
                                  setShowForm(true);
                                }}
                                aria-label="Edit enrollment"
                              >
                                <Icon name="Pencil" size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExp && (
                        <tr className="no-hover">
                          <td></td>
                          <td colSpan={9} style={{ background: "var(--bg-soft)" }}>
                            <EnrollmentExpansion enrollmentId={e.id} canUpdate={canUpdate} onChanged={() => publish("enrollments")} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <EnrollmentFormModal
          enrollment={editing}
          defaultProviderId={providerId}
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
    </div>
  );
}

/** "Click to add" date cell → inline date input saved with PATCH. */
function InlineDate({ value, editable, min, onSave }: { value: string | null; editable: boolean; min?: string; onSave: (v: string | null) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="date"
          className="input input-sm"
          style={{ width: 140 }}
          defaultValue={value || ""}
          min={min}
          autoFocus
          disabled={busy}
          onBlur={() => !busy && setEditing(false)}
          onKeyDown={(ev) => ev.key === "Escape" && setEditing(false)}
          onChange={async (ev) => {
            const v = ev.target.value;
            if (v === (value || "")) return;
            setBusy(true);
            await onSave(v || null);
            setBusy(false);
            setEditing(false);
          }}
        />
        {busy && <span className="loader" />}
      </div>
    );
  }
  if (value) {
    return (
      <button className={editable ? "hover:text-ink" : "cursor-default"} onClick={() => editable && setEditing(true)}>
        <Icon name="Calendar" size={11} className="inline mr-1" /> {fmtDateShort(value)}
      </button>
    );
  }
  return editable ? (
    <button className="text-ink-faint hover:text-accent" onClick={() => setEditing(true)}>
      Click to add
    </button>
  ) : (
    <span className="text-ink-faint">—</span>
  );
}

let staffCache: Promise<StaffUser[]> | null = null;
const loadStaff = () => {
  if (!staffCache) staffCache = api.get<StaffUser[]>("/users/directory").catch((e) => {
    staffCache = null;
    throw e;
  });
  return staffCache;
};

/** "Click to assign" cell → staff select saved with PATCH. */
function InlineAssignee({ enrollment, editable, onSave }: { enrollment: Enrollment; editable: boolean; onSave: (id: number | null) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const staff = useAsync<StaffUser[]>(editing ? loadStaff : null, [editing]);
  if (editing) {
    if (staff.loading) return <span className="loader" />;
    return (
      <Select
        className="input input-sm"
        style={{ width: 170 }}
        autoFocus
        disabled={busy}
        defaultValue={enrollment.assignedUserId ? String(enrollment.assignedUserId) : ""}
        onBlur={() => !busy && setEditing(false)}
        onChange={async (ev) => {
          setBusy(true);
          await onSave(ev.target.value ? Number(ev.target.value) : null);
          setBusy(false);
          setEditing(false);
        }}
      >
        <option value="">— Unassigned —</option>
        {(staff.data || [])
          .filter((u) => u.role !== "provider" && u.role !== "auditor")
          .map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
      </Select>
    );
  }
  if (enrollment.assignedUserName) {
    return (
      <button className={"text-ink-light " + (editable ? "hover:text-ink" : "cursor-default")} onClick={() => editable && setEditing(true)}>
        {enrollment.assignedUserName}
      </button>
    );
  }
  return editable ? (
    <button className="text-ink-faint hover:text-accent" onClick={() => setEditing(true)}>
      Click to assign
    </button>
  ) : (
    <span className="text-ink-faint">—</span>
  );
}

/** Expanded row: files (upload / download / delete) and the timeline of events. */
function EnrollmentExpansion({ enrollmentId, canUpdate, onChanged }: { enrollmentId: number; canUpdate: boolean; onChanged: () => void }) {
  const toast = useToast();
  const detail = useAsync<EnrollmentDetail>(() => api.get("/enrollments/" + enrollmentId), [enrollmentId]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileType, setFileType] = useState<EnrollmentFileType>("application_form");
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<EnrollmentFile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  if (detail.error) return <div className="py-2 text-xs" style={{ color: "var(--danger)" }}>{detail.error} <button className="text-accent hover:underline ml-2" onClick={detail.reload}>Retry</button></div>;
  if (!detail.data) return <Loading className="py-3" />;
  const { files, events } = detail.data;

  const upload = async (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      toast("File is larger than 25 MB", "error");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("fileType", fileType);
    setUploading(true);
    try {
      await api.upload("/enrollments/" + enrollmentId + "/files", fd);
      toast("File uploaded");
      await detail.reload();
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const download = async (f: EnrollmentFile) => {
    if (!f.hasFile) {
      toast("This file has no stored content", "error");
      return;
    }
    try {
      await api.download("/enrollment-files/" + f.id + "/download", undefined, f.name);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete("/enrollment-files/" + deleting.id);
      toast("File deleted");
      setDeleting(null);
      await detail.reload();
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setDeleteBusy(false);
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setNoteBusy(true);
    try {
      await api.post<EnrollmentEvent>("/enrollments/" + enrollmentId + "/events", { type: "note", note: note.trim() });
      setNote("");
      await detail.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setNoteBusy(false);
    }
  };

  return (
    <div className="py-2 grid grid-cols-1 lg:grid-cols-2 gap-4" onClick={(ev) => ev.stopPropagation()}>
      <div>
        <div className="text-xs font-semibold text-ink-faint uppercase tracking-wider mb-2">Files</div>
        {files.length === 0 && <div className="text-xs text-ink-faint py-1">No files uploaded yet</div>}
        {files.map((f) => (
          <div key={f.id} className="flex items-center gap-3 py-1 flex-wrap">
            <Icon name="FileText" size={13} className="text-accent" />
            <button className="text-accent text-sm font-medium hover:underline" onClick={() => download(f)}>
              {f.name}
            </button>
            <span className="text-xs text-ink-light">{fmtTs(f.uploadedAt)}</span>
            <Pill type={FILE_TYPE_PILL[f.fileType] || "info"}>{FILE_TYPE_LABEL[f.fileType] || f.fileType}</Pill>
            <div className="flex-1"></div>
            <button className="btn-ghost p-1" onClick={() => download(f)} aria-label="Download file" disabled={!f.hasFile} title={f.hasFile ? "Download" : "No stored content"}>
              <Icon name="Download" size={13} />
            </button>
            {canUpdate && (
              <button className="btn-ghost p-1 hover:text-red-600" onClick={() => setDeleting(f)} aria-label="Delete file">
                <Icon name="Trash2" size={13} />
              </button>
            )}
          </div>
        ))}
        {canUpdate && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Select className="input input-sm" style={{ width: 160 }} value={fileType} onChange={(e) => setFileType(e.target.value as EnrollmentFileType)}>
              {(Object.keys(FILE_TYPE_LABEL) as EnrollmentFileType[]).map((t) => (
                <option key={t} value={t}>
                  {FILE_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.tif,.tiff,.doc,.docx,.xls,.xlsx,.csv,.txt,.heic"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
            <button className="btn btn-secondary text-xs" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <span className="loader" /> : <Icon name="Upload" size={11} />} Upload file
            </button>
          </div>
        )}
      </div>
      <div>
        <div className="text-xs font-semibold text-ink-faint uppercase tracking-wider mb-2">Timeline</div>
        <div className="space-y-2" style={{ maxHeight: 260, overflowY: "auto" }}>
          {events.length === 0 && <div className="text-xs text-ink-faint">No activity yet</div>}
          {events.map((ev) => {
            const m = EVENT_META[ev.type] || { label: ev.type.replace(/_/g, " "), icon: "Circle", color: "var(--ink-light)" };
            return (
              <div key={ev.id} className="flex items-start gap-2">
                <Icon name={m.icon} size={13} style={{ color: m.color, marginTop: 2 }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-ink">
                    <span className="font-medium">{m.label}</span>
                    {ev.confirmationNumber && <span className="font-mono text-ink-light"> · {ev.confirmationNumber}</span>}
                  </div>
                  {ev.note && <div className="text-xs text-ink-light">{ev.note}</div>}
                  <div className="text-[10px] text-ink-faint">
                    {fmtTs(ev.occurredAt)}
                    {ev.actorLabel ? " · " + ev.actorLabel : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {canUpdate && (
          <div className="flex items-center gap-2 mt-2">
            <input className="input input-sm flex-1" placeholder="Add a note..." value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} />
            <button className="btn btn-secondary text-xs" disabled={noteBusy || !note.trim()} onClick={addNote}>
              {noteBusy ? <span className="loader" /> : <Icon name="Plus" size={11} />} Add
            </button>
          </div>
        )}
      </div>
      {deleting && (
        <ConfirmDialog title="Delete file" message={"Delete " + deleting.name + "?"} busy={deleteBusy} onConfirm={doDelete} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}

