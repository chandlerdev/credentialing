"use client";

import { useState } from "react";
import { AccessDenied } from "@/components/AlertBox";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { PasswordInput } from "@/components/PasswordInput";
import { PhoneInput } from "@/components/PhoneInput";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useUser } from "@/stores/auth";
import { useToast } from "@/stores/toast";

interface CallingSettings {
  enabled: boolean;
  accountSid: string | null;
  apiKeySid: string | null;
  apiKeySecretSet: boolean;
  authTokenSet: boolean;
  phoneNumber: string | null;
  twimlAppSid: string | null;
  voiceUrl: string;
}

/** Super admin → Communication: the platform's Twilio account — browser calls to payers from Payer Submission (Call) in every organization. */
export function CommunicationView() {
  const user = useUser();
  const toast = useToast();
  const allowed = user.role === "platform_admin";
  const q = useAsync<CallingSettings>(
    allowed ? () => api.get("/calling/settings") : null,
    [allowed],
  );

  if (!allowed)
    return (
      <AccessDenied
        action="manage"
        entity="communication settings"
        role={user.role}
      />
    );
  return (
    <div>
      <PageHeader
        title="Communication"
        subtitle="Calling payers from the browser (Payer Submission → Call) through Twilio — one account for every organization. Calls are not recorded."
      />
      {q.error ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : !q.data ? (
        <Loading />
      ) : (
        <CallingForm initial={q.data} onSaved={q.setData} toast={toast} />
      )}
    </div>
  );
}

