"use client";

import { useCallback, useRef, useState } from "react";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { PayerLogo } from "@/components/payers/PayerLogo";
import { mmss, outcomeFor, useBrowserCall, type CallResult } from "@/components/calling/useBrowserCall";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { fmtDate, fmtTs, todayISO } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import type { PayerCard, PayerFlow, Workflow, WorkflowMeta } from "@/types/payerWorkflow";

let metaCache: Promise<WorkflowMeta> | null = null;
export function loadWorkflowMeta() {
  if (!metaCache) metaCache = api.get<WorkflowMeta>("/payer-workflows/meta").catch((e) => {
    metaCache = null;
    throw e;
  });
  return metaCache;
}

const addDays = (iso: string, n: number) => new Date(Date.parse(iso.slice(0, 10) + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const addMonths = (iso: string, n: number) => {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10) + "T00:00:00Z") - Date.parse(a.slice(0, 10) + "T00:00:00Z")) / 864e5);
const telHref = (n: string) => "tel:" + n.replace(/[^\d+]/g, "");

/** The template of the current step (or the nearest earlier step that has one). */
function suggestedTemplate(wf: Workflow | undefined, step: number) {
  if (!wf) return "new_application";
  for (let i = Math.min(step, wf.steps.length - 1); i >= 0; i--) if (wf.steps[i].template) return wf.steps[i].template!;
  return "new_application";
}

// ------------------------------------------------------------------ Workflow drawer

/** The payer's workflow for the provider: stepper, the step (checklist, details, documents), summary and activity. */
export function WorkflowDrawer({ enrollmentId, meta, onClose, onChanged }: { enrollmentId: number; meta: WorkflowMeta; onClose: () => void; onChanged: () => void }) {
  const flowQ = useAsync<PayerFlow>(() => api.get("/payer-workflows/" + enrollmentId), [enrollmentId]);
  const [flow, setFlow] = useState<PayerFlow | null>(null);
  const f = flow || flowQ.data;
  const [view, setView] = useState<number | null>(null);
  const [calling, setCalling] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const updated = (next: PayerFlow) => {
    setFlow(next);
    onChanged();
  };
  const wf = f ? meta.workflows[f.card.workflow] : undefined;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(15, 23, 42, 0.35)" }} role="dialog" aria-modal="true" aria-label="Workflow" onClick={onClose}>
      <div className="h-full overflow-y-auto slide-up" style={{ width: "min(1080px, 100vw)", background: "var(--bg)", boxShadow: "-8px 0 30px rgba(0,0,0,.15)" }} onClick={(e) => e.stopPropagation()}>
        {flowQ.error && !f ? (
          <div className="p-5">
            <ErrorState message={flowQ.error} onRetry={flowQ.reload} />
          </div>
        ) : !f || !wf ? (
          <div className="p-5">
            <Loading />
          </div>
        ) : (
          <WorkflowBody
            f={f}
            wf={wf}
            meta={meta}
            view={view ?? f.step}
            setView={setView}
            onUpdated={updated}
            onClose={onClose}
            onCall={() => setCalling(true)}
            onEmail={() => setEmailing(true)}
          />
        )}
      </div>
      {/* clicks in these popups must not reach the backdrop above (it closes the drawer) */}
      <div onClick={(e) => e.stopPropagation()}>
        {calling && f && <CallModal card={f.card} onClose={() => setCalling(false)} onLogged={(n) => n && updated(n)} />}
        {emailing && f && <EmailModal card={f.card} meta={meta} flow={f} onClose={() => setEmailing(false)} onLogged={(n) => n && updated(n)} />}
      </div>
    </div>
  );
}

