"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Icon } from "@/components/Icon";
import { api, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { fmtDate, fmtTsZone } from "@/lib/utils";
import { useToast } from "@/stores/toast";
import type { Enrollment } from "@/types/enrollments";

interface Touch {
  id: number;
  at: string;
  by: string | null;
  text: string | null;
  outcome: string | null;
  attended: boolean | null;
  ref: string | null;
  minutes: number | null;
  notes: string | null;
  nextFollowUp: string | null;
  from: string | null;
  to: string | null;
  subject: string | null;
  body: string | null;
  status: string | null;
}

const STATUS_LABEL: Record<string, string> = { sent: "Sent", drafted: "Opened in mail app", queued: "Queued (sending off)", received: "Reply received" };

/** Enrollments → the calls or e-mails with the payer (sent from Payer Submission, and the payer's replies), newest first. */
export function FollowUpLogModal({ enrollment: e, type, canLog = false, onClose, onChanged }: { enrollment: Enrollment; type: "call" | "email"; canLog?: boolean; onClose: () => void; onChanged?: () => void }) {
  const toast = useToast();
  const q = useAsync<Touch[]>(() => api.get("/payer-workflows/" + e.id + "/touches", { type }), [e.id, type]);
  const setup = useAsync<{ inboxEnabled: boolean; from: string }>(type === "email" ? () => api.get("/payer-workflows/" + e.id + "/email-setup") : null, [e.id, type]);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const isCall = type === "call";

  const checkInbox = async () => {
    setChecking(true);
    try {
      const r = await api.post<{ logged: number; error: string | null }>("/payer-workflows/inbox/check");
      if (r.error) toast("Mailbox: " + r.error, "error");
      else toast(r.logged ? r.logged + (r.logged === 1 ? " reply" : " replies") + " logged" : "No new replies");
      q.reload();
      if (r.logged) onChanged?.();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal title={(isCall ? "Call follow-ups · " : "Email follow-ups · ") + e.providerName + " → " + (e.payerName || "")} onClose={onClose} maxWidth={720}>
      <div className={"grid grid-cols-1 gap-2 mb-3 text-xs" + (isCall ? " sm:grid-cols-2" : "")}>
        <div className="rounded-lg px-3 py-2" style={{ background: "var(--bg-soft)" }}>
          <div className="text-ink-faint">Last Follow Up</div>
          <div className="font-semibold">{e.followUpDate ? fmtDate(e.followUpDate) : "—"}</div>
        </div>
        {/* the email list has no Next Follow Up (it is set from Payer Submission) */}
        {isCall && (
          <div className="rounded-lg px-3 py-2" style={{ background: "var(--bg-soft)" }} data-next-box>
            <div className="text-ink-faint">Next Follow Up</div>
            <div className="font-semibold">{e.nextFollowUpDate ? fmtDate(e.nextFollowUpDate) : "—"}</div>
          </div>
        )}
      </div>
      {!isCall && canLog && setup.data?.inboxEnabled && (
        <div className="flex justify-end gap-2 mb-3 flex-wrap">
          {setup.data?.inboxEnabled && (
            <button className="btn btn-secondary text-xs" onClick={checkInbox} disabled={checking}>
              {checking ? <span className="loader" /> : <Icon name="RefreshCw" size={12} />} Check for replies
            </button>
          )}
        </div>
      )}
      {q.error ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : !q.data ? (
        <Loading />
      ) : q.data.length === 0 ? (
        <EmptyState icon={isCall ? "Phone" : "Mail"} title={isCall ? "No calls logged yet" : "No emails logged yet"} />
      ) : (
        <ul className="space-y-2" data-touch-list={type}>
          {q.data.map((t) => {
            const received = t.status === "received";
            return (
              <li key={t.id} className="rounded-lg border border-line px-3 py-2" data-touch style={received ? { borderLeft: "3px solid var(--accent)" } : undefined}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 text-sm font-semibold min-w-0">
                    <Icon name={isCall ? "Phone" : received ? "MailOpen" : "Mail"} size={13} />
                    <span className="break-words">{isCall ? t.outcome || "Call" : t.subject || "(no subject)"}</span>
                  </div>
                  <span className="text-[11px] text-ink-faint whitespace-nowrap">{fmtTsZone(t.at)}</span>
                </div>
                <div className="text-xs text-ink-light mt-1 flex flex-wrap gap-x-4 gap-y-0.5 items-center">
                  {isCall ? (
                    <>
                      {t.attended != null && (
                        <span className="rounded px-1.5" style={{ background: t.attended ? "var(--success-soft)" : "#fef3c7", color: t.attended ? "#047857" : "#a16207" }} data-attended={t.attended ? "yes" : "no"}>
                          {t.attended ? "Communication happened" : "No communication"}
                        </span>
                      )}
                      {t.ref && <span>Rep / ref: {t.ref}</span>}
                      {t.minutes != null && <span>{t.minutes} min</span>}
                      {t.by && <span>By {t.by}</span>}
                    </>
                  ) : (
                    <>
                      {t.status && (
                        <span className="rounded px-1.5" style={{ background: received || t.status === "sent" ? "var(--success-soft)" : "var(--bg-soft)", color: received || t.status === "sent" ? "#047857" : "var(--ink-light)" }} data-email-status={t.status}>
                          {STATUS_LABEL[t.status] || t.status}
                        </span>
                      )}
                      {received ? t.from && <span className="break-all">From: {t.from}</span> : t.to && <span className="break-all">To: {t.to}</span>}
                      {!received && t.by && <span>By {t.by}</span>}
                    </>
                  )}
                </div>
                {isCall
                  ? (
                      <div className="text-xs mt-1 space-y-0.5" data-call-lines>
                        <div>Called {e.payerName || "the payer"}</div>
                        {t.notes && <div className="whitespace-pre-wrap break-words">Status: {t.notes}</div>}
                        {t.nextFollowUp && <div>Next follow-up: {fmtDate(t.nextFollowUp)}</div>}
                      </div>
                    )
                  : t.body && (
                      <div className="mt-1">
                        {open === t.id ? (
                          <div className="text-xs whitespace-pre-wrap break-words rounded-md p-2 border border-line" style={{ background: "var(--bg-soft)", maxHeight: 260, overflowY: "auto" }}>{t.body}</div>
                        ) : (
                          <div className="text-xs text-ink-light break-words" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.body}</div>
                        )}
                        <button className="text-[11px] mt-0.5" style={{ color: "var(--accent-strong)" }} onClick={() => setOpen(open === t.id ? null : t.id)}>
                          {open === t.id ? "Hide message" : "Show message"}
                        </button>
                      </div>
                    )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

