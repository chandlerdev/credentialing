"use client";

import { useState } from "react";
import { AsyncBoundary } from "@/components/AsyncState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { Pill } from "@/components/Pill";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { isOrgAdmin, useUser } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import type { CaqhLookupConfig, CaqhLookupMode, CaqhLookupTest } from "@/types/caqh";

interface Draft {
  mode: CaqhLookupMode;
  apiUrl: string;
  apiKey: string;
  orgId: string;
}

const draftOf = (c: CaqhLookupConfig): Draft => ({ mode: c.mode, apiUrl: c.apiUrl || "", apiKey: "", orgId: c.orgId || "" });

/** Prototype v2 CaqhConfigView — switch "Import from CAQH" between the mock database and a real CAQH ProView API. */
export function CaqhConfigView() {
  const user = useUser();
  const canEdit = isOrgAdmin(user);
  const toast = useToast();
  const config = useAsync<CaqhLookupConfig>(() => api.get<CaqhLookupConfig>("/caqh/lookup-config"), []);
  const [local, setLocal] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<CaqhLookupTest | null>(null);

  // Reset the draft when new saved settings arrive (render-time state adjustment, no effect).
  const [seen, setSeen] = useState<CaqhLookupConfig | undefined>(undefined);
  if (config.data && config.data !== seen) {
    setSeen(config.data);
    if (!dirty) setLocal(draftOf(config.data));
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setLocal((l) => (l ? { ...l, [k]: v } : l));
    setDirty(true);
    setTestResult(null);
  };

  const save = async () => {
    if (!local) return;
    setSaving(true);
    setErrors({});
    try {
      const res = await api.put<CaqhLookupConfig>("/caqh/lookup-config", {
        mode: local.mode,
        apiUrl: local.apiUrl.trim(),
        apiKey: local.apiKey ? local.apiKey : null,
        orgId: local.orgId.trim(),
      });
      config.setData(res);
      setLocal(draftOf(res));
      setDirty(false);
      toast("CAQH configuration saved");
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    if (!local) return;
    try {
      const res = await api.put<CaqhLookupConfig>("/caqh/lookup-config", { mode: config.data?.mode || "mock", apiUrl: config.data?.apiUrl || "", apiKey: "", orgId: config.data?.orgId || "" });
      config.setData(res);
      toast("Stored API key removed");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.post<CaqhLookupTest>("/caqh/lookup-config/test"));
    } catch (err) {
      setTestResult({ ok: false, mode: local?.mode || "mock", message: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  const saved = config.data;
  return (
    <div>
      <PageHeader
        title="CAQH API Configuration"
        subtitle="Switch between the mock CAQH database (built-in) and a real CAQH ProView API."
        actions={
          dirty && (
            <>
              <button onClick={() => { if (saved) setLocal(draftOf(saved)); setDirty(false); setErrors({}); }} className="btn btn-secondary" disabled={saving}>
                Discard
              </button>
              <button onClick={save} className="btn btn-primary" disabled={saving}>
                {saving ? <span className="loader" /> : <Icon name="Save" size={13} />} Save Changes
              </button>
            </>
          )
        }
      />

      <AsyncBoundary loading={config.loading || !local} error={config.error} onRetry={config.reload}>
        {local && saved && (
          <>
            {!canEdit && (
              <div className="p-3 rounded-lg text-xs mb-4" style={{ background: "var(--info-soft)", color: "#1e40af" }}>
                <Icon name="Lock" size={11} className="inline mr-1" />
                Only organization admins can change the CAQH configuration.
              </div>
            )}

            <div className="card card-pad mb-4">
              <h3 className="font-semibold text-sm text-ink mb-3">Mode</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ModeCard
                  active={local.mode === "mock"}
                  disabled={!canEdit}
                  icon="Code"
                  title="Mock Mode"
                  onClick={() => set("mode", "mock")}
                  text={"Uses built-in database of " + saved.mockCaqhIds.length + " realistic provider profiles. Perfect for demos and development. Valid IDs: " + saved.mockCaqhIds[0] + " - " + saved.mockCaqhIds[saved.mockCaqhIds.length - 1] + "."}
                />
                <ModeCard
                  active={local.mode === "real"}
                  disabled={!canEdit}
                  icon="Globe"
                  title="Real API Mode"
                  onClick={() => set("mode", "real")}
                  text="Call a real CAQH ProView API endpoint. Requires valid credentials from CAQH."
                />
              </div>
            </div>

            {local.mode === "real" && (
              <div className="card card-pad mb-4">
                <h3 className="font-semibold text-sm text-ink mb-3">API Credentials</h3>
                <div className="space-y-3">
                  <Field label="API Base URL" error={errors.apiUrl} hint={<>The URL will be called as: <span className="font-mono">GET {local.apiUrl || "{apiUrl}"}/providers/{"{caqhId}"}</span></>}>
                    <input value={local.apiUrl} onChange={(e) => set("apiUrl", e.target.value)} className="input font-mono" placeholder="Enter API Base URL" disabled={!canEdit} />
                  </Field>
                  <Field
                    label="API Key / Bearer Token"
                    error={errors.apiKey}
                    hint={
                      <>
                        Sent as: <span className="font-mono">Authorization: Bearer &lt;key&gt;</span>. Stored encrypted; never shown again.
                        {saved.hasApiKey && canEdit && (
                          <button type="button" className="underline ml-1" onClick={clearKey}>Remove stored key</button>
                        )}
                      </>
                    }
                  >
                    <input
                      type="password"
                      value={local.apiKey}
                      onChange={(e) => set("apiKey", e.target.value)}
                      className="input font-mono"
                      placeholder={saved.hasApiKey ? "•••••••• (stored — leave blank to keep)" : "Enter API Key / Bearer Token"}
                      autoComplete="new-password"
                      disabled={!canEdit}
                    />
                  </Field>
                  <Field label="Organization ID (optional)" error={errors.orgId} hint={<>Sent as: <span className="font-mono">X-Org-Id: &lt;orgId&gt;</span></>}>
                    <input value={local.orgId} onChange={(e) => set("orgId", e.target.value)} className="input font-mono" placeholder="Enter Organization ID" disabled={!canEdit} />
                  </Field>
                  <div className="p-3 rounded text-xs" style={{ background: "var(--warn-soft)", color: "#92400e" }}>
                    <Icon name="AlertTriangle" size={11} className="inline mr-1" />
                    <strong>CAQH ProView direct API access</strong> requires a signed delegated-credentialing agreement with CAQH. Most organizations use roster-based bulk
                    downloads instead. Check with your CAQH account manager about API availability for your organization type.
                  </div>
                </div>
              </div>
            )}

            <div className="card card-pad mb-4">
              <h3 className="font-semibold text-sm text-ink mb-3">Test Connection</h3>
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={testConnection} disabled={testing || dirty || !canEdit} className="btn btn-secondary" title={dirty ? "Save your changes first" : ""}>
                  {testing ? (
                    <>
                      <span className="loader" /> Testing...
                    </>
                  ) : (
                    <>
                      <Icon name="Zap" size={13} /> Test Connection
                    </>
                  )}
                </button>
                {dirty && <span className="text-xs text-ink-faint">Save your changes to test them.</span>}
                {testResult && (
                  <div className="text-xs flex items-center gap-1" style={{ color: testResult.ok ? "var(--success)" : "var(--danger)" }}>
                    <Icon name={testResult.ok ? "CheckCircle2" : "AlertCircle"} size={13} />
                    {testResult.message}
                  </div>
                )}
              </div>
            </div>

            <div className="card card-pad">
              <h3 className="font-semibold text-sm text-ink mb-3">Request Format Reference</h3>
              <div className="text-xs text-ink-light mb-2">The server sends this HTTP request:</div>
              <pre className="p-3 rounded font-mono text-[10px] overflow-auto" style={{ background: "#1e293b", color: "#e2e8f0" }}>
                {"GET " + (local.apiUrl || "{API_URL}") + "/providers/{caqhId}\n" +
                  "Accept: application/json\n" +
                  "Authorization: Bearer " + (local.apiKey || saved.hasApiKey ? "***" : "{API_KEY}") + "\n" +
                  (local.orgId ? "X-Org-Id: " + local.orgId + "\n" : "")}
              </pre>
              <div className="text-xs text-ink-light mt-3 mb-2">Expected response (JSON):</div>
              <pre className="p-3 rounded font-mono text-[10px] overflow-auto" style={{ background: "#1e293b", color: "#e2e8f0" }}>
                {`{
  "caqhId": "10000001",
  "firstName": "...", "lastName": "...", "suffix": "MD",
  "specialty": "Family Medicine",
  "npi": "1234598765",
  "email": "...", "phone": "...",
  "license": "...", "licenseState": "TX", "licenseExpires": "YYYY-MM-DD",
  "deaNumber": "...", "deaExpires": "YYYY-MM-DD",
  "boardCert": { "board": "ABFM", "status": "active", "expires": "YYYY-MM-DD" },
  "malpractice": { "carrier": "...", "expires": "YYYY-MM-DD", "limit": "..." },
  "docCount": 11,
  "attestedAt": "ISO-8601 timestamp"
}`}
              </pre>
            </div>
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}

function ModeCard({ active, disabled, icon, title, text, onClick }: { active: boolean; disabled: boolean; icon: string; title: string; text: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={"card card-pad text-left transition-all " + (active ? "" : "card-hover")}
      style={active ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : {}}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon name={icon} size={16} style={{ color: active ? "var(--accent)" : "var(--ink-light)" }} />
        <span className="font-semibold text-sm">{title}</span>
        {active && <Pill type="accent">Active</Pill>}
      </div>
      <div className="text-xs text-ink-light">{text}</div>
    </button>
  );
}
