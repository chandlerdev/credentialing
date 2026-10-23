"use client";

import { useState } from "react";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { api, ApiError, errorMessage } from "@/lib/api";
import { fmtDateShort, fmtTs } from "@/lib/utils";
import { useToast } from "@/stores/toast";

const MAX_NOTES = 5000;

/**
 * Notes column of a table (provider documents, enrollments): the start of the note (2 lines), who changed it and when,
 * and an editor in a popup for the full text. Saves with PUT `path` { notes }.
 */
export function NotesCell<T>({
  notes,
  updatedAt,
  updatedBy,
  path,
  title,
  subtitle,
  canEdit,
  onSaved,
  compact,
}: {
  notes?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  /** PUT endpoint for { notes } */
  path: string;
  title: string;
  subtitle?: string;
  canEdit: boolean;
  onSaved: (saved: T) => void;
  /** narrow tables: a smaller cell, the date only (who wrote it is in the tooltip) */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const text = (notes || "").trim();

  return (
    <div onClick={(e) => e.stopPropagation()} style={compact ? { minWidth: 130, maxWidth: 170 } : { minWidth: 170, maxWidth: 260 }}>
      {text ? (
        <button type="button" onClick={() => setOpen(true)} className="text-left w-full group" title="Open notes">
          <div
            className="text-xs text-ink whitespace-pre-line"
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word" }}
          >
            {text}
          </div>
          <div className="flex items-center gap-1 mt-0.5 text-[10px] text-ink-faint">
            {(updatedBy || updatedAt) && (
              <span className="truncate" title={[updatedBy, updatedAt && fmtTs(updatedAt)].filter(Boolean).join(" · ")}>
                {compact ? (updatedAt ? fmtDateShort(updatedAt) : updatedBy) : [updatedBy, updatedAt && fmtTs(updatedAt)].filter(Boolean).join(" · ")}
              </span>
            )}
            <span className="ml-auto shrink-0 inline-flex" style={{ color: "var(--accent)" }} aria-label={canEdit ? "Edit notes" : "View notes"}>
              <Icon name={canEdit ? "Pencil" : "Eye"} size={12} />
            </span>
          </div>
        </button>
      ) : canEdit ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs rounded-md px-2 py-1" style={{ color: "var(--ink-light)", border: "1px dashed var(--border-strong)" }}>
          <Icon name="Plus" size={11} /> {compact ? "Note" : "Add note"}
        </button>
      ) : (
        <span className="text-xs text-ink-faint">—</span>
      )}
      {open && (
        <NotesModal
          notes={text}
          updatedAt={updatedAt}
          updatedBy={updatedBy}
          path={path}
          title={title}
          subtitle={subtitle}
          canEdit={canEdit}
          onClose={() => setOpen(false)}
          onSaved={(saved: T) => {
            setOpen(false);
            onSaved(saved);
          }}
        />
      )}
    </div>
  );
}

function NotesModal<T>({
  notes,
  updatedAt,
  updatedBy,
  path,
  title,
  subtitle,
  canEdit,
  onClose,
  onSaved,
}: {
  notes: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  path: string;
  title: string;
  subtitle?: string;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (saved: T) => void;
}) {
  const toast = useToast();
  const [value, setValue] = useState(notes);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const dirty = value.trim() !== notes;

  const save = async () => {
    if (value.length > MAX_NOTES) return setError("Notes can be at most " + MAX_NOTES + " characters");
    setSaving(true);
    setError(undefined);
    try {
      const saved = await api.put<T>(path, { notes: value.trim() || null });
      toast(value.trim() ? "Notes saved" : "Notes cleared");
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.notes) setError(e.fieldErrors.notes);
      else toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={title} subtitle={subtitle} onClose={saving ? undefined : onClose} maxWidth={620}>
      {canEdit ? (
        <>
          <Field
            error={error}
            hint={
              <span className="flex items-center justify-end gap-2">
                <span className="font-mono shrink-0" style={{ color: value.length > MAX_NOTES ? "var(--danger)" : undefined }}>
                  {value.length}/{MAX_NOTES}
                </span>
              </span>
            }
          >
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="input"
              rows={10}
              maxLength={MAX_NOTES}
              placeholder="e.g. Oct 23 – Called the provider, the renewed license will be sent by Friday."
              autoFocus
              style={{ resize: "vertical", minHeight: 160, lineHeight: 1.5 }}
              aria-label="Notes"
            />
          </Field>
          <div className="flex items-center justify-end gap-2 mt-2 flex-wrap">
            {(updatedBy || updatedAt) && (
              <span className="text-[11px] text-ink-faint">Last updated {[updatedBy && "by " + updatedBy, updatedAt && fmtTs(updatedAt)].filter(Boolean).join(" · ")}</span>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-4 mt-3 border-t border-line">
            <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
              {saving ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Save" size={13} />} Save Notes
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="text-sm text-ink whitespace-pre-line rounded-lg p-3" style={{ background: "var(--bg-soft)", wordBreak: "break-word", maxHeight: 420, overflowY: "auto" }}>
            {notes}
          </div>
          {(updatedBy || updatedAt) && <div className="text-[11px] text-ink-faint mt-2">Last updated {[updatedBy && "by " + updatedBy, updatedAt && fmtTs(updatedAt)].filter(Boolean).join(" · ")}</div>}
        </>
      )}
    </Modal>
  );
}
