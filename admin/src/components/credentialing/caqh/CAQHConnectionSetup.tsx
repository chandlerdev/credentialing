"use client";

import { Select } from "@/components/Select";

import { useState } from "react";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useToast } from "@/stores/toast";
import { useCaqhPerms } from "./perms";
import type { AggregatorVendor, CaqhConfig, CaqhConfigTestResult, CaqhEnvironment, CaqhPath } from "@/types/caqh";

const VENDOR_DEFAULTS: Record<AggregatorVendor, string> = {
  certifyos: "https://api.certifyos.com/v1",
  andros: "https://api.andros.co/v1",
  verifiable: "https://api.verifiable.com/v1",
  medallion: "https://api.medallion.co/v1",
};

const PATHS: { id: CaqhPath; title: string; subtitle: string; icon: string; color: string; time: string; cost: string; difficulty: string; recommended?: boolean }[] = [
  { id: "direct", title: "Direct CAQH PO", subtitle: "Apply as Participating Organization", icon: "Building2", color: "#1d4ed8", time: "4–8 weeks", cost: "Free if approved", difficulty: "High" },
  { id: "aggregator", title: "Aggregator Service", subtitle: "CertifyOS · Andros · Verifiable", icon: "Network", color: "#7c3aed", time: "1–2 weeks", cost: "$5–25 per lookup", difficulty: "Medium" },
  { id: "csv", title: "CSV Import", subtitle: "Manual provider-provided exports", icon: "Upload", color: "#10b981", time: "Today", cost: "Free", difficulty: "Low", recommended: true },
];

const SAVED_PLACEHOLDER = "•••••••• (saved)";

export function CAQHConnectionSetup({ onGoToCsv }: { onGoToCsv: () => void }) {
  const { data, loading, error, reload, setData } = useAsync(() => api.get<CaqhConfig>("/caqh/config"), []);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data) return <div className="card"><Loading /></div>;
  return <ConnectionForm config={data} onSaved={setData} onGoToCsv={onGoToCsv} />;
}

