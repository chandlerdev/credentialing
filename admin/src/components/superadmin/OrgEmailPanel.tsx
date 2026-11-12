"use client";

import { useState } from "react";
import { Select } from "@/components/Select";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { PasswordInput } from "@/components/PasswordInput";
import { Pill } from "@/components/Pill";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { fmtDate } from "@/lib/utils";
import { useToast } from "@/stores/toast";

/** GET /platform/organizations/{orgId}/mail-settings */
interface MailSettings {
  orgId: number;
  enabled: boolean;
  fromName: string | null;
  fromEmail: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecurity: string | null;
  username: string | null;
  passwordSet: boolean;
  imapEnabled: boolean;
  imapHost: string | null;
  imapPort: number | null;
  imapSecurity: string | null;
  imapFolder: string | null;
  lastInboxCheckAt: string | null;
  lastInboxError: string | null;
  updatedAt: string | null;
}

interface Form {
  enabled: boolean;
  fromName: string;
  fromEmail: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecurity: string;
  username: string;
  password: string;
  imapEnabled: boolean;
  imapHost: string;
  imapPort: string;
  imapSecurity: string;
  imapFolder: string;
}

const toForm = (s: MailSettings): Form => ({
  enabled: s.enabled,
  fromName: s.fromName || "",
  fromEmail: s.fromEmail || "",
  smtpHost: s.smtpHost || "",
  smtpPort: s.smtpPort != null ? String(s.smtpPort) : "587",
  smtpSecurity: s.smtpSecurity || "starttls",
  username: s.username || "",
  password: "",
  imapEnabled: s.imapEnabled,
  imapHost: s.imapHost || "",
  imapPort: s.imapPort != null ? String(s.imapPort) : "993",
  imapSecurity: s.imapSecurity || "ssl",
  imapFolder: s.imapFolder || "INBOX",
});

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Super admin → Organizations → Email Settings: the organization's own mail account. Every email of the organization
 * goes out through it (there is no shared fallback), and payer replies are read from its inbox.
 */
