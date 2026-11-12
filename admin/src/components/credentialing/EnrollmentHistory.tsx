"use client";

import { Select } from "@/components/Select";

import { useState } from "react";
import { AsyncBoundary } from "@/components/AsyncState";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { StatusPill } from "@/components/Pill";
import { useShell } from "@/stores/shell";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { fmtDate, fmtTs } from "@/lib/utils";
import { useAsync } from "@/lib/hooks";
import { useToast } from "@/stores/toast";
import type { EnrollmentDetail, EnrollmentEvent } from "@/types/credentialing";

const TYPE_MAP: Record<string, { icon: string; color: string; label: string }> = {
  created: { icon: "Plus", color: "var(--info)", label: "Enrollment record created" },
  docs_collected: { icon: "FileCheck2", color: "var(--success)", label: "All required documents gathered" },
  submitted: { icon: "Send", color: "var(--accent)", label: "Submitted to payer" },
  ack: { icon: "CheckCircle2", color: "var(--info)", label: "Payer acknowledged receipt" },
  follow_up: { icon: "Phone", color: "var(--warn)", label: "Follow-up" },
  approved: { icon: "Award", color: "var(--success)", label: "Approved" },
  welcome: { icon: "Mail", color: "var(--success)", label: "Welcome letter received" },
  denied: { icon: "XCircle", color: "var(--danger)", label: "Application returned" },
  terminated: { icon: "XCircle", color: "var(--danger)", label: "Terminated" },
  note: { icon: "StickyNote", color: "var(--ink-light)", label: "Note" },
  status_change: { icon: "ArrowRightLeft", color: "var(--accent)", label: "Status changed" },
  resubmitted: { icon: "RotateCcw", color: "var(--accent)", label: "Resubmitted" },
  recredential_started: { icon: "RefreshCw", color: "var(--info)", label: "Re-credentialing started" },
  submission_queued: { icon: "Send", color: "var(--info)", label: "Payer submission queued" },
  submission_update: { icon: "Activity", color: "var(--info)", label: "Payer submission updated" },
};

/** Detail mode of EnrollmentStatusView: header + timeline from enrollment events, Add Note, Resubmit. */
export function EnrollmentHistory({ enrollmentId, onBack, onChanged }: { enrollmentId: number; onBack: () => void; onChanged: () => void }) {
  const { can } = useAuth();
  const { publish } = useShell();
  const canUpdate = can("update", "enrollment");
  const [modal, setModal] = useState<"note" | "resubmit" | null>(null);
  const { data, loading, error, reload } = useAsync(() => api.get<EnrollmentDetail>(`/enrollments/${enrollmentId}`), [enrollmentId]);

  const changed = () => {
    reload();
    onChanged();
    publish("enrollments");
  };

  const e = data?.enrollment;
  const events: EnrollmentEvent[] = data?.events ?? [];

  return (
    <div>
      <button onClick={onBack} className="btn btn-ghost mb-4"><Icon name="ChevronLeft" size={14} /> Back to all enrollments</button>

      <AsyncBoundary loading={loading && !data} error={error} onRetry={reload}>
        {e && (
          <>
            <div className="card card-pad mb-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={e.providerName} size={48} />
                  <div>
                    <h1 className="font-display text-2xl font-bold text-ink">{e.providerName}</h1>
                    <div className="flex items-center gap-2 text-sm text-ink-light mt-1 flex-wrap">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: e.payerColor }}></div>
                      <span className="font-medium">{e.payerName}</span>
                      <span>·</span>
                      <span>NPI {e.providerNpi || "—"}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <StatusPill status={e.status} />
                  {e.submittedDate && <div className="text-xs text-ink-light mt-2">Submitted {fmtDate(e.submittedDate)}</div>}
                  {e.effectiveDate && <div className="text-xs text-ink-light">Approved {fmtDate(e.effectiveDate)}</div>}
                  {e.tatDays != null && <div className="text-xs font-semibold mt-1">TAT: {e.tatDays} days</div>}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="p-4 border-b border-line flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="font-display font-semibold text-ink">Enrollment History</h3>
                  <p className="text-xs text-ink-light mt-1">{events.length} event(s) logged</p>
                </div>
                {canUpdate && (
                  <div className="flex items-center gap-2">
                    {e.status !== "approved" && (
                      <button onClick={() => setModal("resubmit")} className="btn btn-secondary text-xs"><Icon name="RotateCcw" size={11} /> Resubmit</button>
                    )}
                    <button onClick={() => setModal("note")} className="btn btn-secondary text-xs"><Icon name="Plus" size={11} /> Add Note</button>
                  </div>
                )}
              </div>
              <div className="p-5">
                {events.length === 0 ? (
                  <EmptyState icon="Clock" title="No events logged" />
                ) : (
                  <div className="space-y-3">
                    {events.map((ev, i) => {
                      const t = TYPE_MAP[ev.type] || TYPE_MAP.created;
                      return (
                        <div key={ev.id} className="flex gap-3">
                          <div className="flex flex-col items-center" style={{ paddingTop: 4 }}>
                            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--bg-soft)", color: t.color }}>
                              <Icon name={t.icon} size={14} />
                            </div>
                            {i < events.length - 1 && <div className="w-px flex-1" style={{ background: "var(--border)", minHeight: 16, marginTop: 4 }}></div>}
                          </div>
                          <div className="flex-1 pb-3">
                            <div className="text-sm font-medium text-ink" style={{ whiteSpace: "pre-wrap" }}>
                              {ev.note || t.label}
                              {ev.confirmationNumber && <span className="text-ink-light font-normal"> — confirmation #{ev.confirmationNumber}</span>}
                            </div>
                            <div className="text-xs text-ink-light mt-0.5">
                              {fmtTs(ev.occurredAt)} · by {ev.actorLabel || "System"}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </AsyncBoundary>

      {modal && e && <EventModal mode={modal} enrollmentId={e.id} onClose={() => setModal(null)} onSaved={changed} />}
    </div>
  );
}

function EventModal({ mode, enrollmentId, onClose, onSaved }: { mode: "note" | "resubmit"; enrollmentId: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<"note" | "follow_up">("note");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (mode === "note" && !note.trim()) {
      setError("Note is required");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (mode === "note") {
        await api.post(`/enrollments/${enrollmentId}/events`, { type, note: note.trim() });
        toast(type === "follow_up" ? "Follow-up logged" : "Note added");
      } else {
        await api.post(`/enrollments/${enrollmentId}/resubmit`, note.trim() ? { note: note.trim() } : {});
        toast("Enrollment resubmitted");
      }
      onSaved();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.note) setError(e.fieldErrors.note);
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={mode === "note" ? "Add Note" : "Resubmit Enrollment"}
      subtitle={mode === "note" ? "Log a note or follow-up on this enrollment's history." : "Moves the enrollment back to In Progress and logs a resubmission event."}
      onClose={onClose}
      maxWidth={480}
    >
      <div className="space-y-3">
        {mode === "note" && (
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as "note" | "follow_up")} className="input">
              <option value="note">Note</option>
              <option value="follow_up">Follow-up</option>
            </Select>
          </Field>
        )}
        <Field label={mode === "note" ? "Note" : "Note (optional)"} error={error} required={mode === "note"}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} className={"input " + (error ? "input-error" : "")} rows={3} autoFocus
                    placeholder="Enter Note" />
        </Field>
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={save} disabled={busy} className="btn btn-primary">
            {busy ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name={mode === "note" ? "Plus" : "RotateCcw"} size={13} />} {mode === "note" ? "Add Note" : "Resubmit"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
