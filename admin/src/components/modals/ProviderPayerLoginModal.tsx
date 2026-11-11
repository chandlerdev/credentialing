"use client";

import { useState } from "react";
import { AlertBox } from "@/components/AlertBox";
import { Avatar } from "@/components/Avatar";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Loading } from "@/components/AsyncState";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useToast } from "@/stores/toast";
import type { PayerCredential, PayerCredentialRequest, RevealResponse } from "@/types/payers";

export interface LoginModalPayer {
  id: number;
  name: string;
  fullName?: string | null;
  category?: string | null;
  color: string;
}

/**
 * Port of the prototype ProviderPayerLoginModal (L14552).
 * Saves through PUT/DELETE /providers/{providerId}/payer-credentials/{payerId}; the password is encrypted server-side.
 */
export function ProviderPayerLoginModal({
  providerId,
  providerName,
  payer,
  hasExisting,
  onSaved,
  onClose,
}: {
  providerId: number;
  providerName: string;
  payer: LoginModalPayer;
  /** Whether a login already exists (the modal then loads it). */
  hasExisting: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const existingQ = useAsync<PayerCredential | null>(
    hasExisting
      ? async () => {
          const list = await api.get<PayerCredential[]>("/providers/" + providerId + "/payer-credentials");
          return list.find((c) => c.payerId === payer.id) || null;
        }
      : null,
    [hasExisting, providerId, payer.id]
  );
  const existing = existingQ.data || null;

  if (hasExisting && existingQ.loading) {
    return (
      <Modal title={"Update " + payer.name + " Login"} subtitle={"For " + providerName} onClose={onClose} maxWidth={520}>
        <Loading />
      </Modal>
    );
  }
  return (
    <LoginForm
      key={existing?.id || "new"}
      providerId={providerId}
      providerName={providerName}
      payer={payer}
      existing={existing}
      loadError={existingQ.error}
      onSaved={onSaved}
      onClose={onClose}
      toast={toast}
    />
  );
}

function LoginForm({
  providerId,
  providerName,
  payer,
  existing,
  loadError,
  onSaved,
  onClose,
  toast,
}: {
  providerId: number;
  providerName: string;
  payer: LoginModalPayer;
  existing: PayerCredential | null;
  loadError: string | null;
  onSaved: () => void;
  onClose: () => void;
  toast: ReturnType<typeof useToast>;
}) {
  const [username, setUsername] = useState(existing?.username || "");
  const [password, setPassword] = useState("");
  const [payerProviderId, setPayerProviderId] = useState(existing?.payerProviderId || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [showPw, setShowPw] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(loadError);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const nameParts = providerName.split(",")[0].trim().split(/\s+/);
  const placeholder = (nameParts[0] || "first").toLowerCase() + "." + (nameParts.length > 1 ? nameParts[nameParts.length - 1] : "last").toLowerCase();
  const canSave = !!username.trim() && (!!password || !!existing?.hasPassword);

  const toggleShow = async () => {
    // Reveal the stored password the first time "show" is pressed on an existing login.
    if (!showPw && existing?.hasPassword && !password) {
      setRevealing(true);
      try {
        const r = await api.post<RevealResponse>("/payer-credentials/" + existing.id + "/reveal");
        setPassword(r.password || "");
      } catch (e) {
        toast(errorMessage(e), "error");
        setRevealing(false);
        return;
      }
      setRevealing(false);
    }
    setShowPw(!showPw);
  };

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!username.trim()) e.username = "Username is required";
    if (!password && !existing?.hasPassword) e.password = "Password is required";
    // the Provider ID is optional; when entered: letters, digits and dashes
    if (payerProviderId.trim() && !/^[A-Za-z0-9-]+$/.test(payerProviderId.trim())) e.payerProviderId = "Letters, digits and dashes only";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    setFormError(null);
    const body: PayerCredentialRequest = { username: username.trim(), payerProviderId: payerProviderId.trim(), notes };
    if (password) body.password = password;
    try {
      await api.put("/providers/" + providerId + "/payer-credentials/" + payer.id, body);
      toast("Saved " + payer.name + " credentials for " + providerName);
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
      await api.delete("/providers/" + providerId + "/payer-credentials/" + payer.id);
      toast("Deleted");
      setConfirmDelete(false);
      onSaved();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal title={(existing ? "Update " : "Add ") + payer.name + " Login"} subtitle={"For " + providerName} onClose={onClose} maxWidth={520}>
      <div className="space-y-3">
        <div className="p-3 rounded flex items-center gap-3" style={{ background: "var(--bg-soft)" }}>
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-xs" style={{ background: payer.color }}>
            {payer.name.slice(0, 2)}
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">{payer.name}</div>
            <div className="text-xs text-ink-light">{payer.fullName || payer.category}</div>
          </div>
          <Avatar name={providerName} size={32} />
        </div>
        <Field label="Portal Username / Email *" error={errors.username}>
          <input value={username} onChange={(e) => setUsername(e.target.value)} className="input font-mono" autoFocus placeholder={placeholder} maxLength={150} />
        </Field>
        <Field label={existing?.hasPassword ? "Password" : "Password *"} error={errors.password} hint={existing?.hasPassword && !password ? "Leave blank to keep the saved password" : undefined}>
          <div className="flex gap-2">
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input font-mono"
              placeholder={existing?.hasPassword ? "••••••••" : ""}
              maxLength={500}
            />
            <button onClick={toggleShow} className="btn btn-secondary" disabled={revealing} aria-label={showPw ? "Hide password" : "Show password"}>
              {revealing ? <span className="loader" /> : <Icon name={showPw ? "EyeOff" : "Eye"} size={13} />}
            </button>
          </div>
        </Field>
        <Field label="Provider ID (with payer)" error={errors.payerProviderId} hint="The ID this payer assigned to the provider">
          <input value={payerProviderId} onChange={(e) => setPayerProviderId(e.target.value.replace(/[^A-Za-z0-9-]/g, ""))} className="input font-mono" placeholder="e.g. 1234567" maxLength={60} />
        </Field>
        <Field label="Notes (optional)" error={errors.notes}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input" rows={2} placeholder="Account manager, security questions, etc." maxLength={1000} />
        </Field>
        {formError && <AlertBox>{formError}</AlertBox>}
        <div className="flex justify-between gap-2 pt-3 border-t border-line">
          {existing ? (
            <button onClick={() => setConfirmDelete(true)} className="btn btn-ghost text-danger" style={{ color: "var(--danger)" }} disabled={saving}>
              <Icon name="Trash2" size={13} /> Delete
            </button>
          ) : (
            <div></div>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-secondary" disabled={saving}>
              Cancel
            </button>
            <button onClick={submit} disabled={!canSave || saving} className="btn btn-primary">
              {saving ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Save" size={13} />} {existing ? "Update Credentials" : "Save Credentials"}
            </button>
          </div>
        </div>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete credentials"
          message={"Delete " + payer.name + " credentials for " + providerName + "?"}
          busy={deleting}
          onConfirm={doDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}