export function OrgEmailPanel({ orgId, orgName }: { orgId: number; orgName: string }) {
  const toast = useToast();
  const q = useAsync<MailSettings>(() => api.get<MailSettings>("/platform/organizations/" + orgId + "/mail-settings"), [orgId]);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "send" | "inbox" | null>(null);
  const [testTo, setTestTo] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [seen, setSeen] = useState<MailSettings | undefined>(undefined);
  if (q.data && q.data !== seen) {
    setSeen(q.data);
    setForm(toForm(q.data));
  }

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data || !form) return <Loading />;
  const s = q.data;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setErrors((e) => (e[k] ? { ...e, [k]: "" } : e));
  };

  const problems = (needOn: boolean): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!needOn) return e;
    if (!form.fromEmail.trim()) e.fromEmail = "From email is required";
    else if (!EMAIL_RE.test(form.fromEmail.trim())) e.fromEmail = "Enter a valid email address";
    if (!form.smtpHost.trim()) e.smtpHost = "SMTP host is required";
    if (!/^\d{1,5}$/.test(form.smtpPort) || Number(form.smtpPort) < 1 || Number(form.smtpPort) > 65535) e.smtpPort = "Port 1-65535";
    if (!form.username.trim()) e.username = "Username is required";
    if (!form.password && !s.passwordSet) e.password = "Password is required";
    if (form.imapEnabled) {
      if (!form.imapHost.trim()) e.imapHost = "IMAP host is required";
      if (!/^\d{1,5}$/.test(form.imapPort) || Number(form.imapPort) < 1 || Number(form.imapPort) > 65535) e.imapPort = "Port 1-65535";
    }
    return e;
  };

  const body = () => ({
    enabled: form.enabled,
    fromName: form.fromName.trim(),
    fromEmail: form.fromEmail.trim(),
    smtpHost: form.smtpHost.trim(),
    smtpPort: form.smtpPort ? Number(form.smtpPort) : null,
    smtpSecurity: form.smtpSecurity,
    username: form.username.trim(),
    password: form.password,
    imapEnabled: form.imapEnabled,
    imapHost: form.imapHost.trim(),
    imapPort: form.imapPort ? Number(form.imapPort) : null,
    imapSecurity: form.imapSecurity,
    imapFolder: form.imapFolder.trim(),
  });

  const fail = (err: unknown) => {
    if (err instanceof ApiError && Object.keys(err.fieldErrors).length) {
      const mapped: Record<string, string> = {};
      Object.entries(err.fieldErrors).forEach(([k, v]) => (mapped[k.replace(/^settings\./, "")] = v));
      setErrors(mapped);
    }
    toast(errorMessage(err), "error");
  };

  const save = async () => {
    const e = problems(form.enabled);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy("save");
    setResult(null);
    try {
      const saved = await api.put<MailSettings>("/platform/organizations/" + orgId + "/mail-settings", body());
      q.setData(saved);
      toast("Email settings saved for " + orgName);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const test = async (kind: "send" | "inbox") => {
    const e = problems(true);
    if (kind === "send") {
      if (!testTo.trim()) e.testTo = "Enter the address to send the test email to";
      else if (!EMAIL_RE.test(testTo.trim())) e.testTo = "Enter a valid email address";
    }
    if (kind === "inbox" && !form.imapEnabled) e.imapEnabled = "Turn on reading replies first";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(kind);
    setResult(null);
    try {
      const r = await api.post<{ ok: boolean; message: string }>("/platform/organizations/" + orgId + "/mail-settings/" + (kind === "send" ? "test-send" : "test-inbox"), {
        settings: { ...body(), enabled: true },
        to: kind === "send" ? testTo.trim() : null,
      });
      setResult(r);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const status = s.enabled ? (
    <Pill type="success">Sending on</Pill>
  ) : s.fromEmail ? (
    <Pill type="warn">Sending off</Pill>
  ) : (
    <Pill type="danger">Not set up</Pill>
  );

  return (
    <div className="space-y-4" data-org-email>
      <div className="card card-pad">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <div className="font-semibold text-ink flex items-center gap-2">
              <Icon name="Mail" size={15} className="text-accent" /> {orgName}&apos;s email account {status}
            </div>
            <div className="text-xs text-ink-light mt-1">
              Every email of this organization (secure links, document requests, payer emails, reminders, password resets) is sent from this account. There is no shared
              fallback: without it, sending fails with an error.
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} aria-label="Sending on" style={{ width: 16, height: 16 }} />
            Sending on
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="From Name" error={errors.fromName} hint="Shown as the sender, e.g. the organization name">
            <input value={form.fromName} onChange={(e) => set("fromName", e.target.value.slice(0, 120))} className="input" placeholder={orgName} aria-label="From Name" />
          </Field>
          <Field label={"From Email" + (form.enabled ? " *" : "")} error={errors.fromEmail}>
            <input type="email" value={form.fromEmail} onChange={(e) => set("fromEmail", e.target.value.slice(0, 255))} className={"input" + (errors.fromEmail ? " input-error" : "")} placeholder="credentialing@organization.com" aria-label="From Email" />
          </Field>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="card card-pad">
          <div className="font-semibold text-sm text-ink mb-3 flex items-center gap-2">
            <Icon name="Send" size={14} className="text-accent" /> Outgoing server (SMTP)
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={"SMTP Host" + (form.enabled ? " *" : "")} error={errors.smtpHost} className="sm:col-span-2">
                <input value={form.smtpHost} onChange={(e) => set("smtpHost", e.target.value.trim().slice(0, 255))} className={"input" + (errors.smtpHost ? " input-error" : "")} placeholder="smtp.office365.com" aria-label="SMTP Host" />
              </Field>
              <Field label={"Port" + (form.enabled ? " *" : "")} error={errors.smtpPort}>
                <input value={form.smtpPort} onChange={(e) => set("smtpPort", e.target.value.replace(/\D/g, "").slice(0, 5))} className={"input font-mono" + (errors.smtpPort ? " input-error" : "")} inputMode="numeric" aria-label="SMTP Port" />
              </Field>
            </div>
            <Field label="Security" error={errors.smtpSecurity}>
              <Select value={form.smtpSecurity} onChange={(e) => set("smtpSecurity", e.target.value)} className="input" aria-label="SMTP Security">
                <option value="starttls">STARTTLS (usually port 587)</option>
                <option value="ssl">SSL / TLS (usually port 465)</option>
                <option value="none">None</option>
              </Select>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={"Username" + (form.enabled ? " *" : "")} error={errors.username} hint="Usually the full email address">
                <input value={form.username} onChange={(e) => set("username", e.target.value.trim().slice(0, 255))} className={"input" + (errors.username ? " input-error" : "")} autoComplete="off" aria-label="Username" />
              </Field>
              <Field label={"Password" + (form.enabled && !s.passwordSet ? " *" : "")} error={errors.password} hint={s.passwordSet ? "Saved — leave blank to keep it" : "Stored encrypted"}>
                <PasswordInput value={form.password} onChange={(e) => set("password", e.target.value)} className={"input" + (errors.password ? " input-error" : "")} autoComplete="new-password" aria-label="Password" />
              </Field>
            </div>
          </div>
        </div>

        <div className="card card-pad">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="font-semibold text-sm text-ink flex items-center gap-2">
              <Icon name="Inbox" size={14} className="text-accent" /> Incoming server (IMAP) — payer replies
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={form.imapEnabled} onChange={(e) => set("imapEnabled", e.target.checked)} aria-label="Read replies" style={{ width: 15, height: 15 }} />
              Read replies
            </label>
          </div>
          {errors.imapEnabled && <div className="field-error mb-2">{errors.imapEnabled}</div>}
          <div className="space-y-3" style={form.imapEnabled ? undefined : { opacity: 0.55 }}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={"IMAP Host" + (form.imapEnabled ? " *" : "")} error={errors.imapHost} className="sm:col-span-2">
                <input value={form.imapHost} onChange={(e) => set("imapHost", e.target.value.trim().slice(0, 255))} className={"input" + (errors.imapHost ? " input-error" : "")} placeholder="outlook.office365.com" disabled={!form.imapEnabled} aria-label="IMAP Host" />
              </Field>
              <Field label={"Port" + (form.imapEnabled ? " *" : "")} error={errors.imapPort}>
                <input value={form.imapPort} onChange={(e) => set("imapPort", e.target.value.replace(/\D/g, "").slice(0, 5))} className={"input font-mono" + (errors.imapPort ? " input-error" : "")} inputMode="numeric" disabled={!form.imapEnabled} aria-label="IMAP Port" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Security">
                <Select value={form.imapSecurity} onChange={(e) => set("imapSecurity", e.target.value)} className="input" disabled={!form.imapEnabled} aria-label="IMAP Security">
                  <option value="ssl">SSL / TLS (usually port 993)</option>
                  <option value="starttls">STARTTLS (usually port 143)</option>
                  <option value="none">None</option>
                </Select>
              </Field>
              <Field label="Folder">
                <input value={form.imapFolder} onChange={(e) => set("imapFolder", e.target.value.slice(0, 120))} className="input" disabled={!form.imapEnabled} aria-label="IMAP Folder" />
              </Field>
            </div>
            <div className="text-[11px] text-ink-faint">Signs in with the same username and password as the outgoing server. The inbox is only read, never changed.</div>
            {s.lastInboxCheckAt && (
              <div className="text-[11px]" style={{ color: s.lastInboxError ? "#991b1b" : "var(--ink-light)" }} data-last-inbox-check>
                Last checked {fmtDate(s.lastInboxCheckAt)}
                {s.lastInboxError ? " — " + s.lastInboxError : " — OK"}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="font-semibold text-sm text-ink mb-3 flex items-center gap-2">
          <Icon name="FlaskConical" size={14} className="text-accent" /> Test before saving
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div style={{ minWidth: 260, flex: 1, maxWidth: 420 }}>
            <Field label="Send a test email to" error={errors.testTo}>
              <input
                type="email"
                value={testTo}
                onChange={(e) => {
                  setTestTo(e.target.value.slice(0, 255));
                  setErrors((er) => ({ ...er, testTo: "" }));
                }}
                className={"input" + (errors.testTo ? " input-error" : "")}
                placeholder="you@example.com"
                aria-label="Test email address"
              />
            </Field>
          </div>
          <button className="btn btn-secondary" onClick={() => test("send")} disabled={busy !== null} data-test-send>
            {busy === "send" ? <span className="loader" /> : <Icon name="Send" size={13} />} Send test email
          </button>
          <button className="btn btn-secondary" onClick={() => test("inbox")} disabled={busy !== null} data-test-inbox>
            {busy === "inbox" ? <span className="loader" /> : <Icon name="Inbox" size={13} />} Test inbox
          </button>
        </div>
        {result && (
          <div className="mt-3 px-3 py-2 rounded-lg text-sm flex items-center gap-2" style={result.ok ? { background: "var(--success-soft)", color: "#166534" } : { background: "var(--danger-soft)", color: "#991b1b" }} data-test-result={result.ok ? "ok" : "fail"}>
            <Icon name={result.ok ? "CheckCircle2" : "AlertCircle"} size={14} /> {result.message}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button className="btn btn-primary" onClick={save} disabled={busy !== null} data-save-mail>
          {busy === "save" ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Save" size={13} />} Save Email Settings
        </button>
      </div>
    </div>
  );
}
