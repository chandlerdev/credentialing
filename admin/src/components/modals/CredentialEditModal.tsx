"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import type { VaultCredential } from "@/components/vault/crypto";

/** Port of the prototype CredentialEditModal (L13143). */
export function CredentialEditModal({
  payer,
  existing,
  onSave,
  onClose,
}: {
  payer: { name: string; portalUrl: string | null };
  existing: VaultCredential | null;
  onSave: (cred: { username: string; password: string; notes: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [username, setUsername] = useState(existing?.username || "");
  const [password, setPassword] = useState(existing?.password || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ username, password, notes });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={(existing ? "Edit" : "Add") + " " + payer.name + " Credentials"} subtitle="Encrypted with AES-256 before storage" onClose={onClose} maxWidth={480}>
      <div className="space-y-3">
        <div>
          <label className="label">Username / Email</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} className="input font-mono" autoFocus />
        </div>
        <div>
          <label className="label">Password</label>
          <div className="flex gap-2">
            <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className="input font-mono" />
            <button onClick={() => setShowPw(!showPw)} className="btn btn-secondary" aria-label={showPw ? "Hide password" : "Show password"}>
              <Icon name={showPw ? "EyeOff" : "Eye"} size={13} />
            </button>
          </div>
        </div>
        <div>
          <label className="label">Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input" rows={2} placeholder="Enter Notes" />
        </div>
        {payer.portalUrl && (
          <div className="text-[10px] text-ink-faint p-2 rounded" style={{ background: "var(--bg-soft)" }}>
            <Icon name="Info" size={10} className="inline mr-1" />
            Portal URL:{" "}
            <a href={payer.portalUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              {payer.portalUrl}
            </a>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={saving}>
            Cancel
          </button>
          <button onClick={save} disabled={!username || !password || saving} className="btn btn-primary">
            {saving ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Lock" size={13} />} {existing ? "Encrypt & Update" : "Encrypt & Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
