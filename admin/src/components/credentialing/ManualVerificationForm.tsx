"use client";

import { Select } from "@/components/Select";

import { useState } from "react";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useToast } from "@/stores/toast";
import type { Verification, VerificationSource } from "@/types/credentialing";

export const SOURCE_LABEL: Record<VerificationSource, string> = {
  npi: "NPI Registry (CMS)",
  oig: "OIG Exclusion List",
  sam: "SAM.gov Debarment",
  state_license: "State Medical Board",
};

/** Records a manual primary-source verification: POST /providers/{id}/verifications. */
export function ManualVerificationForm({
  providerId,
  sources = ["npi", "oig", "sam", "state_license"],
  defaultSource,
  defaultMessage = "",
  onRecorded,
}: {
  providerId: number | null;
  sources?: VerificationSource[];
  defaultSource?: VerificationSource;
  defaultMessage?: string;
  onRecorded?: (v: Verification) => void;
}) {
  const toast = useToast();
  const [source, setSource] = useState<VerificationSource>(defaultSource || sources[0]);
  const [status, setStatus] = useState<"clear" | "flagged">("clear");
  const [message, setMessage] = useState(defaultMessage);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const errs: Record<string, string> = {};
    if (!providerId) errs.providerId = "Select a provider";
    if (message.length > 500) errs.message = "Message must be 500 characters or less";
    if (status === "flagged" && !message.trim()) errs.message = "Describe the finding";
    setErrors(errs);
    if (Object.keys(errs).length || !providerId) return;
    setBusy(true);
    try {
      const v = await api.post<Verification>(`/providers/${providerId}/verifications`, { source, status, message: message.trim() || undefined });
      toast(status === "flagged" ? "Flagged result recorded" : "Verification recorded");
      setMessage(defaultMessage);
      setStatus("clear");
      onRecorded?.(v);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {errors.providerId && <div className="field-error">{errors.providerId}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sources.length > 1 && (
          <Field label="Source" error={errors.source}>
            <Select value={source} onChange={(e) => setSource(e.target.value as VerificationSource)} className="input">
              {sources.map((s) => (
                <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Result" error={errors.status}>
          <div className="flex gap-2">
            {(["clear", "flagged"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setStatus(s)}
                      className={"flex-1 px-3 py-2 rounded-lg border text-sm font-medium " + (status === s ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-light")}>
                <Icon name={s === "clear" ? "CheckCircle2" : "Flag"} size={13} className="inline mr-1" /> {s === "clear" ? "Clear" : "Flagged"}
              </button>
            ))}
          </div>
        </Field>
      </div>
      <Field label="Notes" error={errors.message}>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} className={"input " + (errors.message ? "input-error" : "")} rows={2} maxLength={500} placeholder="Enter Notes" />
      </Field>
      <div className="flex justify-end">
        <button onClick={save} disabled={busy || !providerId} className="btn btn-primary">
          {busy ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Check" size={13} />} Record Result
        </button>
      </div>
    </div>
  );
}
