"use client";

import { useState } from "react";
import { DocStatusBadge } from "@/components/Pill";
import { ErrorState } from "@/components/AsyncState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { BlurLoader } from "@/components/BusyOverlay";
import { ApiError, api, errorMessage } from "@/lib/api";
import { fmtDate, todayISO } from "@/lib/utils";
import { useAsync } from "@/lib/hooks";
import { useToast } from "@/stores/toast";
import { DOC_UPLOAD_EXT, fileExt, MAX_FILE_BYTES } from "./shared";
import { MandatoryMark, isWordFile } from "./ProviderOverview";
import type { AdditionalDocument } from "@/types/providers";

/**
 * Extra documents of a provider, besides the required list. The provider adds them with Add More Document
 * (My Documents header). Shown only once there is at least one. (Staff see them in the provider's documents table.)
 * `reloadKey` changes after a document was added, to load the list again.
 */
export function AdditionalDocuments({ providerId, reloadKey = 0 }: { providerId: number; reloadKey?: number }) {
  const state = useAsync(() => api.get<AdditionalDocument[]>("/providers/" + providerId + "/additional-documents"), [providerId, reloadKey]);
  const docs = state.data || [];
  const [replacing, setReplacing] = useState<AdditionalDocument | null>(null);
  if (!state.error && docs.length === 0) return null;
  return (
    <div className="card mt-4" id="additional-documents">
      <div className="p-5 pb-3 border-b border-line flex items-center gap-2 flex-wrap">
        <Icon name="FilePlus" size={16} style={{ color: "var(--accent)" }} />
        <h3 className="font-display font-semibold text-ink">Additional Documents</h3>
        <span className="text-xs text-ink-faint">{docs.length ? docs.length + (docs.length === 1 ? " document" : " documents") : ""}</span>
      </div>
      {state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : (
        <div className="table-scroll">
          <table>
            <DocTableCols />
            <thead>
              <tr>
                <th>Document</th>
                <th>Status</th>
                <th>Mandatory</th>
                <th>Expires</th>
                <th>Last Updated</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="font-medium">
                    {d.docTypeLabel}
                    {d.fileName && <div className="text-[10px] text-ink-faint font-normal truncate" style={{ maxWidth: 320 }}>{d.fileName}</div>}
                  </td>
                  <td>
                    <DocStatusBadge status={d.status} />
                  </td>
                  <td className="text-xs">
                    <MandatoryMark yes={false} />
                  </td>
                  <td className="text-ink-light text-xs">{d.expiresAt ? fmtDate(d.expiresAt) : "—"}</td>
                  <td className="text-ink-light text-xs">{fmtDate(d.uploadedAt)}</td>
                  <td className="text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <ExtraFileButton doc={d} inline />
                      <ExtraFileButton doc={d} />
                      <button
                        className="btn btn-primary ml-1"
                        style={{ fontSize: 11, padding: "5px 10px" }}
                        aria-label={"Replace " + d.docTypeLabel}
                        onClick={() => setReplacing(d)}
                      >
                        <Icon name="RefreshCw" size={11} /> Replace
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {replacing && (
        <AddMoreDocumentModal
          providerId={providerId}
          replace={replacing}
          onClose={() => setReplacing(null)}
          onSaved={() => {
            setReplacing(null);
            state.reload();
          }}
        />
      )}
    </div>
  );
}

/** Column widths shared by My Documents and Additional Documents, so the two tables line up. */
export function DocTableCols() {
  return (
    <colgroup>
      <col style={{ width: "30%" }} />
      <col style={{ width: "13%" }} />
      <col style={{ width: "10%" }} />
      <col style={{ width: "12%" }} />
      <col style={{ width: "13%" }} />
      <col style={{ width: "22%" }} />
    </colgroup>
  );
}

/** View (opens in a new tab; not for Word files, which browsers cannot show) or Download. */
function ExtraFileButton({ doc, inline }: { doc: AdditionalDocument; inline?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (inline && isWordFile(doc.fileName, doc.mimeType)) return null;
  const path = "/additional-documents/" + doc.id + "/download";
  return (
    <button
      className="btn-ghost p-1"
      title={inline ? "View file in a new tab" : "Download"}
      aria-label={(inline ? "View file " : "Download ") + (doc.fileName || doc.docTypeLabel)}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          if (inline) await api.openInNewTab(path, { inline: true });
          else await api.download(path, { inline: false }, doc.fileName || "document");
        } catch (err) {
          toast(errorMessage(err), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name={inline ? "Eye" : "Download"} size={13} />}
    </button>
  );
}

/** Add More Document; with `replace`, replaces that document's file (its document type can't be changed). */
export function AddMoreDocumentModal({ providerId, replace, onClose, onSaved }: { providerId: number; replace?: AdditionalDocument; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ docType: replace?.docTypeLabel || "", expiresAt: replace?.expiresAt && replace.expiresAt >= todayISO() ? replace.expiresAt : "" });
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: "" }));
  };

  const pickFile = (f: File | null) => {
    setErrors((e) => ({ ...e, file: "" }));
    if (!f) return setFile(null);
    if (!DOC_UPLOAD_EXT.includes(fileExt(f.name))) {
      setFile(null);
      return setErrors((e) => ({ ...e, file: "Only PDF, Word, JPG or PNG files can be uploaded" }));
    }
    if (f.size > MAX_FILE_BYTES) {
      setFile(null);
      return setErrors((e) => ({ ...e, file: "The file is larger than 25 MB" }));
    }
    setFile(f);
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (!form.docType.trim()) e.docType = "Required";
    if (!file) e.file = "Required";
    if (form.expiresAt && form.expiresAt < todayISO()) e.expiresAt = "Choose today or a later date";
    setErrors(e);
    if (Object.keys(e).length) return;
    const fd = new FormData();
    fd.append("file", file as File);
    if (!replace) fd.append("docType", form.docType.trim());
    if (form.expiresAt) fd.append("expiresAt", form.expiresAt);
    setBusy(true);
    try {
      if (replace) await api.upload("/additional-documents/" + replace.id + "/file", fd);
      else await api.upload("/providers/" + providerId + "/additional-documents", fd);
      toast(replace ? "Document replaced" : "Document added");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={replace ? "Replace Document" : "Add More Document"}
      subtitle={replace ? "Upload a new file for this document. It is reviewed again." : "Give your credentialing team another document."}
      onClose={busy ? undefined : onClose}
      maxWidth={560}
    >
      <BlurLoader show={busy} label="Uploading document, please wait" />
      <div className="space-y-3">
        <Field label="Document Type" required error={errors.docType} hint={replace ? (replace.fileName ? "Current file: " + replace.fileName : undefined) : "Type the name of the document, e.g. Fellowship Certificate"}>
          <input
            readOnly={!!replace}
            disabled={!!replace}
            value={form.docType}
            onChange={(e) => set("docType", e.target.value.replace(/^\s+/, ""))}
            className="input"
            maxLength={150}
            placeholder="Enter Document Type"
            aria-label="Document Type"
            autoComplete="off"
          />
        </Field>
        <Field label="File" required error={errors.file}>
          {file ? (
            <div className="flex items-center gap-3 rounded-lg border border-line p-3" style={{ background: "var(--accent-soft)" }}>
              <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 40, height: 40, background: "var(--surface, #fff)" }}>
                <Icon name="FileText" size={20} style={{ color: "var(--accent)" }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink truncate">{file.name}</div>
                <div className="text-[11px] text-ink-faint">{(file.size / 1024 / 1024 < 0.1 ? Math.max(1, Math.round(file.size / 1024)) + " KB" : (file.size / 1024 / 1024).toFixed(1) + " MB")}</div>
              </div>
              <label className="btn btn-secondary cursor-pointer" style={{ fontSize: 11, padding: "5px 10px" }}>
                Change
                <input type="file" className="hidden" accept={DOC_UPLOAD_EXT.map((x) => "." + x).join(",")} onChange={(e) => pickFile(e.target.files?.[0] || null)} />
              </label>
              <button className="btn-ghost p-1" aria-label="Remove file" title="Remove file" onClick={() => setFile(null)}>
                <Icon name="X" size={14} />
              </button>
            </div>
          ) : (
            <label
              className="flex flex-col items-center justify-center gap-1.5 rounded-lg cursor-pointer text-center px-4 py-6 transition-colors"
              style={{
                border: "2px dashed " + (dragOver ? "var(--accent)" : errors.file ? "var(--danger)" : "var(--line, #d6d3d1)"),
                background: dragOver ? "var(--accent-soft)" : "transparent",
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                pickFile(e.dataTransfer.files?.[0] || null);
              }}
            >
              <div className="flex items-center justify-center rounded-full" style={{ width: 44, height: 44, background: "var(--accent-soft)" }}>
                <Icon name="UploadCloud" size={22} style={{ color: "var(--accent)" }} />
              </div>
              <div className="text-sm text-ink">
                <span className="font-semibold" style={{ color: "var(--accent)" }}>Click to choose a file</span> or drag it here
              </div>
              <div className="text-[11px] text-ink-faint">PDF, Word, JPG or PNG · up to 25 MB</div>
              <input type="file" className="hidden" accept={DOC_UPLOAD_EXT.map((x) => "." + x).join(",")} onChange={(e) => pickFile(e.target.files?.[0] || null)} aria-label="File" />
            </label>
          )}
        </Field>
        <Field label="Expiration Date" error={errors.expiresAt}>
          <input type="date" min={todayISO()} value={form.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} className="input" />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          <Icon name={replace ? "RefreshCw" : "Upload"} size={13} /> {replace ? "Replace Document" : "Add Document"}
        </button>
      </div>
    </Modal>
  );
}
