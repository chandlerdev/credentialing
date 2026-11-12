"use client";

import { Select } from "@/components/Select";

import { useEffect, useState } from "react";
import { DeferredNotice } from "@/components/AlertBox";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { api, errorMessage } from "@/lib/api";
import { useUser } from "@/stores/auth";
import { ManualVerificationForm } from "@/components/credentialing/ManualVerificationForm";
import { isWriter } from "@/components/credentialing/InfoField";
import type { DeferredResponse, ProviderLite } from "@/types/credentialing";

/**
 * NPI registry lookup. The live NPPES lookup is deferred: GET /npi/{npi} returns a message,
 * and staff can record a manual NPI verification for one of their providers.
 */
export function NPILookupModal({ initialNpi, onClose }: { initialNpi?: string; onClose: () => void }) {
  const me = useUser();
  const canWrite = isWriter(me.role);
  const [npi, setNpi] = useState(initialNpi || "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [providers, setProviders] = useState<ProviderLite[]>([]);
  const [providerId, setProviderId] = useState("");
  const [recorded, setRecorded] = useState<string | null>(null);

  useEffect(() => {
    api.get<ProviderLite[]>("/providers/all-lite").then(setProviders).catch(() => {});
  }, []);

  const lookup = async () => {
    setError("");
    setRecorded(null);
    if (!/^\d{10}$/.test(npi)) {
      setError("NPI must be 10 digits");
      return;
    }
    setLoading(true);
    try {
      const res = await api.get<DeferredResponse>(`/npi/${npi}`);
      setResult(res.message);
      const match = providers.find((p) => p.npi === npi);
      if (match) setProviderId(String(match.id));
    } catch (e) {
      setError(errorMessage(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const selected = providers.find((p) => String(p.id) === providerId);

  return (
    <Modal title="NPI Registry Lookup" subtitle="Verify provider credentials against CMS National Provider Identifier registry" onClose={onClose} maxWidth={560}>
      <div className="p-2 rounded text-xs flex items-start gap-2 mb-3" style={{ background: "var(--info-soft)", color: "#1e40af" }}>
        <Icon name="Info" size={12} className="mt-0.5" />
        <div>
          Automatic lookups against <span className="font-mono">npiregistry.cms.hhs.gov</span> will be available in a later phase. Until then, look the NPI up on the{" "}
          <a href="https://npiregistry.cms.hhs.gov/search" target="_blank" rel="noopener noreferrer" className="underline font-semibold">public NPPES registry</a> and record the result here.
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="label">NPI Number</label>
          <div className="flex gap-2">
            <input value={npi} onChange={(e) => setNpi(e.target.value.replace(/\D/g, "").slice(0, 10))}
                   onKeyDown={(e) => e.key === "Enter" && lookup()}
                   className="input font-mono" placeholder="Enter NPI Number" maxLength={10} />
            <button onClick={lookup} disabled={!npi || loading} className="btn btn-primary">
              {loading ? <><span className="loader"></span> Searching...</> : <><Icon name="Search" size={13} /> Lookup</>}
            </button>
          </div>
        </div>

        {error && (
          <div className="px-3 py-2 rounded-lg text-sm flex items-center gap-2" style={{ background: "var(--danger-soft)", color: "#991b1b" }}>
            <Icon name="AlertCircle" size={13} /> {error}
          </div>
        )}

        {result && <DeferredNotice>{result}</DeferredNotice>}

        {result && canWrite && (
          <div className="card card-pad bg-soft">
            <div className="flex items-center gap-2 mb-3">
              <Icon name="ClipboardCheck" size={16} className="text-accent" />
              <div className="font-semibold text-ink text-sm">Record manual NPI verification</div>
            </div>
            <div className="mb-3">
              <label className="label">Provider</label>
              <Select value={providerId} onChange={(e) => setProviderId(e.target.value)} className="input">
                <option value="">— Select provider —</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.npi ? " · NPI " + p.npi : ""}
                  </option>
                ))}
              </Select>
              {selected && selected.npi && selected.npi !== npi && (
                <div className="text-[11px] mt-1" style={{ color: "#a16207" }}>
                  <Icon name="AlertTriangle" size={10} className="inline" /> This provider&apos;s NPI on file is {selected.npi}.
                </div>
              )}
            </div>
            <ManualVerificationForm
              key={npi + providerId}
              providerId={providerId ? Number(providerId) : null}
              sources={["npi"]}
              defaultMessage={"NPI " + npi + " verified manually in the NPPES registry"}
              onRecorded={() => setRecorded(selected?.name || "provider")}
            />
            {recorded && (
              <div className="mt-2 text-xs flex items-center gap-1" style={{ color: "var(--success)" }}>
                <Icon name="CheckCircle2" size={12} /> NPI verification recorded for {recorded}.
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