function ConnectionForm({ config, onSaved, onGoToCsv }: { config: CaqhConfig; onSaved: (c: CaqhConfig) => void; onGoToCsv: () => void }) {
  const toast = useToast();
  const { isAdmin, isWriter } = useCaqhPerms();
  const [path, setPath] = useState<CaqhPath>(config.path || "csv");
  const [form, setForm] = useState({
    direct: {
      username: config.directUsername || "",
      password: "",
      organizationId: config.directOrgId || "",
      environment: (config.directEnvironment || "production") as CaqhEnvironment,
    },
    aggregator: {
      vendor: (config.aggregatorVendor || "certifyos") as AggregatorVendor,
      apiKey: "",
      baseUrl: config.aggregatorBaseUrl || "",
    },
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const save = async () => {
    const errs: Record<string, string> = {};
    const baseUrl = form.aggregator.baseUrl.trim();
    if (baseUrl && !baseUrl.startsWith("https://")) errs.aggregatorBaseUrl = "Base URL must start with https://";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body: Record<string, string> = {
      path,
      directUsername: form.direct.username.trim(),
      directOrgId: form.direct.organizationId.trim(),
      directEnvironment: form.direct.environment,
      aggregatorVendor: form.aggregator.vendor,
    };
    if (baseUrl) body.aggregatorBaseUrl = baseUrl;
    if (form.direct.password) body.directPassword = form.direct.password;
    if (form.aggregator.apiKey) body.aggregatorApiKey = form.aggregator.apiKey;

    setSaving(true);
    try {
      const res = await api.put<CaqhConfig>("/caqh/config", body);
      onSaved(res);
      setForm((f) => ({ direct: { ...f.direct, password: "" }, aggregator: { ...f.aggregator, apiKey: "" } }));
      toast("CAQH connection settings saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await api.post<CaqhConfigTestResult>("/caqh/config/test");
      toast(res.message, "info");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      {/* Path selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {PATHS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPath(p.id)}
            className={"card text-left transition-all relative " + (path === p.id ? "border-accent bg-accent-soft" : "card-hover")}
            style={path === p.id ? { borderWidth: 2 } : {}}
          >
            {p.recommended && (
              <div className="absolute -top-2 -right-2 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider" style={{ background: "var(--success)", color: "white" }}>
                Recommended
              </div>
            )}
            <div className="p-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3" style={{ background: p.color + "20", color: p.color }}>
                <Icon name={p.icon} size={18} />
              </div>
              <div className="font-semibold text-ink mb-1">{p.title}</div>
              <div className="text-xs text-ink-light mb-3">{p.subtitle}</div>
              <div className="space-y-1 text-xs text-ink-light">
                <div className="flex justify-between"><span>Setup:</span> <span className="font-semibold text-ink">{p.time}</span></div>
                <div className="flex justify-between"><span>Cost:</span> <span className="font-semibold text-ink">{p.cost}</span></div>
                <div className="flex justify-between"><span>Difficulty:</span> <span className="font-semibold text-ink">{p.difficulty}</span></div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Detail panel */}
      {path === "direct" && (
        <div className="card">
          <div className="p-4 border-b border-line">
            <h3 className="font-display font-semibold text-ink">Direct CAQH Participating Organization Setup</h3>
            <p className="text-xs text-ink-light mt-1">Production credentials from CAQH after PO onboarding</p>
          </div>
          <div className="p-5 space-y-3">
            <div className="p-3 rounded text-xs flex items-start gap-2" style={{ background: "var(--warn-soft)", color: "#a16207" }}>
              <Icon name="AlertTriangle" size={12} className="mt-0.5" />
              <div>
                <strong>To get these credentials:</strong> Go to <a href="https://www.caqh.org/contact-us" target="_blank" rel="noreferrer" className="underline">caqh.org/contact-us</a>, submit a business case, complete onboarding (typically 4–8 weeks). CAQH will issue username, password, and a Participating Organization ID. Approval requires demonstrable credentialing volume.
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="CAQH Username" error={errors.directUsername}>
                <input value={form.direct.username} onChange={(e) => setForm({ ...form, direct: { ...form.direct, username: e.target.value } })} className="input" placeholder="Enter CAQH Username" />
              </Field>
              <Field label="CAQH Password" error={errors.directPassword}>
                <input
                  type="password"
                  value={form.direct.password}
                  onChange={(e) => setForm({ ...form, direct: { ...form.direct, password: e.target.value } })}
                  className="input"
                  placeholder={config.hasDirectPassword ? SAVED_PLACEHOLDER : ""}
                  autoComplete="new-password"
                />
              </Field>
            </div>
            <Field label="Participating Organization ID" error={errors.directOrgId}>
              <input value={form.direct.organizationId} onChange={(e) => setForm({ ...form, direct: { ...form.direct, organizationId: e.target.value } })} className="input font-mono" placeholder="Enter Participating Organization ID" />
            </Field>
            <div>
              <label className="label">API Environment</label>
              <Select value={form.direct.environment} onChange={(e) => setForm({ ...form, direct: { ...form.direct, environment: e.target.value as CaqhEnvironment } })} className="input font-mono text-xs">
                <option value="production">Production — https://api.caqh.org/v2</option>
                <option value="sandbox">Sandbox — https://sandbox.caqh.org/v2</option>
              </Select>
              <div className="text-[10px] text-ink-faint mt-1">Production: <span className="font-mono">https://api.caqh.org/v2</span> · Sandbox: <span className="font-mono">https://sandbox.caqh.org/v2</span></div>
              {errors.directEnvironment && <div className="field-error">{errors.directEnvironment}</div>}
            </div>
            <div className="p-3 rounded text-xs" style={{ background: "var(--info-soft)" }}>
              <Icon name="Info" size={11} className="text-info" /> Available APIs once connected:
              <ul className="mt-1 ml-5 list-disc text-ink-light">
                <li><strong>Credentialing API</strong> — full provider data (XML)</li>
                <li><strong>ProView Status Check API</strong> — application/attestation status</li>
                <li><strong>Roster Management API</strong> — add/update/delete providers on PO roster</li>
                <li><strong>DirectAssure Status Check API</strong> — directory data status</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {path === "aggregator" && (
        <div className="card">
          <div className="p-4 border-b border-line">
            <h3 className="font-display font-semibold text-ink">Aggregator Service Setup</h3>
            <p className="text-xs text-ink-light mt-1">Resells CAQH access via modern REST API</p>
          </div>
          <div className="p-5 space-y-3">
            <Field label="Vendor" error={errors.aggregatorVendor}>
              <Select
                value={form.aggregator.vendor}
                onChange={(e) => {
                  const vendor = e.target.value as AggregatorVendor;
                  setForm({ ...form, aggregator: { ...form.aggregator, vendor, baseUrl: VENDOR_DEFAULTS[vendor] || "" } });
                }}
                className="input"
              >
                <option value="certifyos">CertifyOS</option>
                <option value="andros">Andros</option>
                <option value="verifiable">Verifiable</option>
                <option value="medallion">Medallion</option>
              </Select>
            </Field>
            <Field label="API Key" error={errors.aggregatorApiKey}>
              <input
                type="password"
                value={form.aggregator.apiKey}
                onChange={(e) => setForm({ ...form, aggregator: { ...form.aggregator, apiKey: e.target.value } })}
                className="input font-mono"
                placeholder={config.hasAggregatorKey ? SAVED_PLACEHOLDER : "Enter API Key"}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Base URL" error={errors.aggregatorBaseUrl}>
              <input value={form.aggregator.baseUrl} onChange={(e) => setForm({ ...form, aggregator: { ...form.aggregator, baseUrl: e.target.value } })} className="input font-mono text-xs" />
            </Field>
            <div className="p-3 rounded text-xs" style={{ background: "var(--info-soft)" }}>
              <Icon name="Info" size={11} className="text-info" /> Aggregators typically expose:
              <ul className="mt-1 ml-5 list-disc text-ink-light">
                <li><code className="bg-bg-soft px-1 rounded">GET /providers/{"{caqh_id}"}</code> — full profile</li>
                <li><code className="bg-bg-soft px-1 rounded">GET /providers/search?npi={"{npi}"}</code> — lookup by NPI</li>
                <li><code className="bg-bg-soft px-1 rounded">POST /providers/{"{id}"}/refresh</code> — force re-sync</li>
                <li><code className="bg-bg-soft px-1 rounded">GET /providers/{"{id}"}/attestation-status</code></li>
              </ul>
              Some aggregators also handle OIG/SAM exclusion checks and state license verification in the same API.
            </div>
          </div>
        </div>
      )}

      {path === "csv" && (
        <div className="card card-pad" style={{ background: "var(--success-soft)", borderColor: "var(--success)" }}>
          <div className="flex items-start gap-3">
            <Icon name="CheckCircle2" size={20} className="text-success flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-display font-semibold text-ink mb-1">CSV Import Path Selected</h3>
              <p className="text-sm text-ink-light mb-3">
                The provider exports their profile from <span className="font-mono">proview.caqh.org</span> as PDF or CSV, then your credentialing team uploads it here. No API credentials needed.
              </p>
              <p className="text-xs text-ink-light">
                <strong>How it works:</strong> Provider logs in to ProView → My Information → Export → CSV. They send the file to your team via secure portal or email. You upload it in the CSV Import tab. The parser extracts NPI, demographics, license, work history, malpractice, and references. The new provider is created in your system with all fields pre-populated.
              </p>
              <button onClick={onGoToCsv} className="btn btn-primary mt-3">
                <Icon name="ArrowRight" size={13} /> Try the CSV Import →
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-end items-center gap-2 flex-wrap">
        {!isAdmin && <span className="text-xs text-ink-faint mr-auto">Only organization admins can change CAQH connection settings.</span>}
        {path !== "csv" && isWriter && (
          <button onClick={test} disabled={testing} className="btn btn-secondary">
            {testing ? <span className="loader"></span> : <Icon name="Zap" size={13} />} Test connection
          </button>
        )}
        <button onClick={save} disabled={!isAdmin || saving} className="btn btn-primary">
          {saving ? <span className="loader" style={{ borderTopColor: "white" }}></span> : <Icon name="Save" size={13} />} Save Connection Settings
        </button>
      </div>
    </div>
  );
}
