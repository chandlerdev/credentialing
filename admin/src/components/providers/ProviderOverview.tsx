"use client";

import { Fragment, useState } from "react";
import { todayISO } from "@/lib/utils";
import Link from "next/link";
import { ConfirmDialog } from "@/components/Modal";
import { DeferredNotice } from "@/components/AlertBox";
import { DocStatusBadge, Pill } from "@/components/Pill";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { NotesCell } from "@/components/NotesCell";
import { useShell } from "@/stores/shell";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { daysFromNow, fmtDate, fmtDateShort, fmtTs } from "@/lib/utils";
import { useAsync } from "@/lib/hooks";
import { useToast } from "@/stores/toast";
import type { DeferredResponse } from "@/types";
import { ValField } from "./shared";
import type { AdditionalDocument, DocStatus, DocType, DocumentRow, ProviderDetail, Verification, VerificationSource } from "@/types/providers";

/** An additional document shown like a regular one. */
const extraRow = (x: AdditionalDocument): DocumentRow => ({
  id: x.id,
  providerId: x.providerId,
  docType: x.docType as DocType,
  label: x.docTypeLabel,
  critical: false,
  expires: true,
  sortOrder: null,
  status: x.status as DocStatus,
  fileName: x.fileName,
  mimeType: x.mimeType ?? null,
  sizeBytes: x.sizeBytes,
  originalRelativePath: null,
  expiresAt: x.expiresAt,
  daysUntilExpiry: daysFromNow(x.expiresAt),
  uploadedAt: x.uploadedAt,
  hasFile: true,
  notes: x.notes,
  notesUpdatedAt: x.notesUpdatedAt,
  notesUpdatedBy: x.notesUpdatedBy,
  extra: true,
});

/** Row key: regular and additional documents have separate ids. */
const rowKey = (d: DocumentRow) => (d.extra ? "x" : "d") + d.id;
/** API path of a document (regular or additional). */
const docPath = (d: DocumentRow) => (d.extra ? "/additional-documents/" : "/documents/") + d.id;

const PSV_CHECKS: { source: VerificationSource; icon: string; iconColor: string; iconBg: string; title: string; subtitle: string; action: string }[] = [
  { source: "npi", icon: "ShieldCheck", iconColor: "#3b82f6", iconBg: "#dbeafe", title: "NPI Registry", subtitle: "Verify provider credentials with CMS", action: "Check NPI Registry" },
  { source: "sam", icon: "AlertTriangle", iconColor: "#ca8a04", iconBg: "#fef9c3", title: "SAM Exclusions", subtitle: "Check federal exclusions database", action: "Check SAM Exclusions" },
  { source: "oig", icon: "ShieldX", iconColor: "#dc2626", iconBg: "#fee2e2", title: "OIG Exclusions", subtitle: "Check HHS Office of Inspector General exclusion list", action: "Check OIG" },
  { source: "state_license", icon: "Award", iconColor: "#0284c7", iconBg: "#e0f2fe", title: "State Licensure (Multi-State)", subtitle: "Verify licenses across state licensing databases", action: "Check State Licenses" },
];

