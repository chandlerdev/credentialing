"use client";

import { useMemo, useState } from "react";
import { matchesSearch } from "@/lib/search";
import { cleanSearch } from "@/lib/utils";
import { AlertBox } from "@/components/AlertBox";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useToast } from "@/stores/toast";
import type { DeferredResponse } from "@/types";
import type { Payer, PayerCredential, PayerCredentialRequest } from "@/types/payers";
import { providerName, useProvidersLite } from "@/components/enrollments/shared";

/**
 * Port of the prototype PayerPortalLoginModal (L4496): org-level payer portal credentials.
 * The login is assigned to the providers who use it; Payer Submissions only offers "Submit for" those providers.
 * "Test Connection" calls the (deferred) test endpoint and shows its message.
 */
export function PayerPortalLoginModal({
  payer,
  existing,
  canEdit,
  canDelete,
  onSaved,
  onClose,
  presetProviderId,
}: {
  payer: Payer;
  existing: PayerCredential | null;
  canEdit: boolean;
  canDelete: boolean;
  onSaved: () => void;
  onClose: () => void;
  /** also tick this provider (e.g. the one chosen in Payer Submissions when clicking Assign) */
  presetProviderId?: number | null;
}) {
  const toast = useToast();
  const providers = useProvidersLite();
  const [assigned, setAssigned] = useState<number[]>(() => {
    const ids = existing?.providerIds || [];
    return presetProviderId && !ids.includes(presetProviderId) ? [...ids, presetProviderId] : ids;
  });
  const [providerSearch, setProviderSearch] = useState("");
  const shownProviders = useMemo(() => {
    return (providers.data || []).filter((p) => matchesSearch(providerSearch, providerName(p), p.npi));
  }, [providers.data, providerSearch]);
  const toggleProvider = (id: number) => setAssigned((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const [form, setForm] = useState({
    portalUrl: existing?.portalUrl || payer.portalUrl || "https://providers." + payer.name.toLowerCase().replace(/\s+/g, "") + ".com",
    username: existing?.username || "",
    password: "",
    providerId: existing?.payerProviderId || "",
    tin: existing?.groupTin || "",
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean | null; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const hasPassword = !!form.password || !!existing?.hasPassword;

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.post<DeferredResponse>("/payer-credentials/" + payer.id + "/test");
      setTestResult({ ok: null, message: r.message });
    } catch (e) {
      setTestResult({ ok: false, message: errorMessage(e) });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (!form.username.trim()) e.username = "Username is required";
    if (!hasPassword) e.password = "Password is required";
    if (form.tin && form.tin.length > 20) e.groupTin = "Max 20 characters";
    // the Provider ID is optional
    if (form.providerId.length > 60) e.payerProviderId = "Max 60 characters";
    else if (form.providerId.trim() && !/^[A-Za-z0-9-]+$/.test(form.providerId.trim())) e.payerProviderId = "Letters, digits and dashes only";
    if (!assigned.length) e.providerIds = "Choose at least one provider who uses this login";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    setFormError(null);
    const body: PayerCredentialRequest = {
      username: form.username,
      portalUrl: form.portalUrl || undefined,
      payerProviderId: form.providerId || undefined,
      groupTin: form.tin || undefined,
      providerIds: assigned,
    };
    if (form.password) body.password = form.password;
    try {
      await api.put("/payer-credentials/" + payer.id, body);
      toast("Credentials saved for portal access");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await api.delete("/payer-credentials/" + payer.id);
      toast("Credentials removed");
      setConfirmDelete(false);
      onSaved();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal title={payer.name + " Portal Login"} subtitle="Save credentials to enable single-click portal access and submission tracking." onClose={onClose} maxWidth={560}>
      <div className="space-y-3">
        <Field label="Portal URL" error={errors.portalUrl}>
          <input value={form.portalUrl} onChange={(e) => setForm({ ...form, portalUrl: e.target.value })} className="input font-mono text-xs" disabled={!canEdit} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Username *" error={errors.username}>
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="input" disabled={!canEdit} maxLength={150} />
          </Field>
          <Field label={existing?.hasPassword ? "Password" : "Password *"} error={errors.password} hint={existing?.hasPassword && !form.password ? "Leave blank to keep the saved password" : undefined}>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="input"
              placeholder={existing?.hasPassword ? "••••••••" : ""}
              disabled={!canEdit}
              maxLength={500}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Provider ID (with payer)" error={errors.payerProviderId}>
            <input value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value.replace(/[^A-Za-z0-9-]/g, "") })} className="input font-mono" disabled={!canEdit} maxLength={60} />
          </Field>
          <Field label="Group TIN" error={errors.groupTin}>
            <input value={form.tin} onChange={(e) => setForm({ ...form, tin: e.target.value })} className="input font-mono" disabled={!canEdit} maxLength={20} />
          </Field>
        </div>
        <Field
          label={
            <>
              Providers who use this login * <span className="text-ink-faint font-normal">({assigned.length} selected)</span>
            </>
          }
          error={errors.providerIds}
          hint={"Payer Submissions offers \"Submit for\" only these providers, and the login is used only for them."}
        >
          <div className="border border-line rounded-lg" style={errors.providerIds ? { borderColor: "var(--danger)" } : undefined}>
            <div className="flex items-center gap-2 p-2 border-b border-line">
              <input value={providerSearch} onChange={(e) => setProviderSearch(cleanSearch(e.target.value))} className="input input-sm flex-1" placeholder="Search providers…" disabled={!canEdit} />
              {canEdit && (
                <>
                  <button type="button" className="text-[11px] text-accent hover:underline" onClick={() => setAssigned(Array.from(new Set([...assigned, ...shownProviders.map((p) => p.id)])))}>
                    Select all
                  </button>
                  <button type="button" className="text-[11px] text-ink-light hover:underline" onClick={() => setAssigned([])}>
                    Clear
                  </button>
                </>
              )}
            </div>
            <div className="overflow-y-auto p-1" style={{ maxHeight: 170 }}>
              {providers.loading && <div className="text-xs text-ink-faint p-2">Loading providers…</div>}
              {!providers.loading && shownProviders.length === 0 && <div className="text-xs text-ink-faint p-2">No providers</div>}
              {shownProviders.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-soft text-xs cursor-pointer">
                  <input type="checkbox" checked={assigned.includes(p.id)} onChange={() => toggleProvider(p.id)} disabled={!canEdit} />
                  <span className="flex-1 truncate">{providerName(p)}</span>
                  <span className="font-mono text-ink-faint">{p.npi || ""}</span>
                </label>
              ))}
            </div>
          </div>
        </Field>
        {testResult && (
          <div
            className="p-3 rounded-lg text-sm"
            style={{
              background: testResult.ok === null ? "var(--info-soft)" : testResult.ok ? "var(--success-soft)" : "var(--danger-soft)",
              color: testResult.ok === null ? "#1e40af" : testResult.ok ? "#065f46" : "#991b1b",
            }}
          >
            <Icon name={testResult.ok === null ? "Info" : testResult.ok ? "CheckCircle2" : "AlertCircle"} size={13} /> {testResult.message}
          </div>
        )}
        {formError && <AlertBox>{formError}</AlertBox>}
        <div className="flex justify-between gap-2 pt-3 border-t border-line flex-wrap">
          <div className="flex gap-2">
            <button onClick={test} disabled={!form.username || !hasPassword || testing} className="btn btn-secondary">
              {testing ? (
                <>
                  <span className="loader"></span> Testing...
                </>
              ) : (
                <>
                  <Icon name="Plug" size={13} /> Test Connection
                </>
              )}
            </button>
            {existing && canDelete && (
              <button onClick={() => setConfirmDelete(true)} className="btn btn-ghost" style={{ color: "var(--danger)" }} aria-label="Remove credentials">
                <Icon name="Trash2" size={13} />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-secondary" disabled={saving}>
              Cancel
            </button>
            {canEdit && (
              <button onClick={save} className="btn btn-primary" disabled={saving || !form.username.trim() || !hasPassword || !assigned.length}>
                {saving && <span className="loader" style={{ borderTopColor: "white" }} />} {existing ? "Update Credentials" : "Save Credentials"}
              </button>
            )}
          </div>
        </div>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Remove credentials"
          message={"Remove the organization-level " + payer.name + " portal login?"}
          confirmLabel="Remove"
          busy={deleting}
          onConfirm={doDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}
