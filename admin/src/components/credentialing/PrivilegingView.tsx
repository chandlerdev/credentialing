"use client";

import { Select } from "@/components/Select";
import { CitySelect, StateSelect } from "@/components/AddressFields";

import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Pill } from "@/components/Pill";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useToast } from "@/stores/toast";
import { useUser } from "@/stores/auth";
import { fmtDate } from "@/lib/utils";
import { AppointmentLetterModal } from "@/components/modals/PrivilegingLetterModal";
import {
  isWriterRole,
  type HospitalItem,
  type PrivilegeItemStatus,
  type PrivilegeStatus,
  type PrivilegesResponse,
  type ProviderLite,
} from "@/types/credentialing-ops";

const STATUS_PILL: Record<PrivilegeStatus, { type: string; label: string }> = {
  none: { type: "neutral", label: "Not Requested" },
  requested: { type: "info", label: "Requested" },
  pending: { type: "warn", label: "Pending Review" },
  granted: { type: "success", label: "Granted" },
  denied: { type: "danger", label: "Denied" },
};

const hospitalCity = (h: HospitalItem) => [h.city, h.state].filter(Boolean).join(", ");

function AddHospitalModal({ onClose, onCreated }: { onClose: () => void; onCreated: (h: HospitalItem) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", city: "", state: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Hospital name is required";
    else if (form.name.trim().length > 200) errs.name = "Max 200 characters";
    if (form.state && !/^[A-Za-z]{2}$/.test(form.state)) errs.state = "Use a 2-letter state code";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const h = await api.post<HospitalItem>("/hospitals", { name: form.name.trim(), city: form.city.trim(), state: form.state.toUpperCase() });
      toast("Hospital added");
      onCreated(h);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add Hospital" subtitle="Hospitals where your providers hold clinical privileges" onClose={onClose} maxWidth={460}>
      <div className="space-y-3">
        <Field label="Hospital name" required error={errors.name}>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Enter Hospital name" autoFocus />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="State" error={errors.state}>
            <StateSelect value={form.state || ""} onChange={(v) => setForm({ ...form, state: v, city: v === form.state ? form.city : "" })} />
          </Field>
          <Field label="City" error={errors.city}>
            <CitySelect state={form.state || ""} value={form.city || ""} onChange={(v) => setForm({ ...form, city: v })} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={submit} className="btn btn-primary" disabled={busy}>
            {busy ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Plus" size={13} />} Add Hospital
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function PrivilegingView() {
  const toast = useToast();
  const user = useUser();
  const canWrite = isWriterRole(user.role);

  const providersQ = useAsync(() => api.get<ProviderLite[]>("/providers/all-lite"), []);
  const hospitalsQ = useAsync(() => api.get<HospitalItem[]>("/hospitals"), []);

  const [providerChoice, setProviderChoice] = useState<number | null>(null);
  const [hospitalChoice, setHospitalChoice] = useState<number | null>(null);
  const [savingItem, setSavingItem] = useState<number | null>(null);
  const [showAddHospital, setShowAddHospital] = useState(false);
  const [showLetter, setShowLetter] = useState(false);

  const providers = providersQ.data ?? [];
  const hospitals = (hospitalsQ.data ?? []).filter((h) => h.active);
  const selectedProviderId = providerChoice ?? providers[0]?.id ?? null;
  const selectedHospital = hospitalChoice ?? hospitals[0]?.id ?? null;
  const provider = providers.find((p) => p.id === selectedProviderId);
  const hospital = hospitals.find((h) => h.id === selectedHospital);

  const privQ = useAsync<PrivilegesResponse>(
    selectedProviderId && selectedHospital
      ? () => api.get<PrivilegesResponse>("/privileges", { providerId: selectedProviderId, hospitalId: selectedHospital })
      : null,
    [selectedProviderId, selectedHospital]
  );
  const priv = privQ.data && privQ.data.providerId === selectedProviderId && privQ.data.hospitalId === selectedHospital ? privQ.data : undefined;

  const setStatus = async (item: PrivilegeItemStatus, status: PrivilegeStatus) => {
    if (!selectedProviderId || !selectedHospital) return;
    setSavingItem(item.privilegeItemId);
    try {
      const res = await api.put<PrivilegeItemStatus>("/privileges", {
        providerId: selectedProviderId,
        hospitalId: selectedHospital,
        privilegeItemId: item.privilegeItemId,
        status,
      });
      if (priv) {
        privQ.setData({ ...priv, items: priv.items.map((i) => (i.privilegeItemId === item.privilegeItemId ? { ...i, ...res } : i)) });
      }
      toast(item.name + " → " + STATUS_PILL[res.status ?? status].label);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSavingItem(null);
    }
  };

  const loadingPickers = (providersQ.loading && !providersQ.data) || (hospitalsQ.loading && !hospitalsQ.data);
  const pickerError = providersQ.error || hospitalsQ.error;

  return (
    <div>
      <PageHeader
        title="Hospital Privileging"
        subtitle="Manage hospital-specific clinical privilege requests and grants per provider"
        actions={canWrite ? (
          <button className="btn btn-primary" disabled={!provider} onClick={() => setShowLetter(true)}>
            <Icon name="FileText" size={14} /> Generate Privilege Letter
          </button>
        ) : undefined}
      />

      {pickerError ? (
        <ErrorState message={pickerError} onRetry={() => { providersQ.reload(); hospitalsQ.reload(); }} />
      ) : loadingPickers ? (
        <div className="card"><Loading /></div>
      ) : providers.length === 0 ? (
        <div className="card">
          <EmptyState icon="Users" title="No providers yet" description="Add providers to manage their hospital privileges." />
        </div>
      ) : hospitals.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="Building2"
            title="No hospitals yet"
            description="Add the hospitals where your providers request clinical privileges."
            action={canWrite ? (
              <button className="btn btn-primary mt-4" onClick={() => setShowAddHospital(true)}><Icon name="Plus" size={13} /> Add Hospital</button>
            ) : undefined}
          />
        </div>
      ) : (
        <>
          <div className="card card-pad mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">Provider</label>
                <Select value={selectedProviderId ?? ""} onChange={(e) => setProviderChoice(Number(e.target.value))} className="input">
                  {providers.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.specialty || "—"}</option>)}
                </Select>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="label">Hospital</label>
                  {canWrite && (
                    <button type="button" className="text-xs text-ink-light hover:text-ink mb-1" onClick={() => setShowAddHospital(true)}>
                      <Icon name="Plus" size={10} className="inline mr-0.5" /> Add Hospital
                    </button>
                  )}
                </div>
                <Select value={selectedHospital ?? ""} onChange={(e) => setHospitalChoice(Number(e.target.value))} className="input">
                  {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}{hospitalCity(h) ? " — " + hospitalCity(h) : ""}</option>)}
                </Select>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-line gap-3">
              <div>
                <h3 className="font-display font-semibold text-ink">{priv?.providerName ?? provider?.name} — Clinical Privileges</h3>
                <p className="text-xs text-ink-light mt-1">{priv?.hospitalName ?? hospital?.name}</p>
              </div>
              <div className="text-right text-xs">
                <div className="text-ink-light">Specialty category:</div>
                <div className="font-semibold capitalize text-ink">{priv?.categoryName ?? "—"}</div>
              </div>
            </div>
            {privQ.error ? (
              <div className="p-4"><ErrorState message={privQ.error} onRetry={privQ.reload} /></div>
            ) : !priv ? (
              <Loading />
            ) : priv.items.length === 0 ? (
              <EmptyState icon="Award" title="No privileges in catalog" description="No privilege items are configured for this specialty category." />
            ) : (
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Privilege</th><th>Status</th><th>Requested Date</th><th className="text-right">Action</th></tr></thead>
                  <tbody>
                    {priv.items.map((p) => {
                      const st = STATUS_PILL[p.status] ?? STATUS_PILL.none;
                      return (
                        <tr key={p.privilegeItemId}>
                          <td className="font-medium">{p.name}</td>
                          <td>
                            <Pill type={st.type}>{st.label}</Pill>
                          </td>
                          <td className="text-xs text-ink-light">{fmtDate(p.requestedAt)}</td>
                          <td className="text-right">
                            <Select value={p.status} disabled={!canWrite || savingItem === p.privilegeItemId}
                                    onChange={(e) => setStatus(p, e.target.value as PrivilegeStatus)} className="input" style={{ width: 140, fontSize: 12 }}>
                              <option value="none">Not Requested</option>
                              <option value="requested">Requested</option>
                              <option value="pending">Pending Review</option>
                              <option value="granted">Granted</option>
                              <option value="denied">Denied</option>
                            </Select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {showAddHospital && (
        <AddHospitalModal
          onClose={() => setShowAddHospital(false)}
          onCreated={async (h) => {
            setShowAddHospital(false);
            await hospitalsQ.reload();
            setHospitalChoice(h.id);
          }}
        />
      )}

      {showLetter && provider && (
        <AppointmentLetterModal
          providerId={provider.id}
          providerName={priv?.providerName ?? provider.name}
          defaultType="privileging"
          defaultHospitalId={selectedHospital ?? undefined}
          onClose={() => setShowLetter(false)}
        />
      )}
    </div>
  );
}