/** Prototype ProviderOverview (L1871): documents, document details, PSV and credentials. */
export function ProviderOverview({ provider, onChanged }: { provider: ProviderDetail; onChanged: () => void }) {
  const { can, user } = useAuth();
  const canNote = user?.role !== "provider" && can("update", "document");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const extras = useAsync(() => api.get<AdditionalDocument[]>("/providers/" + provider.id + "/additional-documents"), [provider.id]);
  const extraDocs = (extras.data || []).map(extraRow);
  const docs = [...provider.documents, ...extraDocs];
  const selectedDoc = docs.find((d) => rowKey(d) === selectedDocId) || null;
  const changed = () => {
    onChanged();
    extras.reload();
  };


  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* Provider Documents */}
      <div className="lg:col-span-3 card overflow-hidden min-w-0">
        <div className="flex items-center justify-between p-5 pb-3 border-b border-line flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Icon name="FileText" size={16} style={{ color: "var(--accent)" }} />
            <h3 className="font-display font-semibold text-ink">Provider Documents</h3>
            <Icon name="ChevronsUpDown" size={12} className="text-ink-faint" />
          </div>
          {can("create", "document") && (
            <Link href={"/providers/" + provider.id + "/upload"} className="btn btn-primary">
              <Icon name="Sparkles" size={14} /> AI Upload Documents
            </Link>
          )}
        </div>
        <div className="table-scroll overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Document Type</th>
                <th>Expiration</th>
                <th>Mandatory</th>
                <th>Status</th>
                <th>Notes</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc, i) => {
                const key = rowKey(doc);
                const hasFile = doc.hasFile;
                const expDays = doc.daysUntilExpiry;
                const expClass = expDays !== null && expDays < 0 ? "text-danger" : "text-ink-light";
                return (
                  <Fragment key={key}>
                    {doc.extra && !docs[i - 1]?.extra && (
                      <tr className="no-hover">
                        <td colSpan={6} style={{ background: "var(--bg-soft)" }}>
                          <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                            <Icon name="FilePlus" size={13} className="text-accent" /> Additional Documents
                            <span className="font-normal text-ink-faint">added by the provider</span>
                          </div>
                        </td>
                      </tr>
                    )}
                    <tr className={hasFile ? "cursor-pointer" : ""} onClick={() => hasFile && setSelectedDocId(key)} style={selectedDocId === key ? { background: "var(--accent-soft)" } : undefined}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{doc.label}</span>
                        </div>
                      </td>
                      <td className={"text-xs " + expClass} style={expDays !== null && expDays < 0 ? { color: "var(--danger)" } : undefined}>
                        {doc.expiresAt ? fmtDateShort(doc.expiresAt) : <span className="text-ink-faint">No expiration</span>}
                      </td>
                      <td className="text-xs">
                        <MandatoryMark yes={doc.critical} />
                      </td>
                      <td>
                        <DocStatusBadge status={doc.status} />
                      </td>
                      <td>
                        <NotesCell<DocumentRow>
                          notes={doc.notes}
                          updatedAt={doc.notesUpdatedAt}
                          updatedBy={doc.notesUpdatedBy}
                          path={docPath(doc) + "/notes"}
                          title={"Notes · " + doc.label}
                          subtitle={provider.firstName + " " + provider.lastName}
                          canEdit={canNote}
                          onSaved={changed}
                          compact
                        />
                      </td>
                      <td className="text-right">
                        <button
                          className="btn-ghost p-1"
                          title={hasFile ? "Details" : "No file uploaded"}
                          aria-label={"Details for " + doc.label}
                          disabled={!hasFile}
                          style={hasFile ? undefined : { opacity: 0.35, cursor: "not-allowed" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (hasFile) setSelectedDocId(key);
                          }}
                        >
                          <Icon name="Eye" size={13} />
                        </button>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right column: Document details + PSV + Credentials */}
      <div className="lg:col-span-2 space-y-4 min-w-0">
        <div className="card">
          <div className="p-5 pb-3 border-b border-line">
            <div className="flex items-center gap-2">
              <Icon name="FileText" size={16} style={{ color: "var(--accent)" }} />
              <h3 className="font-display font-semibold text-ink">Document Details</h3>
            </div>
          </div>
          {selectedDoc ? (
            <DocumentDetails key={rowKey(selectedDoc)} doc={selectedDoc} onClose={() => setSelectedDocId(null)} onChanged={changed} />
          ) : (
            <EmptyState icon="FileText" title="Select a document" description="Select a document category to view extracted details." />
          )}
        </div>

        <PrimarySourceVerification provider={provider} />

        {/* Credentials (CAQH, PECOS) */}
        <div className="card">
          <div className="p-5 pb-3 border-b border-line">
            <div className="flex items-center gap-2">
              <Icon name="KeyRound" size={16} style={{ color: "var(--accent)" }} />
              <h3 className="font-display font-semibold text-ink">Credentials</h3>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-soft-2">
            <div className="bg-paper p-4">
              <div className="flex items-center gap-2 mb-3">
                <Icon name="Database" size={13} className="text-ink-light" />
                <span className="text-sm font-semibold text-ink">CAQH</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-ink-light">CAQH ID</span><span className="font-mono">{provider.caqhId || "—"}</span></div>
                <div className="flex justify-between"><span className="text-ink-light">Username</span><span className="font-mono">{provider.caqhUsername || "—"}</span></div>
                <div className="flex justify-between"><span className="text-ink-light">Password</span><span className="font-mono">{provider.hasCaqhPassword ? "••••••••" : "—"}</span></div>
              </div>
            </div>
            <div className="bg-paper p-4">
              <div className="flex items-center gap-2 mb-3">
                <Icon name="ShieldCheck" size={13} className="text-ink-light" />
                <span className="text-sm font-semibold text-ink">PECOS</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-ink-light">Access Granted</span><span className="font-medium">{provider.pecosAccessGranted == null ? "—" : provider.pecosAccessGranted ? "Yes" : "No"}</span></div>
                <div className="flex justify-between"><span className="text-ink-light">User Name</span><span className="font-mono">{provider.pecosUsername || "—"}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mandatory column: Yes for a required document, otherwise No. */
export function MandatoryMark({ yes }: { yes: boolean }) {
  return yes ? <span className="font-semibold text-ink">Yes</span> : <span className="text-ink-faint">No</span>;
}

/** Word documents can't be shown in the browser: they are downloaded instead of viewed. */
export const isWordFile = (name: string | null | undefined, mimeType?: string | null) =>
  /\.(docx?|docm|dotx?|dotm|rtf|odt)$/i.test((name || "").trim()) || /msword|wordprocessingml|ms-word|opendocument\.text|rtf/i.test(mimeType || "");

/** Opens the uploaded file in a new browser tab (any status, as long as a file is stored; not for Word files). */
export function ViewFileButton({ doc, label, eye }: { doc: DocumentRow; label?: boolean; eye?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!doc.hasFile || isWordFile(doc.fileName, doc.mimeType)) return null;
  return (
    <button
      className={label ? "btn btn-secondary" : "btn-ghost p-1"}
      style={label ? { fontSize: 11, padding: "5px 10px" } : undefined}
      title="View file in a new tab"
      aria-label={"View file " + (doc.fileName || doc.label)}
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          await api.openInNewTab(docPath(doc) + "/download", { inline: true });
        } catch (err) {
          toast(errorMessage(err), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name={eye ? "Eye" : "ExternalLink"} size={label ? 11 : 13} />} {label && "View File"}
    </button>
  );
}

export function DownloadButton({ doc, label }: { doc: DocumentRow; label?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!doc.hasFile) return null;
  return (
    <button
      className={label ? "btn btn-secondary" : "btn-ghost p-1"}
      style={label ? { fontSize: 11, padding: "5px 10px" } : undefined}
      title="Download"
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          await api.download(docPath(doc) + "/download", { inline: false }, doc.fileName || "document");
        } catch (err) {
          toast(errorMessage(err), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name="Download" size={label ? 11 : 13} />} {label && "Download"}
    </button>
  );
}

// ---------- DocumentDetails (prototype L2037 + review actions) ----------

function DocumentDetails({ doc, onClose, onChanged }: { doc: DocumentRow; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { can, user } = useAuth();
  const { publish } = useShell();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [editExpiry, setEditExpiry] = useState(false);
  const [expiry, setExpiry] = useState(doc.expiresAt || "");
  const staff = user?.role !== "provider";
  const canReview = staff && can("update", "document");
  const canRemove = staff && can("delete", "document");

  const patch = async (key: string, body: { status?: DocStatus; expiresAt?: string; clearExpiresAt?: boolean }, msg: string) => {
    // expiration dates can't be in the past
    if (body.expiresAt && body.expiresAt < todayISO()) {
      toast("Choose today or a later expiration date", "error");
      return false;
    }
    setBusy(key);
    try {
      await api.patch(docPath(doc), body);
      toast(msg);
      onChanged();
      publish("providers");
      return true;
    } catch (e) {
      toast(errorMessage(e), "error");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const removeFile = async () => {
    setBusy("remove");
    try {
      if (doc.extra) await api.delete(docPath(doc));
      else await api.delete<DocumentRow>("/documents/" + doc.id + "/file");
      toast(doc.extra ? "Document removed" : "File removed");
      setConfirmRemove(false);
      onChanged();
      publish("providers");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const daysLeft = doc.daysUntilExpiry;

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-ink">
          {doc.label}
          {doc.extra && <div className="text-[10px] font-normal text-ink-faint">Additional document</div>}
        </div>
        <button onClick={onClose} className="btn-ghost p-1" aria-label="Close details"><Icon name="X" size={14} /></button>
      </div>
      <div className="space-y-3 text-sm">
        <ValField label="File Name" val={doc.fileName} />
        {doc.originalRelativePath && <ValField label="Synced From" val={<span className="font-mono text-xs">{doc.originalRelativePath}</span>} />}
        {doc.expiresAt && (
          <ValField
            label="Expiration"
            val={
              <span style={daysLeft !== null && daysLeft < 0 ? { color: "var(--danger)" } : undefined}>
                {fmtDate(doc.expiresAt)}
                {daysLeft !== null && <span className="text-xs text-ink-faint"> · {daysLeft < 0 ? Math.abs(daysLeft) + " days ago" : daysLeft + " days left"}</span>}
              </span>
            }
          />
        )}
        {doc.uploadedAt && <ValField label="Uploaded" val={fmtDate(doc.uploadedAt)} />}
        <ValField label="Status" val={<DocStatusBadge status={doc.status} />} />
      </div>

      {canReview && doc.expires && editExpiry && (
        <div className="mt-3 flex items-end gap-2">
          <Field label="Expiration Date" className="flex-1">
            <input type="date" min={todayISO()} value={expiry} onChange={(e) => setExpiry(e.target.value)} className="input input-sm" />
          </Field>
          <button
            className="btn btn-primary"
            style={{ fontSize: 11, padding: "5px 10px" }}
            disabled={busy !== null}
            onClick={() => (expiry ? patch("expiry", { expiresAt: expiry }, "Expiration updated") : patch("expiry", { clearExpiresAt: true }, "Expiration cleared")).then((ok) => ok && setEditExpiry(false))}
          >
            {busy === "expiry" ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name="Check" size={11} />} Save
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setEditExpiry(false)}>Cancel</button>
        </div>
      )}

      {doc.hasFile && isWordFile(doc.fileName, doc.mimeType) && (
        <div className="mt-4 text-xs rounded-md px-3 py-2 flex items-start gap-2" style={{ background: "var(--bg-soft)", color: "var(--ink-light)" }}>
          <Icon name="Info" size={13} className="mt-0.5" />
          <span>Word documents can&apos;t be viewed in the browser — please download the file to open and verify it.</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-line">
        <ViewFileButton doc={doc} label />
        <DownloadButton doc={doc} label />
        {canReview && doc.status !== "approved" && (
          <button className="btn btn-primary" style={{ fontSize: 11, padding: "5px 10px" }} disabled={busy !== null} onClick={() => patch("approve", { status: "approved" }, doc.label + " approved")}>
            {busy === "approve" ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name="CheckCircle2" size={11} />} Approve
          </button>
        )}
        {canReview && doc.status === "pending_review" && (
          <button className="btn btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }} disabled={busy !== null} onClick={() => patch("reject", { status: "missing" }, doc.label + " rejected")}>
            {busy === "reject" ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name="XCircle" size={11} />} Reject
          </button>
        )}
        {canReview && doc.status !== "na" && (
          <button className="btn btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }} disabled={busy !== null} onClick={() => patch("na", { status: "na" }, doc.label + " marked N/A")}>
            {busy === "na" ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name="MinusCircle" size={11} />} Mark N/A
          </button>
        )}
        {canReview && doc.status === "na" && (
          <button className="btn btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }} disabled={busy !== null} onClick={() => patch("required", { status: doc.hasFile ? "pending_review" : "missing" }, doc.label + " is required again")}>
            {busy === "required" ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name="RotateCcw" size={11} />} Mark Required
          </button>
        )}
        {canReview && doc.expires && !editExpiry && (
          <button className="btn btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }} onClick={() => setEditExpiry(true)}>
            <Icon name="Pencil" size={11} /> Edit Expiration
          </button>
        )}
        {canRemove && doc.hasFile && (
          <button className="btn btn-ghost hover:text-red-600" style={{ fontSize: 11, padding: "5px 10px" }} disabled={busy !== null} onClick={() => setConfirmRemove(true)}>
            <Icon name="Trash2" size={11} /> {doc.extra ? "Remove Document" : "Remove File"}
          </button>
        )}
      </div>

      {confirmRemove && (
        <ConfirmDialog
          title={doc.extra ? "Remove document?" : "Remove file?"}
          message={
            doc.extra ? (
              <>
                The additional document <strong>{doc.label}</strong> ({doc.fileName}) will be removed.
              </>
            ) : (
              <>
                The file <strong>{doc.fileName}</strong> will be deleted and {doc.label} becomes <strong>Missing</strong>.
              </>
            )
          }
          confirmLabel={doc.extra ? "Remove Document" : "Remove File"}
          busy={busy === "remove"}
          onConfirm={removeFile}
          onClose={() => setConfirmRemove(false)}
        />
      )}
    </div>
  );
}

// ---------- Primary Source Verification (PSV rows L2022 + manual results) ----------

function PrimarySourceVerification({ provider }: { provider: ProviderDetail }) {
  const toast = useToast();
  const { can, user } = useAuth();
  const { publish } = useShell();
  const history = useAsync(() => api.get<Verification[]>("/providers/" + provider.id + "/verifications"), [provider.id]);
  const [deferredMsg, setDeferredMsg] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [recording, setRecording] = useState<VerificationSource | null>(null);
  const [form, setForm] = useState<{ status: "clear" | "flagged"; message: string }>({ status: "clear", message: "" });
  const [formError, setFormError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const canWrite = user?.role !== "provider" && user?.role !== "auditor" && can("update", "provider");

  const run = async () => {
    setRunning(true);
    try {
      const res = await api.post<DeferredResponse>("/providers/" + provider.id + "/verifications/run");
      setDeferredMsg(res.message);
      toast(res.message, "info");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setRunning(false);
    }
  };

  const save = async () => {
    if (!recording) return;
    if (form.message.length > 500) {
      setFormError("Max 500 characters");
      return;
    }
    setSaving(true);
    setFormError(undefined);
    try {
      await api.post<Verification>("/providers/" + provider.id + "/verifications", { source: recording, status: form.status, message: form.message.trim() || undefined });
      toast(form.status === "flagged" ? "Flagged result recorded" : "Verification recorded");
      setRecording(null);
      setForm({ status: "clear", message: "" });
      history.reload();
      if (form.status === "flagged") publish("notifications");
    } catch (e) {
      if (e instanceof ApiError) setFormError(e.fieldErrors.message || e.fieldErrors.source || e.fieldErrors.status);
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const list = history.data || [];
  const latest = (s: VerificationSource) => list.find((v) => v.source === s);

  return (
    <div className="card">
      <div className="p-5 pb-3 border-b border-line flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="Search" size={16} style={{ color: "var(--accent)" }} />
          <h3 className="font-display font-semibold text-ink">Primary Source Verification</h3>
        </div>
        <button onClick={run} disabled={running} className="btn btn-primary" style={{ fontSize: 11, padding: "4px 10px" }}>
          {running ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name="Play" size={11} />} Run All Checks
        </button>
      </div>
      {deferredMsg && (
        <div className="px-4 pt-3">
          <DeferredNotice>{deferredMsg}</DeferredNotice>
        </div>
      )}
      <div className="divide-y divide-gray-100">
        {PSV_CHECKS.map((c) => {
          const last = latest(c.source);
          return (
            <div key={c.source}>
              <PSVRow icon={c.icon} iconColor={c.iconColor} iconBg={c.iconBg} title={c.title} subtitle={c.subtitle} action={c.action} onClick={run} busy={running}>
                {last && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <Pill type={last.status === "clear" ? "success" : "danger"}>{last.status === "clear" ? "Clear" : "Flagged"}</Pill>
                    <span className="text-[10px] text-ink-faint">{fmtDateShort(last.checkedAt)}</span>
                  </div>
                )}
                {canWrite && recording !== c.source && (
                  <button
                    className="text-[11px] text-accent hover:underline mt-1"
                    onClick={() => {
                      setRecording(c.source);
                      setForm({ status: "clear", message: "" });
                      setFormError(undefined);
                    }}
                  >
                    Record result
                  </button>
                )}
              </PSVRow>
              {recording === c.source && (
                <div className="px-4 pb-4 -mt-1">
                  <div className="p-3 rounded-lg space-y-2" style={{ background: "var(--bg-soft)" }}>
                    <div className="text-xs font-semibold text-ink">Record manual {c.title} result</div>
                    <div className="flex gap-2">
                      {(["clear", "flagged"] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, status: s }))}
                          className={"btn " + (form.status === s ? "btn-primary" : "btn-secondary")}
                          style={{ fontSize: 11, padding: "4px 10px" }}
                        >
                          <Icon name={s === "clear" ? "CheckCircle2" : "AlertTriangle"} size={11} /> {s === "clear" ? "Clear" : "Flagged"}
                        </button>
                      ))}
                    </div>
                    <Field error={formError}>
                      <textarea
                        value={form.message}
                        onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                        className="input"
                        rows={2}
                        maxLength={500}
                        placeholder="Source checked, reference number, findings…"
                      />
                    </Field>
                    <div className="flex justify-end gap-2">
                      <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setRecording(null)} disabled={saving}>Cancel</button>
                      <button className="btn btn-primary" style={{ fontSize: 11, padding: "4px 10px" }} onClick={save} disabled={saving}>
                        {saving ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name="Save" size={11} />} Save Result
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Verification history */}
      <div className="border-t border-line p-4">
        <div className="text-xs font-semibold text-ink-faint uppercase tracking-wider mb-2">Verification History</div>
        {history.error ? (
          <div className="text-xs" style={{ color: "var(--danger)" }}>
            {history.error}{" "}
            <button className="underline" onClick={history.reload}>Retry</button>
          </div>
        ) : history.loading && !history.data ? (
          <div className="text-xs text-ink-faint flex items-center gap-2"><span className="loader" /> Loading…</div>
        ) : list.length === 0 ? (
          <div className="text-xs text-ink-faint italic">No verifications recorded yet.</div>
        ) : (
          <div className="space-y-2">
            {(showAll ? list : list.slice(0, 5)).map((v) => (
              <div key={v.id} className="flex items-start gap-2 text-xs">
                <Icon name={v.status === "clear" ? "CheckCircle2" : "AlertTriangle"} size={12} style={{ color: v.status === "clear" ? "var(--success)" : "var(--danger)", marginTop: 1 }} />
                <div className="flex-1 min-w-0">
                  <div className="text-ink">
                    <span className="font-medium">{v.sourceLabel}</span> · {v.status === "clear" ? "Clear" : "Flagged"}
                  </div>
                  {v.message && <div className="text-ink-light">{v.message}</div>}
                  <div className="text-[10px] text-ink-faint">
                    {fmtTs(v.checkedAt)}
                    {v.runByName ? " · " + v.runByName : ""}
                  </div>
                </div>
              </div>
            ))}
            {list.length > 5 && (
              <button className="text-[11px] text-accent hover:underline" onClick={() => setShowAll((s) => !s)}>
                {showAll ? "Show less" : "Show all " + list.length}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PSVRow({
  icon,
  iconColor,
  iconBg,
  title,
  subtitle,
  action,
  onClick,
  busy,
  children,
}: {
  icon: string;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  action: string;
  onClick: () => void;
  busy?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: iconBg, color: iconColor }}>
        <Icon name={icon} size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink">{title}</div>
        <div className="text-xs text-ink-light">{subtitle}</div>
        {children}
      </div>
      <button onClick={onClick} disabled={busy} className="btn btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }}>
        <Icon name="Search" size={11} /> {action}
      </button>
    </div>
  );
}
