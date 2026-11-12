"use client";

import { Select } from "@/components/Select";

import { useEffect, useState } from "react";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Loading } from "@/components/AsyncState";
import { Pill } from "@/components/Pill";
import { useShell } from "@/stores/shell";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { fmtDate, fmtTs, todayISO } from "@/lib/utils";
import { useAsync } from "@/lib/hooks";
import { useToast } from "@/stores/toast";
import type { FollowUp, FollowUpType, TimeEntry } from "@/types/providers";

const fmtClock = (s: number) => {
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
};

/** Local date-time without zone ("2026-05-19T08:00:00"), as the API expects. */
const localIso = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
};

const timerKey = (providerId: number) => "zc_timer_" + providerId;

function readTimer(providerId: number): number | null {
  try {
    const v = localStorage.getItem(timerKey(providerId));
    return v ? Number(v) || null : null;
  } catch {
    return null;
  }
}
function writeTimer(providerId: number, start: number | null) {
  try {
    if (start == null) localStorage.removeItem(timerKey(providerId));
    else localStorage.setItem(timerKey(providerId), String(start));
  } catch {
    /* storage unavailable */
  }
}

/** Prototype TimeTrackerWidget (L3879) — live timer; entries persisted via the API. */
export function TimeTrackerWidget({ providerId, providerName }: { providerId: number; providerName: string }) {
  const toast = useToast();
  const { can, user } = useAuth();
  const entries = useAsync(() => api.get<TimeEntry[]>("/providers/" + providerId + "/time-entries"), [providerId]);
  // The running timer survives navigation (per-browser convenience only).
  // (Rendered only client-side behind the auth shell, so reading storage in the initializer is safe.)
  const [running, setRunning] = useState<number | null>(() => readTimer(providerId));
  const [elapsed, setElapsed] = useState(() => {
    const saved = readTimer(providerId);
    return saved ? Math.floor((Date.now() - saved) / 1000) : 0;
  });
  const [showLog, setShowLog] = useState(false);
  const [stopping, setStopping] = useState<{ start: number; end: number; seconds: number } | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<TimeEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const canWrite = user?.role !== "auditor" && can("update", "provider");
  const isAdmin = user?.role === "org_admin" || user?.role === "platform_admin";

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - running) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);

  const start = () => {
    const now = Date.now();
    setRunning(now);
    setElapsed(0);
    writeTimer(providerId, now);
  };
  const stop = () => {
    if (!running) return;
    const end = Date.now();
    setStopping({ start: running, end, seconds: Math.max(0, Math.floor((end - running) / 1000)) });
    setNote("");
  };
  const discard = () => {
    setStopping(null);
    setRunning(null);
    setElapsed(0);
    writeTimer(providerId, null);
  };

  const save = async () => {
    if (!stopping) return;
    setSaving(true);
    try {
      await api.post<TimeEntry>("/providers/" + providerId + "/time-entries", {
        startedAt: localIso(stopping.start),
        endedAt: localIso(stopping.end),
        seconds: stopping.seconds,
        note: note.trim() || undefined,
      });
      toast("Logged " + Math.round(stopping.seconds / 60) + " min on " + providerName);
      discard();
      entries.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete("/time-entries/" + deleting.id);
      toast("Time entry deleted");
      setDeleting(null);
      entries.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setDeleteBusy(false);
    }
  };

  const list = entries.data || [];
  const totalSecs = list.reduce((sum, t) => sum + (t.seconds || 0), 0);

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon name="Clock" size={16} style={{ color: "var(--accent)" }} />
          <h3 className="font-display font-semibold text-ink">Time Tracker</h3>
        </div>
        <button onClick={() => setShowLog(true)} className="btn btn-ghost" style={{ fontSize: 11 }}>
          View Log ({list.length})
        </button>
      </div>
      <div className="flex items-center gap-3">
        <div className="font-mono text-3xl font-bold text-ink" style={{ minWidth: 120, fontVariantNumeric: "tabular-nums" }}>
          {fmtClock(elapsed)}
        </div>
        {canWrite &&
          (running ? (
            <button onClick={stop} className="btn btn-danger flex-1"><Icon name="Square" size={13} /> Stop &amp; Log</button>
          ) : (
            <button onClick={start} className="btn btn-primary flex-1"><Icon name="Play" size={13} /> Start Timer</button>
          ))}
      </div>
      <div className="text-xs text-ink-light mt-2">
        Total logged on this provider: <span className="font-semibold text-ink">{entries.loading && !entries.data ? "…" : fmtClock(totalSecs)}</span>
        {entries.error && (
          <span style={{ color: "var(--danger)" }}>
            {" "}
            · {entries.error} <button className="underline" onClick={entries.reload}>Retry</button>
          </span>
        )}
      </div>

      {stopping && (
        <Modal title="Log Time" subtitle={fmtClock(stopping.seconds) + " on " + providerName} onClose={() => setStopping(null)} maxWidth={480}>
          <div className="space-y-3">
            <Field label="What did you work on? (optional)">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} className="input" rows={3} maxLength={1000} autoFocus />
            </Field>
            <div className="flex justify-between gap-2 pt-3 border-t border-line">
              <button onClick={discard} className="btn btn-ghost" disabled={saving}><Icon name="Trash2" size={13} /> Discard</button>
              <div className="flex gap-2">
                <button onClick={() => setStopping(null)} className="btn btn-secondary" disabled={saving}>Keep Running</button>
                <button onClick={save} className="btn btn-primary" disabled={saving}>
                  {saving ? <span className="loader" /> : <Icon name="Check" size={13} />} Save Entry
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {showLog && (
        <Modal title="Time Log" subtitle={"All time entries for " + providerName} onClose={() => setShowLog(false)} maxWidth={680}>
          {entries.loading && !entries.data ? (
            <Loading compact />
          ) : list.length === 0 ? (
            <EmptyState icon="Clock" title="No entries yet" />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Date</th><th>Duration</th><th>Note</th><th>By</th><th></th></tr>
                </thead>
                <tbody>
                  {list.map((e) => (
                    <tr key={e.id}>
                      <td className="text-xs">{fmtTs(e.startedAt)}</td>
                      <td className="font-mono text-xs font-semibold">{fmtClock(e.seconds)}</td>
                      <td className="text-xs text-ink-light">{e.note || "—"}</td>
                      <td className="text-xs text-ink-light">{e.userName || "—"}</td>
                      <td className="text-right">
                        {canWrite && (isAdmin || e.userId === user?.id) && (
                          <button className="btn-ghost p-1 hover:text-red-600" onClick={() => setDeleting(e)} aria-label="Delete entry"><Icon name="Trash2" size={12} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete time entry?"
          message={"Delete the " + fmtClock(deleting.seconds) + " entry from " + fmtTs(deleting.startedAt) + "?"}
          busy={deleteBusy}
          onConfirm={remove}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/** Prototype FollowUpWidget (L3965). A next date creates a follow-up task server-side. */
export function FollowUpWidget({ providerId, providerName }: { providerId: number; providerName: string }) {
  const toast = useToast();
  const { can, user } = useAuth();
  const { publish } = useShell();
  const followUps = useAsync(() => api.get<FollowUp[]>("/providers/" + providerId + "/follow-ups"), [providerId]);
  const [show, setShow] = useState(false);
  const empty = { type: "phone_call" as FollowUpType, subject: "", outcome: "", nextDate: "" };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const canWrite = user?.role !== "auditor" && can("update", "provider");

  const save = async () => {
    const e: Record<string, string> = {};
    if (!form.subject.trim()) e.subject = "Required";
    else if (form.subject.length > 255) e.subject = "Max 255 characters";
    if (form.nextDate && form.nextDate < todayISO()) e.nextDate = "Must not be in the past";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const res = await api.post<FollowUp>("/providers/" + providerId + "/follow-ups", {
        type: form.type,
        subject: form.subject.trim(),
        outcome: form.outcome.trim() || undefined,
        nextDate: form.nextDate || undefined,
      });
      if (res.task) {
        toast("Follow-up logged · task created for " + fmtDate(res.task.dueDate));
        publish("tasks");
      } else {
        toast("Follow-up logged");
      }
      setForm(empty);
      setShow(false);
      followUps.reload();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const list = followUps.data || [];

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon name="Phone" size={16} style={{ color: "var(--accent)" }} />
          <h3 className="font-display font-semibold text-ink">Follow-ups</h3>
        </div>
        {canWrite && (
          <button
            onClick={() => {
              setErrors({});
              setShow(true);
            }}
            className="btn btn-primary"
            style={{ fontSize: 11, padding: "5px 10px" }}
          >
            <Icon name="Plus" size={11} /> Log Follow-up
          </button>
        )}
      </div>
      {followUps.error ? (
        <div className="text-xs" style={{ color: "var(--danger)" }}>
          {followUps.error} <button className="underline" onClick={followUps.reload}>Retry</button>
        </div>
      ) : followUps.loading && !followUps.data ? (
        <div className="text-xs text-ink-faint flex items-center gap-2"><span className="loader" /> Loading…</div>
      ) : list.length === 0 ? (
        <div className="text-xs text-ink-faint italic">No follow-ups logged. Click &quot;Log Follow-up&quot; to record a call, email, or note.</div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {list.map((f) => (
            <div key={f.id} className="p-3 rounded-lg border border-line">
              <div className="flex items-center justify-between mb-1 gap-2">
                <div className="flex items-center gap-1.5 text-xs text-ink-light flex-wrap">
                  <Icon name={f.type === "phone_call" ? "Phone" : f.type === "email" ? "Mail" : "MessageSquare"} size={11} />
                  <span className="capitalize">{f.type.replace("_", " ")}</span>
                  <span>·</span>
                  <span>{fmtTs(f.occurredAt)}</span>
                  {f.userName && (
                    <>
                      <span>·</span>
                      <span>{f.userName}</span>
                    </>
                  )}
                </div>
                {f.nextDate && <Pill type="accent">Next: {fmtDate(f.nextDate)}</Pill>}
              </div>
              <div className="text-sm font-medium text-ink">{f.subject}</div>
              {f.outcome && <div className="text-xs text-ink-light mt-1">{f.outcome}</div>}
            </div>
          ))}
        </div>
      )}
      {show && (
        <Modal title="Log Follow-up" subtitle={"For " + providerName} onClose={() => setShow(false)} maxWidth={520}>
          <div className="space-y-3">
            <Field label="Type">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as FollowUpType })} className="input">
                <option value="phone_call">Phone Call</option>
                <option value="email">Email</option>
                <option value="meeting">Meeting</option>
                <option value="note">Note</option>
              </Select>
            </Field>
            <Field label="Subject" error={errors.subject}>
              <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="input" placeholder="Enter Subject" maxLength={255} />
            </Field>
            <Field label="Outcome / Notes" error={errors.outcome}>
              <textarea value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} className="input" rows={3} placeholder="Enter Outcome / Notes" />
            </Field>
            <Field label="Schedule Next Follow-up (optional)" error={errors.nextDate} hint="If set, a follow-up task will be created for that date.">
              <input type="date" value={form.nextDate} min={todayISO()} onChange={(e) => setForm({ ...form, nextDate: e.target.value })} className="input" />
            </Field>
            <div className="flex justify-end gap-2 pt-3 border-t border-line">
              <button onClick={() => setShow(false)} className="btn btn-secondary" disabled={saving}>Cancel</button>
              <button onClick={save} disabled={saving || !form.subject} className="btn btn-primary">
                {saving ? <span className="loader" /> : null} Save Follow-up <Icon name="Check" size={13} />
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