function WorkflowBody({
  f,
  wf,
  meta,
  view,
  setView,
  onUpdated,
  onClose,
  onCall,
  onEmail,
}: {
  f: PayerFlow;
  wf: Workflow;
  meta: WorkflowMeta;
  view: number;
  setView: (n: number) => void;
  onUpdated: (f: PayerFlow) => void;
  onClose: () => void;
  onCall: () => void;
  onEmail: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can("update", "enrollment");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<number | null>(null);
  const c = f.card;
  const i = Math.min(view, wf.steps.length - 1);
  const s = wf.steps[i];
  const isCurrent = i === f.step;
  const isDone = i < f.step;
  const ticks = f.tasks[s.key] || {};
  const doneCount = s.tasks.filter((_, ti) => ticks[ti]).length;
  const approvedIdx = wf.steps.findIndex((x) => x.key === "approved");
  const approved = approvedIdx >= 0 && f.step > approvedIdx;

  const post = async (key: string, path: string, body?: unknown, msg?: string) => {
    setBusy(key);
    try {
      const next = await api.post<PayerFlow>("/payer-workflows/" + c.enrollmentId + "/" + path, body);
      if (msg) toast(msg);
      onUpdated(next);
      return next;
    } catch (e) {
      toast(errorMessage(e), "error");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const complete = async () => {
    const open = s.tasks.length - doneCount;
    if (open > 0 && confirmOpen == null) return setConfirmOpen(open);
    setConfirmOpen(null);
    const next = await post("complete", "step", { action: "complete" }, s.key === "approved" ? "Marked approved" : "Step completed");
    if (next) setView(next.step);
  };

  const daysIn = (() => {
    const t = f.stepStarted[String(i)];
    return t ? Math.max(0, daysBetween(t.slice(0, 10), todayISO())) : 0;
  })();

  return (
    <>
      {/* head */}
      <div className="sticky top-0 z-10 px-5 pt-5 pb-3 border-b border-line" style={{ background: "var(--bg)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <PayerLogo name={c.initials} color={c.color} logo={c.logo} size={40} />
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-ink">
                {c.name} — {wf.label} {wf.standard && <span className="text-[11px] font-normal rounded-full px-2 py-0.5 ml-1 align-middle" style={{ background: "var(--bg-soft)", border: "1px solid var(--border)" }}>{wf.standard}</span>}
              </h2>
              <p className="text-xs text-ink-light">
                {f.provider.name}
                {f.provider.credentials ? ", " + f.provider.credentials : ""} · NPI {f.provider.npi || "—"} · CAQH {f.provider.caqhId || "—"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost p-1" aria-label="Close">
            <Icon name="X" size={20} />
          </button>
        </div>
        {/* stepper */}
        <div className="grid gap-1 mt-4 overflow-x-auto" style={{ gridTemplateColumns: "repeat(" + wf.steps.length + ", minmax(70px, 1fr))" }}>
          {wf.steps.map((st, si) => {
            const done = si < f.step;
            const cur = si === f.step;
            return (
              <button key={st.key} onClick={() => setView(si)} className="flex flex-col items-center gap-1 rounded-md py-1.5 px-1" style={si === i ? { background: "var(--bg-soft)" } : undefined} aria-label={"Step " + (si + 1) + ": " + st.title} data-step={st.key}>
                <span className="flex items-center justify-center rounded-full text-[11px] font-bold" style={{ width: 24, height: 24, background: done ? "var(--success)" : cur ? "var(--accent)" : "var(--border)", color: done || cur ? "white" : "var(--ink-light)" }}>
                  {done ? "✓" : si + 1}
                </span>
                <span className="text-[11px] font-medium text-ink text-center leading-tight">{st.short}</span>
                <span className="text-[10px] text-center leading-tight" style={{ color: cur ? "var(--accent-strong)" : "var(--ink-faint)" }}>{cur ? "You are here" : st.phase}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* step detail */}
        <section className="lg:col-span-2 space-y-4" data-detail={s.key}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-ink-faint">
                Step {i + 1} of {wf.steps.length}
              </div>
              <h3 className="font-display text-lg font-semibold">{s.title}</h3>
              <p className="text-sm text-ink-light">{s.description}</p>
            </div>
            <span className="text-[11px] font-semibold rounded-md px-2 py-0.5 shrink-0" style={{ background: isDone ? "var(--success-soft)" : isCurrent ? "var(--accent-soft)" : "var(--bg-soft)", color: isDone ? "#047857" : isCurrent ? "var(--accent-strong)" : "var(--ink-light)" }}>
              {isDone ? "Done" : isCurrent ? "Current" : "Upcoming"}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <Chip>{s.phase}</Chip>
            {s.owner && <Chip>👤 {s.owner}</Chip>}
            {s.slaDays ? <Chip tone={isCurrent && daysIn > s.slaDays ? "late" : undefined}>{isCurrent ? "Day " + daysIn + " of " + s.slaDays + "d" : "Target " + s.slaDays + "d"}</Chip> : null}
            {s.milestone && <Chip tone="ms">◆ {s.milestone}</Chip>}
          </div>
          {s.tip && (
            <div className="text-sm rounded-lg px-3 py-2" style={{ background: "var(--info-soft)", color: "#1e3a8a" }}>
              <strong>Best practice:</strong> {s.tip}
            </div>
          )}
          {s.showDevDeadline && f.fields.devRequestDate && <DevDeadline from={f.fields.devRequestDate} />}
          {((s.actions && s.actions.length > 0) || (s.links && s.links.length > 0)) && (
            <div className="flex flex-wrap gap-2">
              {(s.actions || []).map((a) =>
                a === "portal" ? (
                  c.portalUrl ? (
                    <a key={a} className="btn btn-secondary text-xs" href={c.portalUrl} target="_blank" rel="noreferrer">
                      <Icon name="Globe" size={12} /> Open {c.name} portal
                    </a>
                  ) : null
                ) : a === "call" ? (
                  <button key={a} className="btn btn-secondary text-xs" onClick={onCall} disabled={!editable}>
                    <Icon name="Phone" size={12} /> Call payer
                  </button>
                ) : a === "email" ? (
                  <button key={a} className="btn btn-secondary text-xs" onClick={onEmail} disabled={!editable}>
                    <Icon name="Mail" size={12} /> Email template
                  </button>
                ) : (
                  <button key={a} className="btn btn-secondary text-xs" onClick={() => post("caqh", "caqh", undefined, "CAQH data imported")} disabled={!editable || busy === "caqh"}>
                    <Icon name="Download" size={12} /> Import from CAQH
                  </button>
                )
              )}
              {(s.links || []).map((k) => meta.links[k]).filter(Boolean).map((l) => (
                <a key={l.url} className="btn btn-secondary text-xs" href={l.url} target="_blank" rel="noreferrer">
                  <Icon name="ExternalLink" size={12} /> {l.label}
                </a>
              ))}
            </div>
          )}
          {s.methods && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Method</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(["portal", "phone"] as const).map((m) => (
                  <button
                    key={m}
                    disabled={!editable || busy === "method"}
                    onClick={async () => {
                      await post("method", "method", { method: m });
                      if (m === "portal" && c.portalUrl) window.open(c.portalUrl, "_blank", "noopener,noreferrer");
                      if (m === "phone") onCall();
                    }}
                    className="card px-3 py-2 text-left flex items-center gap-2"
                    style={f.method === m ? { borderColor: "var(--accent)", boxShadow: "0 0 0 1px var(--accent)" } : undefined}
                  >
                    {m === "phone" ? <Icon name="Phone" size={16} /> : c.portalUrl ? <Icon name="Globe" size={16} /> : <Icon name="Monitor" size={16} />}
                    <div>
                      <div className="text-sm font-semibold">{m === "portal" ? "Portal" : "Phone"}</div>
                      <div className="text-[11px] text-ink-faint">{m === "portal" ? c.portalUrl || "No portal address" : c.supportPhone || "No support phone"}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <h4 className="text-sm font-semibold mb-2">
              Checklist ({doneCount}/{s.tasks.length})
            </h4>
            <ul className="space-y-1.5">
              {s.tasks.map((t, ti) => (
                <li key={ti} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" id={"t" + s.key + ti} checked={!!ticks[ti]} disabled={!editable || busy === "t" + ti} onChange={(e) => post("t" + ti, "task", { step: s.key, index: ti, done: e.target.checked })} />
                  <label htmlFor={"t" + s.key + ti} style={ticks[ti] ? { color: "var(--ink-faint)", textDecoration: "line-through" } : undefined}>
                    {t}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          {s.showDocuments && <Documents f={f} wf={wf} editable={editable} onUpdated={onUpdated} />}
          {s.showMaintenance && <Maintenance wf={wf} f={f} />}
          {s.fields && s.fields.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {s.fields.map((fd) => (
                  <DetailField key={fd.key + ":" + (f.fields[fd.key] || "")} f={f} fieldKey={fd.key} label={fd.label} type={fd.type} editable={editable} onUpdated={onUpdated} />
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-line flex-wrap">
            <button className="btn btn-ghost" onClick={() => setView(Math.max(0, i - 1))} disabled={i === 0}>
              ← Previous
            </button>
            <div className="flex gap-2 flex-wrap">
              {isCurrent && i > 0 && editable && (
                <button className="btn btn-secondary" onClick={() => post("back", "step", { action: "back" }).then((n) => n && setView(n.step))} disabled={busy !== null}>
                  Move back a step
                </button>
              )}
              {isCurrent && i < wf.steps.length - 1 && editable && (
                <button className="btn btn-primary" onClick={complete} disabled={busy !== null} style={s.key === "approved" ? { background: "var(--success)", borderColor: "var(--success)" } : undefined}>
                  {busy === "complete" ? <span className="loader" style={{ borderTopColor: "white" }} /> : null}
                  {s.key === "approved" ? "✓ Mark approved & continue" : "Complete step & continue →"}
                </button>
              )}
              {isCurrent && i === wf.steps.length - 1 && <span className="text-xs text-ink-faint self-center">Ongoing — this step stays open</span>}
              {!isCurrent && (
                <button className="btn btn-secondary" onClick={() => setView(f.step)}>
                  Go to current step
                </button>
              )}
            </div>
          </div>
        </section>

        {/* summary + activity */}
        <aside className="space-y-4">
          <Summary f={f} wf={wf} meta={meta} approved={approved} onCall={onCall} onEmail={onEmail} editable={editable} />
          <div className="card card-pad">
            <h4 className="text-sm font-semibold mb-2">Activity</h4>
            {f.log.length === 0 ? (
              <p className="text-xs text-ink-faint">No activity yet.</p>
            ) : (
              <ol className="space-y-2 max-h-[420px] overflow-y-auto" data-activity>
                {f.log.map((l) => (
                  <li key={l.id} className="text-xs border-l-2 pl-2" style={{ borderColor: l.type === "call" ? "#2563eb" : l.type === "email" ? "var(--accent)" : l.type === "stage" ? "var(--success)" : "var(--border-strong)" }} data-log={l.type}>
                    <div className="text-[10px] text-ink-faint">
                      {fmtTs(l.at)}
                      {l.by ? " · " + l.by : ""}
                    </div>
                    <div className="text-ink">{l.text}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>
      {confirmOpen != null && (
        <ConfirmDialog
          title="Complete this step?"
          message={confirmOpen + " checklist item(s) still open. Complete “" + s.title + "” anyway?"}
          confirmLabel="Complete anyway"
          busy={busy === "complete"}
          onConfirm={complete}
          onClose={() => setConfirmOpen(null)}
        />
      )}
    </>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: "late" | "ms" }) {
  const style = tone === "late" ? { background: "#fee2e2", color: "#b91c1c", borderColor: "#fecaca" } : tone === "ms" ? { background: "var(--accent-soft)", color: "var(--accent-strong)", borderColor: "var(--accent)" } : { background: "var(--bg-soft)", color: "var(--ink-light)", borderColor: "var(--border)" };
  return <span className="rounded-full px-2 py-0.5 border" style={style}>{children}</span>;
}

function DevDeadline({ from }: { from: string }) {
  const due = addDays(from, 30);
  const left = daysBetween(todayISO(), due);
  return (
    <div className="text-sm rounded-lg px-3 py-2" style={{ background: left < 7 ? "#fee2e2" : "#fef9c3", color: left < 7 ? "#b91c1c" : "#a16207" }}>
      <strong>Development response due {fmtDate(due)}</strong> — {left >= 0 ? left + " days left" : -left + " days overdue"}. No response within 30 days means the application is rejected.
    </div>
  );
}

/** A step detail: saved when it changes (dates) or when the field is left (text). */
function DetailField({ f, fieldKey, label, type, editable, onUpdated }: { f: PayerFlow; fieldKey: string; label: string; type: string; editable: boolean; onUpdated: (f: PayerFlow) => void }) {
  const toast = useToast();
  const saved = f.fields[fieldKey] || "";
  const [v, setV] = useState(saved);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const save = async (value: string) => {
    if (value === saved) return;
    if (fieldKey === "submittedDate" && value && value > todayISO()) return setError("The submitted date can't be in the future");
    setBusy(true);
    setError(undefined);
    try {
      onUpdated(await api.post<PayerFlow>("/payer-workflows/" + f.card.enrollmentId + "/field", { key: fieldKey, value }));
      toast(label + " saved");
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors[fieldKey]) setError(e.fieldErrors[fieldKey]);
      else toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field label={label} error={error}>
      <input
        type={type === "date" ? "date" : "text"}
        value={v}
        max={fieldKey === "submittedDate" || fieldKey === "acceptedDate" || fieldKey === "devRequestDate" ? todayISO() : undefined}
        onChange={(e) => {
          setV(e.target.value);
          if (type === "date") save(e.target.value);
        }}
        onBlur={() => type !== "date" && save(v.trim())}
        className="input"
        maxLength={200}
        disabled={!editable || busy}
        aria-label={label}
      />
    </Field>
  );
}

function Documents({ f, wf, editable, onUpdated }: { f: PayerFlow; wf: Workflow; editable: boolean; onUpdated: (f: PayerFlow) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const upload = async (index: number, file: File | undefined) => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) return toast("The file is larger than 25 MB", "error");
    const fd = new FormData();
    fd.append("file", file);
    setBusy(index);
    try {
      onUpdated(await api.upload<PayerFlow>("/payer-workflows/" + f.card.enrollmentId + "/document?index=" + index, fd));
      toast("Attached");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div>
      <h4 className="text-sm font-semibold mb-2">Documents</h4>
      <div className="space-y-1.5">
        {wf.documents.map((d, di) => {
          const doc = f.docs[d] || {};
          const st = doc.file ? { label: "Uploaded", bg: "var(--success-soft)", color: "#047857" } : doc.caqh ? { label: "From CAQH", bg: "var(--info-soft)", color: "#1d4ed8" } : { label: "Missing", bg: "#fee2e2", color: "#b91c1c" };
          return (
            <div key={d} className="flex items-center gap-2 text-sm rounded-lg px-3 py-2" style={{ background: "var(--bg-soft)" }}>
              <div className="flex-1 min-w-0">
                {d}
                {doc.file && <div className="text-[11px] text-ink-faint truncate">{doc.file}</div>}
              </div>
              <span className="text-[11px] font-semibold rounded-md px-2 py-0.5" style={{ background: st.bg, color: st.color }}>
                {st.label}
              </span>
              {editable && (
                <label className="btn btn-secondary text-xs cursor-pointer" style={{ padding: "3px 8px" }}>
                  {busy === di ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name="Upload" size={11} />} Attach
                  <input type="file" className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => upload(di, e.target.files?.[0])} aria-label={"Attach " + d} />
                </label>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function maintenanceDue(wf: Workflow, f: PayerFlow) {
  return (wf.maintenance || []).map((m) => {
    const base = f.fields[m.from];
    const due = base ? (m.everyDays ? addDays(base, m.everyDays) : addMonths(base, m.everyMonths || 0)) : null;
    return { ...m, base, due, left: due ? daysBetween(todayISO(), due) : null };
  });
}

function Maintenance({ wf, f }: { wf: Workflow; f: PayerFlow }) {
  return (
    <div>
      <h4 className="text-sm font-semibold mb-2">Upcoming due dates</h4>
      <div className="space-y-1.5">
        {maintenanceDue(wf, f).map((m) => (
          <div key={m.key} className="flex items-center gap-2 text-sm rounded-lg px-3 py-2" style={{ background: "var(--bg-soft)" }}>
            <div className="flex-1">
              {m.label}
              <div className="text-[11px] text-ink-faint">{m.base ? "from " + fmtDate(m.base) + " · every " + (m.everyDays ? m.everyDays + " days" : (m.everyMonths || 0) / 12 + " years") : "Set the " + (m.from === "effectiveDate" ? "effective date" : "last attestation date") + " first"}</div>
            </div>
            <span className="text-xs font-mono">{m.due ? fmtDate(m.due) + " (" + m.left + "d)" : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Summary({ f, wf, meta, approved, onCall, onEmail, editable }: { f: PayerFlow; wf: Workflow; meta: WorkflowMeta; approved: boolean; onCall: () => void; onEmail: () => void; editable: boolean }) {
  const c = f.card;
  const fl = f.fields;
  const eta = fl.etaDate ? { date: fl.etaDate, source: "Payer-confirmed" } : fl.submittedDate ? { date: addDays(fl.submittedDate, wf.etaDays || c.avgTatDays || 90), source: "Estimated (submitted + " + (wf.etaDays || c.avgTatDays || 90) + "d)" } : null;
  // next follow-up: the cadence after the latest of the submitted date and the last call / e-mail
  const touches = f.log.filter((l) => l.type === "call" || l.type === "email").map((l) => l.at.slice(0, 10));
  const lastTouch = fl.submittedDate ? [fl.submittedDate, ...touches].sort().pop()! : null;
  const fu = approved ? null : f.nextFollowUp || (lastTouch ? addDays(lastTouch, meta.followUpCadenceDays || 14) : null);
  const fuLeft = fu ? daysBetween(todayISO(), fu) : null;
  const submitShort = wf.steps.find((s) => s.key === "submit")?.short || "Submit";
  const row = (k: string, v: React.ReactNode, cls?: string) => (
    <div className="flex justify-between gap-3 text-xs py-1 border-b border-line">
      <dt className="text-ink-faint">{k}</dt>
      <dd className={"text-right " + (cls || "")}>{v}</dd>
    </div>
  );
  let etaBox;
  if (approved) {
    etaBox = (
      <div className="rounded-lg p-3" style={{ background: "var(--success-soft)" }}>
        <div className="text-[11px] text-ink-faint">Approved</div>
        <div className="font-display text-xl font-bold" style={{ color: "#047857" }}>{fmtDate(fl.effectiveDate)}</div>
        <div className="text-[11px] text-ink-faint">Effective date{fl.submittedDate && fl.effectiveDate ? " · " + daysBetween(fl.submittedDate, fl.effectiveDate) + " days total" : ""}</div>
      </div>
    );
  } else if (eta) {
    const left = daysBetween(todayISO(), eta.date);
    etaBox = (
      <div className="rounded-lg p-3" style={{ background: left < 0 ? "#fee2e2" : "var(--bg-soft)" }} data-eta>
        <div className="text-[11px] text-ink-faint">ETA</div>
        <div className="font-display text-xl font-bold" style={left < 0 ? { color: "#b91c1c" } : undefined}>{fmtDate(eta.date)}</div>
        <div className="text-[11px] text-ink-faint">{(left >= 0 ? left + " days left" : -left + " days overdue — follow up") + " · " + eta.source}</div>
      </div>
    );
  } else {
    etaBox = (
      <div className="rounded-lg p-3" style={{ background: "var(--bg-soft)" }} data-eta>
        <div className="text-[11px] text-ink-faint">ETA</div>
        <div className="font-display text-xl font-bold">—</div>
        <div className="text-[11px] text-ink-faint">Set the submitted date in the “{submitShort}” step</div>
      </div>
    );
  }
  const due = approved ? maintenanceDue(wf, f).filter((m) => m.due) : [];
  return (
    <div className="card card-pad space-y-3" data-summary>
      {etaBox}
      <dl>
        {row("Status", <span className="font-semibold">{c.statusLabel}</span>)}
        {row("Method", f.method ? (f.method === "portal" ? "Portal" : "Phone") : "—")}
        {row("Case #", fl.caseNo || "—")}
        {row("Reference #", fl.referenceNo || "—")}
        {row("Submitted", fmtDate(fl.submittedDate))}
        {row("Accepted", fmtDate(fl.acceptedDate))}
        {row("Provider ID", fl.payerProviderId || "—")}
        {fu && row("Next follow-up", fmtDate(fu) + (fuLeft != null && fuLeft < 0 ? " (overdue)" : fuLeft === 0 ? " (today)" : ""), fuLeft != null && fuLeft < 0 ? "text-danger font-semibold" : "")}
        {due.map((m) => row(m.label, fmtDate(m.due)))}
      </dl>
      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-secondary text-xs" onClick={onCall} disabled={!editable}>
          <Icon name="Phone" size={12} /> Call
        </button>
        <button className="btn btn-secondary text-xs" onClick={onEmail} disabled={!editable}>
          <Icon name="Mail" size={12} /> Email
        </button>
        {c.portalUrl && (
          <a className="btn btn-secondary text-xs" href={c.portalUrl} target="_blank" rel="noreferrer">
            <Icon name="Globe" size={12} /> Portal
          </a>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Call

/** The next follow-up chosen when a call / e-mail is logged: today or later (default: today + the cadence). */
function checkNextFollowUp(v: string) {
  if (!v) return "Choose the next follow-up date";
  if (v < todayISO()) return "Choose today or a later date";
  return "";
}

function NextFollowUpField({ value, onChange, error, hint }: { value: string; onChange: (v: string) => void; error?: string; hint?: string }) {
  return (
    <Field label="Next follow-up date" required error={error}>
      <input type="date" value={value} min={todayISO()} onChange={(e) => onChange(e.target.value)} className={"input" + (error ? " input-error" : "")} aria-label="Next follow-up date" />
      <div className="text-[11px] text-ink-faint mt-1">{hint || "Logging this sets the enrollment's Last Follow Up Date to today and its Next Follow Up Date to this date."}</div>
    </Field>
  );
}

/**
 * Call the payer and log it: the call outcome, rep / reference and notes, and the next follow-up the call concluded
 * (chosen by the caller — never filled in automatically). Attended: the notes are required. Not attended (dropped,
 * missed, busy…): the next follow-up date is required.
 */
export function CallModal({ card, onClose, onLogged }: { card: PayerCard; onClose: () => void; onLogged: (f: PayerFlow | null) => void }) {
  const toast = useToast();
  const meta = useAsync<WorkflowMeta>(loadWorkflowMeta, []);
  const statuses = meta.data?.callStatuses || [];
  const started = useRef<number | null>(null);
  const [inCall, setInCall] = useState(false);
  const [f, setF] = useState({ outcome: "", ref: "", notes: "", nextFollowUp: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const phone = card.supportPhone;
  const status = statuses.find((s) => s.label === f.outcome);
  const attended = !!status?.attended;
  const notesRequired = attended || f.outcome === "Other reason";
  const nextRequired = !!status && !attended;

  const set = (k: keyof typeof f, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: "" }));
  };
  // browser calling through Twilio (admin → Calling); else the phone app (tel:)
  const onCallError = useCallback((m: string) => toast(m, "error"), [toast]);
  const [keypad, setKeypad] = useState(false);
  const [twilioMinutes, setTwilioMinutes] = useState<number | null>(null);
  // after hang-up: the payer's answer fills in the outcome (and the minutes) — the caller can still change them
  const onCallResult = useCallback((r: CallResult) => {
    const o = outcomeFor(r);
    if (o) setF((x) => (x.outcome ? x : { ...x, outcome: o }));
    setTwilioMinutes(r.seconds ? Math.max(1, Math.round(r.seconds / 60)) : null);
    setKeypad(false);
  }, []);
  const bc = useBrowserCall(card.enrollmentId, onCallError, onCallResult);
  const start = () => {
    if (!phone) return;
    if (bc.enabled) {
      bc.start(phone);
      return;
    }
    started.current = Date.now();
    setInCall(true);
    window.location.href = telHref(phone);
  };
  const log = async () => {
    const e: Record<string, string> = {};
    if (!status) e.outcome = "Choose the call outcome";
    if (notesRequired && !f.notes.trim()) e.notes = attended ? "Enter what was discussed on the call" : "Enter the reason";
    if (nextRequired && !f.nextFollowUp) e.nextFollowUp = "Choose the next follow-up date";
    else if (f.nextFollowUp && f.nextFollowUp < todayISO()) e.nextFollowUp = "Choose today or a later date";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const minutes = twilioMinutes ?? (started.current ? Math.max(1, Math.round((Date.now() - started.current) / 60000)) : null);
      const next = await api.post<PayerFlow>("/payer-workflows/" + card.enrollmentId + "/call", {
        outcome: f.outcome,
        ref: f.ref.trim() || null,
        notes: f.notes.trim() || null,
        minutes,
        nextFollowUp: f.nextFollowUp || null,
      });
      toast("Call logged");
      onLogged(next);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={"Call " + card.name} onClose={saving || bc.active ? undefined : onClose} maxWidth={480}>
      <div className="space-y-3">
        {phone ? (
          <a href={telHref(phone)} className="block font-mono text-2xl font-bold" style={{ color: "#16a34a" }} onClick={() => (started.current = started.current || Date.now())} data-call-number>
            {phone}
          </a>
        ) : (
          <div className="text-sm rounded-lg px-3 py-2" style={{ background: "#fef9c3", color: "#a16207" }}>
            No support phone is set for {card.name}. Add it to the payer (Support Phone), or log a call made another way below.
          </div>
        )}
        {bc.enabled ? (
          <BrowserCallPanel bc={bc} keypad={keypad} setKeypad={setKeypad} callerId={bc.callerId} />
        ) : (
          <p className="text-xs text-ink-faint">{inCall ? "Call started — log the outcome when you're done." : "Opens your phone app (tel:). The call is logged on the enrollment."}</p>
        )}
        <Field label="Call outcome" required error={errors.outcome}>
          <Select value={f.outcome} onChange={(e) => set("outcome", e.target.value)} className={"input" + (errors.outcome ? " input-error" : "")} aria-label="Call status">
            <option value="">— Choose outcome —</option>
            {statuses.map((s) => (
              <option key={s.label} value={s.label}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rep name / reference">
          <input value={f.ref} onChange={(e) => set("ref", e.target.value)} className="input" maxLength={120} placeholder="e.g. Jane, ticket #4471" aria-label="Rep name / reference" />
        </Field>
        <Field label="Notes" required={notesRequired} error={errors.notes}>
          <textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} className={"input" + (errors.notes ? " input-error" : "")} rows={3} maxLength={1500} placeholder="What did they say?" aria-label="Call notes" />
        </Field>
        <Field label="Next follow-up date" required={nextRequired} error={errors.nextFollowUp}>
          <input type="date" value={f.nextFollowUp} min={todayISO()} onChange={(e) => set("nextFollowUp", e.target.value)} className={"input" + (errors.nextFollowUp ? " input-error" : "")} aria-label="Next follow-up date" />
        </Field>
        <div className="flex justify-end gap-2 pt-1 flex-wrap">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving || bc.active}>
            Cancel
          </button>
          {bc.active ? (
            <button className="btn text-white" style={{ background: "#dc2626" }} onClick={bc.hangUp} aria-label="Hang up">
              <Icon name="PhoneOff" size={13} /> Hang up
            </button>
          ) : (
            <button className="btn text-white" style={{ background: "#2563eb" }} onClick={start} disabled={!phone || saving || bc.checking}>
              Start call
            </button>
          )}
          <button className="btn btn-secondary" onClick={log} disabled={saving || !meta.data || bc.active}>
            {saving && <span className="loader" />} Log call
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** The browser call's live state: connecting / ringing / in call (timer, mute, keypad) / ended. */
function BrowserCallPanel({ bc, keypad, setKeypad, callerId }: { bc: ReturnType<typeof useBrowserCall>; keypad: boolean; setKeypad: (v: boolean) => void; callerId: string | null }) {
  const label =
    bc.phase === "connecting" ? "Connecting…" : bc.phase === "ringing" ? "Ringing…" : bc.phase === "in-call" ? "In call · " + mmss(bc.seconds) : bc.phase === "ended" ? "Call ended" + (bc.result?.seconds ? " · " + mmss(bc.result.seconds) : "") + (bc.result?.dialStatus && bc.result.dialStatus !== "completed" ? " · " + bc.result.dialStatus.replace("-", " ") : "") : null;
  return (
    <div className="space-y-2" data-browser-call={bc.phase}>
      <p className="text-xs text-ink-faint">
        {bc.phase === "idle" ? "Calls from your browser (microphone / headset) through Twilio" + (callerId ? " from " + callerId : "") + ". Not recorded." : bc.phase === "ended" ? "The outcome is filled in from the call — add the notes and log it." : "Use the keypad for the payer's phone menu."}
      </p>
      {label && (
        <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 flex-wrap" style={{ background: bc.phase === "in-call" ? "var(--success-soft)" : "var(--bg-soft)" }}>
          <span className="text-sm font-semibold flex items-center gap-2" data-call-phase>
            {bc.phase === "connecting" || bc.phase === "ringing" ? <span className="loader" /> : <Icon name={bc.phase === "in-call" ? "PhoneCall" : "PhoneOff"} size={14} />}
            {label}
          </span>
          {bc.phase === "in-call" && (
            <div className="flex gap-1.5">
              <button className="btn btn-secondary text-xs" style={{ padding: "4px 8px" }} onClick={bc.toggleMute} aria-pressed={bc.muted}>
                <Icon name={bc.muted ? "MicOff" : "Mic"} size={12} /> {bc.muted ? "Unmute" : "Mute"}
              </button>
              <button className="btn btn-secondary text-xs" style={{ padding: "4px 8px" }} onClick={() => setKeypad(!keypad)} aria-pressed={keypad}>
                <Icon name="Grid3x3" size={12} /> Keypad
              </button>
            </div>
          )}
        </div>
      )}
      {bc.phase === "in-call" && keypad && (
        <div className="grid grid-cols-3 gap-1.5 max-w-[220px] mx-auto" data-keypad>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((d) => (
            <button key={d} className="btn btn-secondary font-mono text-base" style={{ padding: "8px 0" }} onClick={() => bc.sendDigit(d)}>
              {d}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Email

interface TemplateOption {
  id: number;
  code: string | null;
  name: string;
  subject: string;
  body: string;
  builtIn: boolean;
}

interface EmailSetup {
  from: string;
  fromName: string;
  sendingEnabled: boolean;
  inboxEnabled: boolean;
  templates: TemplateOption[];
}

/** E-mail the payer from a communication template: sent from the organization's mail server, or opened in the mail app; logged either way. */
export function EmailModal({ card, meta, flow, onClose, onLogged }: { card: PayerCard; meta: WorkflowMeta; flow?: PayerFlow; onClose: () => void; onLogged: (f: PayerFlow | null) => void }) {
  const toast = useToast();
  const setup = useAsync<EmailSetup>(() => api.get("/payer-workflows/" + card.enrollmentId + "/email-setup"), [card.enrollmentId]);
  const fq = useAsync<PayerFlow>(flow ? null : () => api.get("/payer-workflows/" + card.enrollmentId), [card.enrollmentId]);
  const f = flow || fq.data;
  if (!f || !setup.data) {
    const error = fq.error || setup.error;
    return (
      <Modal title={"Email " + card.name} onClose={onClose} maxWidth={720}>
        {error ? <ErrorState message={error} onRetry={() => { fq.reload(); setup.reload(); }} /> : <Loading />}
      </Modal>
    );
  }
  return <EmailForm card={card} meta={meta} f={f} setup={setup.data} onClose={onClose} onLogged={onLogged} toast={toast} />;
}

function EmailForm({ card, meta, f, setup, onClose, onLogged, toast }: { card: PayerCard; meta: WorkflowMeta; f: PayerFlow; setup: EmailSetup; onClose: () => void; onLogged: (f: PayerFlow | null) => void; toast: ReturnType<typeof useToast> }) {
  const wf = meta.workflows[card.workflow];
  const templates = setup.templates;
  const pick = (id: string) => {
    const t = templates.find((x) => String(x.id) === id);
    return t ? { template: String(t.id), subject: t.subject, body: t.body } : { template: "", subject: "", body: "" };
  };
  const suggested = suggestedTemplate(wf, f.step);
  const first = templates.find((t) => t.code === suggested) || templates[0];
  const [form, setForm] = useState(() => ({ to: card.supportEmail || "", nextFollowUp: addDays(todayISO(), meta.followUpCadenceDays || 14), ...pick(first ? String(first.id) : "") }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const fromLabel = setup.from || "Not configured on the server";

  const check = () => {
    const e: Record<string, string> = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.to.trim())) e.to = "Enter a valid email address";
    if (!form.subject.trim()) e.subject = "Subject is required";
    if (!form.body.trim()) e.body = "Message is required";
    const ne = checkNextFollowUp(form.nextFollowUp);
    if (ne) e.nextFollowUp = ne;
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const record = async (send: boolean) => {
    if (!check()) return;
    setBusy(send ? "send" : "draft");
    try {
      const next = await api.post<PayerFlow>("/payer-workflows/" + card.enrollmentId + "/email", { to: form.to.trim(), subject: form.subject, body: form.body, template: form.template || null, send, nextFollowUp: form.nextFollowUp });
      if (!send) window.location.href = "mailto:" + encodeURIComponent(form.to.trim()) + "?subject=" + encodeURIComponent(form.subject) + "&body=" + encodeURIComponent(form.body);
      toast(send ? "Email sent to " + form.to.trim() : "Email opened in your mail app and logged");
      onLogged(next);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      else toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText("To: " + form.to + "\nSubject: " + form.subject + "\n\n" + form.body);
      toast("Copied to clipboard");
    } catch {
      toast("Copy blocked by the browser", "error");
    }
  };

  return (
    <Modal title={"Email " + card.name} onClose={busy ? undefined : onClose} maxWidth={720}>
      <div className="space-y-3">
        <Field label="Communication template">
          <Select value={form.template} onChange={(e) => setForm({ ...form, ...pick(e.target.value) })} className="input" aria-label="Communication template">
            <option value="">— No template —</option>
            {templates.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.name}
              </option>
            ))}
          </Select>
          {templates.length === 0 && <div className="text-[11px] text-ink-faint mt-1">No templates yet — add them in Custom Templates → Payer Communication Templates.</div>}
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="From">
            <input value={fromLabel} disabled readOnly className="input" aria-label="From" style={{ background: "var(--bg-soft)", color: "var(--ink-light)", cursor: "not-allowed" }} />
          </Field>
          <Field label="To" required error={errors.to}>
            <input type="email" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className={"input" + (errors.to ? " input-error" : "")} aria-label="To" />
          </Field>
        </div>
        <Field label="Subject" required error={errors.subject}>
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className={"input" + (errors.subject ? " input-error" : "")} maxLength={255} aria-label="Subject" />
        </Field>
        <Field label="Message" required error={errors.body}>
          <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className={"input font-mono text-xs" + (errors.body ? " input-error" : "")} rows={12} aria-label="Message" />
        </Field>
        <NextFollowUpField value={form.nextFollowUp} onChange={(v) => setForm({ ...form, nextFollowUp: v })} error={errors.nextFollowUp} />
        <div className="text-[11px] text-ink-faint">
          {setup.inboxEnabled
            ? "The payer's reply to this email is logged on the enrollment automatically (Enrollments → email follow-ups)."
            : "Log the payer's reply in Enrollments → email follow-ups (Log payer reply)."}
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-line flex-wrap">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy !== null}>
            Cancel
          </button>
          <button className="btn btn-secondary" onClick={copy} disabled={busy !== null}>
            <Icon name="Copy" size={13} /> Copy
          </button>
          <button className="btn btn-secondary" onClick={() => record(false)} disabled={busy !== null} title="Opens your mail app with this email and logs it">
            {busy === "draft" ? <span className="loader" /> : <Icon name="ExternalLink" size={13} />} Open in email
          </button>
          <button className="btn btn-primary" onClick={() => record(true)} disabled={busy !== null}>
            {busy === "send" ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Send" size={13} />} Send
          </button>
        </div>
      </div>
    </Modal>
  );
}