function CallingForm({
  initial: s,
  onSaved,
  toast,
}: {
  initial: CallingSettings;
  onSaved: (s: CallingSettings) => void;
  toast: ReturnType<typeof useToast>;
}) {
  const [f, setF] = useState({
    enabled: s.enabled,
    accountSid: s.accountSid || "",
    apiKeySid: s.apiKeySid || "",
    apiKeySecret: "",
    authToken: "",
    phoneNumber: s.phoneNumber || "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof f, v: string | boolean) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((x) => ({ ...x, [k]: "" }));
  };
  const save = async () => {
    const e: Record<string, string> = {};
    if (f.accountSid && !/^AC[0-9a-fA-F]{32}$/.test(f.accountSid.trim()))
      e.accountSid = "Account SID starts with AC followed by 32 characters";
    if (f.apiKeySid && !/^SK[0-9a-fA-F]{32}$/.test(f.apiKeySid.trim()))
      e.apiKeySid = "API Key SID starts with SK followed by 32 characters";
    if (f.authToken && !/^[0-9a-fA-F]{32}$/.test(f.authToken.trim()))
      e.authToken = "Auth Token is 32 characters";
    if (f.enabled) {
      if (!f.accountSid.trim()) e.accountSid = "Account SID is required";
      if (!f.apiKeySid.trim()) e.apiKeySid = "API Key SID is required";
      if (!f.apiKeySecret.trim() && !s?.apiKeySecretSet)
        e.apiKeySecret = "API Key Secret is required";
      if (!f.authToken.trim() && !s?.authTokenSet)
        e.authToken = "Auth Token is required";
      if (!/^\+1 \d{10}$/.test(f.phoneNumber))
        e.phoneNumber = "Twilio phone number is required (10 digits)";
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const next = await api.put<CallingSettings>("/calling/settings", {
        enabled: f.enabled,
        accountSid: f.accountSid.trim() || null,
        apiKeySid: f.apiKeySid.trim() || null,
        apiKeySecret: f.apiKeySecret.trim() || null,
        authToken: f.authToken.trim() || null,
        phoneNumber: f.phoneNumber || null,
      });
      setF((x) => ({ ...x, apiKeySecret: "", authToken: "" }));
      onSaved(next);
      toast(
        next.enabled
          ? "Calling is on — checked with Twilio"
          : "Calling settings saved (calling is off)",
      );
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length)
        setErrors(err.fieldErrors);
      else toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="card card-pad lg:col-span-2 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Icon
              name="PhoneCall"
              size={18}
              style={{ color: "var(--accent)" }}
            />
            <h3 className="font-display font-semibold">Calling — Twilio</h3>
            <span
              className="text-[11px] font-semibold rounded-full px-2 py-0.5"
              style={
                s.enabled
                  ? { background: "var(--success-soft)", color: "#047857" }
                  : { background: "var(--bg-soft)", color: "var(--ink-light)" }
              }
              data-calling-status
            >
              {s.enabled ? "On" : "Off"}
            </span>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={f.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
              style={{ width: 16, height: 16 }}
              aria-label="Enable browser calling"
            />
            Enable browser calling
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            label="Account SID"
            required={f.enabled}
            error={errors.accountSid}
          >
            <input
              value={f.accountSid}
              onChange={(e) => set("accountSid", e.target.value.trim())}
              className={
                "input font-mono" + (errors.accountSid ? " input-error" : "")
              }
              maxLength={34}
              autoComplete="off"
              aria-label="Account SID"
            />
          </Field>
          <Field
            label="Auth Token"
            required={f.enabled && !s.authTokenSet}
            error={errors.authToken}
          >
            <PasswordInput
              value={f.authToken}
              onChange={(e) => set("authToken", e.target.value.trim())}
              className={
                "input font-mono" + (errors.authToken ? " input-error" : "")
              }
              maxLength={64}
              autoComplete="new-password"
              placeholder={
                s.authTokenSet ? "•••••••• (saved — leave blank to keep)" : ""
              }
              aria-label="Auth Token"
            />
          </Field>
          <Field
            label="API Key SID"
            required={f.enabled}
            error={errors.apiKeySid}
          >
            <input
              value={f.apiKeySid}
              onChange={(e) => set("apiKeySid", e.target.value.trim())}
              className={
                "input font-mono" + (errors.apiKeySid ? " input-error" : "")
              }
              maxLength={34}
              autoComplete="off"
              aria-label="API Key SID"
            />
          </Field>
          <Field
            label="API Key Secret"
            required={f.enabled && !s.apiKeySecretSet}
            error={errors.apiKeySecret}
          >
            <PasswordInput
              value={f.apiKeySecret}
              onChange={(e) => set("apiKeySecret", e.target.value.trim())}
              className={
                "input font-mono" + (errors.apiKeySecret ? " input-error" : "")
              }
              maxLength={64}
              autoComplete="new-password"
              placeholder={
                s.apiKeySecretSet
                  ? "•••••••• (saved — leave blank to keep)"
                  : ""
              }
              aria-label="API Key Secret"
            />
          </Field>
          <Field
            label="Twilio phone number"
            required={f.enabled}
            error={errors.phoneNumber}
          >
            <PhoneInput
              value={f.phoneNumber}
              onChange={(v) => set("phoneNumber", v)}
              invalid={!!errors.phoneNumber}
              placeholder=""
            />
          </Field>
        </div>
        <div className="flex justify-end pt-2 border-t border-line">
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? (
              <span className="loader" style={{ borderTopColor: "white" }} />
            ) : (
              <Icon name="Save" size={13} />
            )}{" "}
            {f.enabled ? "Save and check with Twilio" : "Save"}
          </button>
        </div>
      </div>
      <div className="card card-pad text-sm space-y-2">
        <h3 className="font-display font-semibold mb-1">Where to find these</h3>
        <p className="text-ink-light text-xs">
          Twilio Console (console.twilio.com):
        </p>
        <ul className="text-xs text-ink-light list-disc pl-4 space-y-1">
          <li>
            <strong>Account SID</strong> and <strong>Auth Token</strong>:
            Account info on the console home.
          </li>
          <li>
            <strong>API Key SID / Secret</strong>: Account → API keys &amp;
            tokens (Standard key). The secret is shown only once.
          </li>
          <li>
            <strong>Phone number</strong>: Phone Numbers → Active numbers (a
            voice-capable US number).
          </li>
        </ul>
        <p className="text-xs text-ink-light">
          Saving checks the account with Twilio and creates the calling app that
          points to:
        </p>
        <div
          className="text-[11px] font-mono break-all rounded-md px-2 py-1.5"
          style={{ background: "var(--bg-soft)" }}
          data-voice-url
        >
          {s.voiceUrl}
        </div>
        {s.twimlAppSid && (
          <p className="text-[11px] text-ink-faint">
            Calling app: <span className="font-mono">{s.twimlAppSid}</span>
          </p>
        )}
        <p className="text-xs text-ink-light">
          Calls dial the payer&apos;s Support Phone (set on the payer) from the
          Twilio number. Secrets are stored encrypted and never shown again.
        </p>
      </div>
    </div>
  );
}
