"use client";

import { Select } from "@/components/Select";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Pill } from "@/components/Pill";
import { StatCard } from "@/components/StatCard";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useToast } from "@/stores/toast";
import { fmtDate, todayISO } from "@/lib/utils";
import { useCaqhPerms } from "./perms";
import type { CaqhProviderStatus, CaqhProviderStatusCode, CaqhStatusResponse, SyncDeferredResponse } from "@/types/caqh";

const STATUS_PILL: Record<CaqhProviderStatusCode, { type: string; label: string }> = {
  ok: { type: "success", label: "Current" },
  due_soon: { type: "warn", label: "Attest Soon" },
  overdue: { type: "danger", label: "Needs Attest" },
  unknown: { type: "info", label: "No Attest Date" },
  not_enrolled: { type: "neutral", label: "Not Enrolled" },
};

export function CAQHSyncView() {
  const toast = useToast();
  const { isWriter } = useCaqhPerms();
  const { data, loading, error, reload } = useAsync(() => api.get<CaqhStatusResponse>("/caqh/status"), []);
  const [syncing, setSyncing] = useState<number | "all" | null>(null);
  const [editing, setEditing] = useState<CaqhProviderStatus | null>(null);

  const sync = async (providerId: number | null) => {
    setSyncing(providerId ?? "all");
    try {
      const res = await api.post<SyncDeferredResponse>("/caqh/sync-runs", providerId != null ? { providerId } : {});
      toast(res.message, "info");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSyncing(null);
    }
  };

  const stats = data?.stats;
  const items = data?.items || [];

  return (
    <div>
      <PageHeader
        title="CAQH ProView Sync"
        subtitle="Automatic synchronization of provider data with CAQH ProView. Auto-attests trigger every 120 days."
        actions={
          isWriter ? (
            <button className="btn btn-primary" onClick={() => sync(null)} disabled={syncing === "all"}>
              {syncing === "all" ? <><span className="loader"></span> Syncing...</> : <><Icon name="RefreshCw" size={14} /> Sync All Providers</>}
            </button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="With CAQH" value={stats ? stats.withCaqh : "—"} sub="Providers synced" icon="Database" color="var(--success)" />
        <StatCard label="Without CAQH" value={stats ? stats.withoutCaqh : "—"} sub="Need setup" icon="DatabaseZap" color="var(--warn)" emphasize={!!stats && stats.withoutCaqh > 0} />
        <StatCard label="Attest Due Soon" value={stats ? stats.attestSoon : "—"} sub="Within 20 days" icon="Clock" color="var(--warn)" />
        <StatCard label="Overdue Attests" value={stats ? stats.overdue : "—"} sub="Action needed" icon="AlertTriangle" color="var(--danger)" emphasize={!!stats && stats.overdue > 0} />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !data ? (
        <div className="card"><Loading /></div>
      ) : items.length === 0 ? (
        <div className="card"><EmptyState icon="Database" title="No providers yet" description="Add or import providers to track their CAQH ProView sync and attestation status." /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Provider</th><th>CAQH ID</th><th>Last Sync</th><th>Last Attest</th><th>Next Attest</th><th>Status</th><th className="text-right">Actions</th></tr>
              </thead>
              <tbody>
                {items.map((e) => {
                  const hasCaqh = !!e.caqhId;
                  const pill = STATUS_PILL[e.status] || STATUS_PILL.unknown;
                  return (
                    <tr key={e.providerId}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Avatar name={e.name} size={26} />
                          <span className="font-medium">{e.name}</span>
                        </div>
                      </td>
                      <td className="font-mono text-xs">{hasCaqh ? e.caqhId : <span className="text-ink-faint italic">Not enrolled</span>}</td>
                      <td className="text-xs text-ink-light">{hasCaqh && e.lastSynced ? fmtDate(e.lastSynced.slice(0, 10)) : "—"}</td>
                      <td className="text-xs text-ink-light">{hasCaqh ? fmtDate(e.lastAttested) : "—"}</td>
                      <td className="text-xs text-ink-light">{hasCaqh ? fmtDate(e.nextAttestationDue) : "—"}</td>
                      <td>
                        <Pill type={pill.type}>{pill.label}</Pill>
                      </td>
                      <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                        {!isWriter ? (
                          <span className="text-xs text-ink-faint">—</span>
                        ) : hasCaqh ? (
                          <>
                            <button onClick={() => setEditing(e)} className="btn btn-ghost text-xs mr-1" title="Update attestation">
                              <Icon name="CalendarCheck" size={11} /> Attestation
                            </button>
                            <button onClick={() => sync(e.providerId)} disabled={syncing === e.providerId} className="btn btn-secondary text-xs">
                              {syncing === e.providerId ? <><span className="loader"></span> Syncing...</> : <><Icon name="RefreshCw" size={11} /> Sync Now</>}
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setEditing(e)} className="btn btn-primary text-xs"><Icon name="Plus" size={11} /> Enroll in CAQH</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <AttestationModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

const ATTESTATION_STATUSES = ["Current", "Attested", "Pending", "Expired", "Not Attested"];

function AttestationModal({ item, onClose, onSaved }: { item: CaqhProviderStatus; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const enrolling = !item.caqhId;
  const [form, setForm] = useState({
    caqhId: item.caqhId || "",
    lastAttested: item.lastAttested || "",
    attestationStatus: item.attestationStatus || "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const today = todayISO();

  const save = async () => {
    const errs: Record<string, string> = {};
    if (enrolling && !form.caqhId.trim()) errs.caqhId = "CAQH Provider ID is required";
    if (form.lastAttested && form.lastAttested > today) errs.lastAttested = "Attestation date cannot be in the future";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body: { caqhId?: string; lastAttested?: string; attestationStatus?: string } = {};
    if (form.caqhId.trim() !== (item.caqhId || "")) body.caqhId = form.caqhId.trim();
    if (form.lastAttested && form.lastAttested !== item.lastAttested) body.lastAttested = form.lastAttested;
    if (form.attestationStatus && form.attestationStatus !== item.attestationStatus) body.attestationStatus = form.attestationStatus;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await api.patch<CaqhProviderStatus>("/caqh/providers/" + item.providerId, body);
      toast(enrolling ? item.name + " enrolled in CAQH" : "CAQH attestation updated");
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={enrolling ? "Enroll in CAQH" : "Update CAQH Attestation"} subtitle={item.name} onClose={onClose} maxWidth={520}>
      <div className="space-y-3">
        <Field label="CAQH Provider ID" required={enrolling} error={errors.caqhId} hint={!enrolling ? "Clear the field to remove the CAQH ID" : undefined}>
          <input value={form.caqhId} onChange={(e) => setForm({ ...form, caqhId: e.target.value })} className="input font-mono" placeholder="Enter CAQH Provider ID" />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Last attested" error={errors.lastAttested} hint="Next attestation is due 120 days later">
            <input type="date" max={today} value={form.lastAttested} onChange={(e) => setForm({ ...form, lastAttested: e.target.value })} className="input" />
          </Field>
          <Field label="Attestation status" error={errors.attestationStatus}>
            <Select value={form.attestationStatus} onChange={(e) => setForm({ ...form, attestationStatus: e.target.value })} className="input">
              <option value="">{form.lastAttested ? "Auto (Attested)" : "—"}</option>
              {form.attestationStatus && !ATTESTATION_STATUSES.includes(form.attestationStatus) && <option value={form.attestationStatus}>{form.attestationStatus}</option>}
              {ATTESTATION_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={save} className="btn btn-primary" disabled={busy}>
            {busy ? <span className="loader" style={{ borderTopColor: "white" }}></span> : <Icon name="Save" size={13} />} {enrolling ? "Save" : "Update"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
