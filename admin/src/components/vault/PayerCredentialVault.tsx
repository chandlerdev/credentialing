"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { ConfirmDialog } from "@/components/Modal";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { Pill } from "@/components/Pill";
import { StatCard } from "@/components/StatCard";
import { api, errorMessage, getSelectedOrgId } from "@/lib/api";
import { isOrgAdmin, useUser } from "@/stores/auth";
import { useAsync } from "@/lib/hooks";
import { fmtDate } from "@/lib/utils";
import { useToast } from "@/stores/toast";
import { providerName, usePayers, useProvidersLite } from "@/components/enrollments/shared";
import { isPrivatePayer } from "@/lib/constants";
import { CredentialEditModal } from "@/components/modals/CredentialEditModal";
import { decryptString, encryptString, vaultSession, type VaultCredential, type VaultData } from "./crypto";

interface VaultBlob {
  exists: boolean;
  ciphertext: string | null;
  updatedAt: string | null;
  updatedBy: number | null;
}

/**
 * Port of the prototype PayerCredentialVault (L12818): zero-knowledge vault.
 * The vault JSON is encrypted in the browser; only the ciphertext is loaded/saved via GET/PUT /credential-vault.
 * The passphrase stays in memory (component state + optional in-memory session cache), never in web storage.
 */
export function PayerCredentialVault() {
  const user = useUser();
  const toast = useToast();
  const orgKey = String(getSelectedOrgId() ?? user.orgId ?? "");
  const canWipe = isOrgAdmin(user);

  const [vault, setVault] = useState<VaultData | null>(null);
  const [locked, setLocked] = useState(true);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState("");
  const [rememberSession, setRememberSession] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<number | null>(null);
  const [editingCred, setEditingCred] = useState<{ providerId: number; payerId: number; existing: VaultCredential | null } | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [deleting, setDeleting] = useState<{ providerId: number; payerId: number; payerName: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  /** updatedAt of the ciphertext the in-memory vault was decrypted from (detects concurrent edits). */
  const versionRef = useRef<string | null>(null);

  const blob = useAsync<VaultBlob>(() => api.get("/credential-vault"), [orgKey]);
  const providers = useProvidersLite(!locked);
  const payers = usePayers(true);

  // Auto-unlock with the in-memory session passphrase (if "stay unlocked" was chosen earlier in this tab).
  useEffect(() => {
    const b = blob.data;
    const sessionPass = vaultSession.get(orgKey);
    if (!b?.exists || !b.ciphertext || !sessionPass || !locked) return;
    let cancelled = false;
    (async () => {
      try {
        const decrypted = await decryptString(b.ciphertext!, sessionPass);
        if (cancelled) return;
        setVault(JSON.parse(decrypted) as VaultData);
        versionRef.current = b.updatedAt;
        setPassphrase(sessionPass);
        setLocked(false);
      } catch {
        vaultSession.clear();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob.data, orgKey]);

  if (blob.error) return <ErrorState message={blob.error} onRetry={blob.reload} />;
  if (!blob.data) return <Loading />;

  const isFirstTime = !blob.data.exists;

  const initializeVault = async () => {
    if (passphrase.length < 8) {
      setError("Passphrase must be at least 8 characters");
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setError("Passphrases don't match");
      return;
    }
    setInitializing(true);
    const emptyVault: VaultData = {};
    try {
      const encrypted = await encryptString(JSON.stringify(emptyVault), passphrase);
      const saved = await api.put<VaultBlob>("/credential-vault", { ciphertext: encrypted });
      blob.setData(saved);
      versionRef.current = saved.updatedAt;
      if (rememberSession) vaultSession.set(orgKey, passphrase);
      else vaultSession.clear();
      setVault(emptyVault);
      setConfirmPassphrase("");
      setLocked(false);
      setError("");
      toast("Vault created · encrypted with AES-256-GCM");
    } catch (e) {
      setError("Failed to initialize vault: " + errorMessage(e));
    }
    setInitializing(false);
  };

  const unlockVault = async () => {
    if (!passphrase) return;
    setInitializing(true);
    try {
      // Always decrypt the latest server copy.
      const latest = await api.get<VaultBlob>("/credential-vault");
      blob.setData(latest);
      if (!latest.exists || !latest.ciphertext) {
        setError("The vault no longer exists. Create a new one.");
        setInitializing(false);
        return;
      }
      let decrypted: string;
      try {
        decrypted = await decryptString(latest.ciphertext, passphrase);
      } catch {
        setError("Incorrect passphrase");
        setInitializing(false);
        return;
      }
      setVault(JSON.parse(decrypted) as VaultData);
      versionRef.current = latest.updatedAt;
      setLocked(false);
      setError("");
      if (rememberSession) vaultSession.set(orgKey, passphrase);
      else vaultSession.clear();
      toast("Vault unlocked");
    } catch (e) {
      setError(errorMessage(e));
    }
    setInitializing(false);
  };

  const lockVault = () => {
    setVault(null);
    setLocked(true);
    setPassphrase("");
    setSelectedProvider(null);
    setEditingCred(null);
    setShowPasswords({});
    vaultSession.clear();
    toast("Vault locked");
  };

  /** Applies `mutate` to the latest vault (re-decrypting if someone else saved meanwhile), re-encrypts and saves it. */
  const saveVaultChange = async (mutate: (v: VaultData) => VaultData): Promise<boolean> => {
    try {
      let base: VaultData = vault || {};
      const latest = await api.get<VaultBlob>("/credential-vault");
      if (latest.exists && latest.ciphertext && latest.updatedAt !== versionRef.current) {
        base = JSON.parse(await decryptString(latest.ciphertext, passphrase)) as VaultData;
      }
      const next = mutate(structuredClone(base));
      const encrypted = await encryptString(JSON.stringify(next), passphrase);
      const saved = await api.put<VaultBlob>("/credential-vault", { ciphertext: encrypted });
      blob.setData(saved);
      versionRef.current = saved.updatedAt;
      setVault(next);
      return true;
    } catch (e) {
      toast("Save failed: " + errorMessage(e), "error");
      return false;
    }
  };

  const upsertCredential = async (providerId: number, payerId: number, cred: { username: string; password: string; notes: string }) => {
    const ok = await saveVaultChange((next) => {
      if (!next[providerId]) next[providerId] = {};
      next[providerId][payerId] = { ...cred, updated: new Date().toISOString() };
      return next;
    });
    if (ok) {
      setEditingCred(null);
      toast("Credential saved & encrypted");
    }
  };

  const deleteCredential = async () => {
    if (!deleting) return;
    const { providerId, payerId } = deleting;
    setDeleteBusy(true);
    const ok = await saveVaultChange((next) => {
      if (next[providerId]) {
        delete next[providerId][payerId];
        if (Object.keys(next[providerId]).length === 0) delete next[providerId];
      }
      return next;
    });
    setDeleteBusy(false);
    if (ok) {
      setDeleting(null);
      toast("Credential deleted");
    }
  };

  const wipeVault = async () => {
    setWiping(true);
    try {
      await api.delete("/credential-vault");
      vaultSession.clear();
      setVault(null);
      setLocked(true);
      setPassphrase("");
      setConfirmPassphrase("");
      setConfirmWipe(false);
      versionRef.current = null;
      blob.setData({ exists: false, ciphertext: null, updatedAt: null, updatedBy: null });
      toast("Vault wiped");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setWiping(false);
    }
  };

  const wipeDialog = confirmWipe && (
    <ConfirmDialog
      title="Reset vault"
      message="Permanently delete the vault and all encrypted credentials? This cannot be undone."
      confirmLabel="Delete vault"
      busy={wiping}
      onConfirm={wipeVault}
      onClose={() => setConfirmWipe(false)}
    />
  );

  // Locked / setup screen
  if (locked || !vault) {
    return (
      <div>
        <PageHeader title="Payer Credential Vault" subtitle="Store your provider portal usernames and passwords, encrypted with your master passphrase" />

        <div className="card card-pad mb-4" style={{ background: "var(--info-soft)", borderColor: "var(--info)" }}>
          <div className="flex items-start gap-3">
            <Icon name="Lock" size={18} className="text-info flex-shrink-0 mt-0.5" />
            <div className="text-xs text-ink">
              <strong>How this works:</strong> Credentials are encrypted with AES-256-GCM using a key derived from your passphrase (PBKDF2, 250k iterations, SHA-256). Only the
              ciphertext is stored on our servers — the passphrase never leaves your browser, so only people who know it can decrypt the vault. <strong>Honest caveat:</strong>{" "}
              browser-based encryption isn&apos;t a substitute for a proper secrets manager — for production, use AWS Secrets Manager, HashiCorp Vault, or 1Password Teams.
            </div>
          </div>
        </div>

        <div className="card card-pad" style={{ maxWidth: 480, margin: "0 auto" }}>
          {isFirstTime ? (
            <div>
              <h3 className="font-display text-xl font-bold text-ink mb-1">Create Your Vault</h3>
              <p className="text-xs text-ink-light mb-4">
                Choose a strong master passphrase. If you forget it, you cannot recover your credentials — you&apos;ll need to reset the vault and re-enter everything.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="label">Master Passphrase</label>
                  <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} className="input" placeholder="Enter Master Passphrase" autoFocus />
                  <div className="text-[10px] text-ink-faint mt-1">Longer is better. A memorable sentence beats a short random string.</div>
                </div>
                <div>
                  <label className="label">Confirm Passphrase</label>
                  <input
                    type="password"
                    value={confirmPassphrase}
                    onChange={(e) => setConfirmPassphrase(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && initializeVault()}
                    className="input"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={rememberSession} onChange={(e) => setRememberSession(e.target.checked)} />
                  Stay unlocked for this browser session (recommended)
                </label>
                {error && <div className="text-xs text-danger" style={{ color: "var(--danger)" }}>{error}</div>}
                <button onClick={initializeVault} disabled={initializing} className="btn btn-primary w-full">
                  {initializing ? (
                    <>
                      <span className="loader"></span> Encrypting...
                    </>
                  ) : (
                    <>
                      <Icon name="Lock" size={13} /> Create Encrypted Vault
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <h3 className="font-display text-xl font-bold text-ink mb-1">Unlock Your Vault</h3>
              <p className="text-xs text-ink-light mb-4">Enter your master passphrase to access your stored credentials.</p>
              <div className="space-y-3">
                <div>
                  <label className="label">Master Passphrase</label>
                  <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} onKeyDown={(e) => e.key === "Enter" && unlockVault()} className="input" autoFocus />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={rememberSession} onChange={(e) => setRememberSession(e.target.checked)} />
                  Stay unlocked for this browser session
                </label>
                {error && <div className="text-xs text-danger" style={{ color: "var(--danger)" }}>{error}</div>}
                <button onClick={unlockVault} disabled={initializing || !passphrase} className="btn btn-primary w-full">
                  {initializing ? (
                    <>
                      <span className="loader"></span> Decrypting...
                    </>
                  ) : (
                    <>
                      <Icon name="Unlock" size={13} /> Unlock Vault
                    </>
                  )}
                </button>
                {canWipe ? (
                  <button onClick={() => setConfirmWipe(true)} className="text-xs text-danger hover:underline w-full text-center" style={{ color: "var(--danger)" }}>
                    Forgot passphrase? Reset vault (deletes all credentials)
                  </button>
                ) : (
                  <div className="text-xs text-ink-faint text-center">Forgot the passphrase? Ask an organization admin to reset the vault.</div>
                )}
              </div>
            </div>
          )}
        </div>
        {wipeDialog}
      </div>
    );
  }

  // Unlocked view — provider list on left, credentials on right
  const providerCount = Object.keys(vault).length;
  const totalCreds = Object.values(vault).reduce((s, p) => s + Object.keys(p).length, 0);
  // prototype v3: the vault covers the private payers (PRIVATE_PAYERS), not Medicare/state Medicaid/TRICARE/VA
  const payerList = (payers.data || []).filter(isPrivatePayer);
  const selected = providers.data?.find((p) => p.id === selectedProvider);
  const editingPayer = editingCred ? payerList.find((p) => p.id === editingCred.payerId) : null;

  return (
    <div>
      <PageHeader
        title="Payer Credential Vault"
        subtitle={providerCount + " provider(s) · " + totalCreds + " credential(s) stored"}
        actions={
          <button onClick={lockVault} className="btn btn-secondary">
            <Icon name="Lock" size={13} /> Lock Vault
          </button>
        }
      />

      {/* Status bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Providers" value={providerCount} sub="With stored creds" icon="Users" color="var(--accent)" />
        <StatCard label="Credentials" value={totalCreds} sub="Across all payers" icon="KeyRound" color="var(--info)" />
        <StatCard label="Payers Supported" value={payers.loading ? "…" : payerList.length} sub="Private insurance" icon="Building2" color="var(--success)" />
        <StatCard label="Encryption" value="AES-256" sub="GCM · session-unlocked" icon="ShieldCheck" color="var(--ink)" />
      </div>

      {/* Provider selector */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="p-3 border-b border-line">
            <h3 className="font-semibold text-sm text-ink">Providers</h3>
          </div>
          <div className="p-2" style={{ maxHeight: 500, overflowY: "auto" }}>
            {providers.error ? (
              <div className="text-xs p-2" style={{ color: "var(--danger)" }}>
                {providers.error}{" "}
                <button className="text-accent hover:underline" onClick={providers.reload}>
                  Retry
                </button>
              </div>
            ) : providers.loading ? (
              <Loading />
            ) : (providers.data || []).length === 0 ? (
              <div className="text-xs text-ink-faint p-2">No providers yet</div>
            ) : (
              (providers.data || []).map((p) => {
                const provVault = vault[p.id] || {};
                const credCount = Object.keys(provVault).length;
                const isSelected = selectedProvider === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProvider(p.id)}
                    className="w-full text-left p-2 rounded-lg mb-1 flex items-center gap-2 transition-colors"
                    style={{ background: isSelected ? "var(--accent-soft)" : "transparent" }}
                  >
                    <Avatar name={providerName(p)} size={28} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{providerName(p)}</div>
                      <div className="text-[10px] text-ink-light">
                        {credCount}/{payerList.length} payers
                      </div>
                    </div>
                    {credCount > 0 && <Pill type="success">{credCount}</Pill>}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="md:col-span-3">
          {selectedProvider && selected ? (
            <div className="card">
              <div className="p-4 border-b border-line">
                <h3 className="font-display font-semibold text-ink">Credentials for {providerName(selected)}</h3>
                <p className="text-xs text-ink-light mt-1">Portal login credentials for each private payer</p>
              </div>
              <div className="p-2">
                {payers.error && <ErrorState message={payers.error} onRetry={payers.reload} />}
                {payerList.map((payer) => {
                  const cred = vault[selectedProvider]?.[payer.id];
                  const key = selectedProvider + "_" + payer.id;
                  const isPwVisible = showPasswords[key];
                  return (
                    <div
                      key={payer.id}
                      className="p-3 rounded-lg mb-2 flex items-center gap-3 flex-wrap sm:flex-nowrap"
                      style={{ background: cred ? "var(--bg-soft)" : "transparent", border: "1px solid var(--border)" }}
                    >
                      <div className="w-2 h-10 rounded" style={{ background: payer.color }}></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-medium text-sm">{payer.name}</span>
                          {payer.payerType && <Pill type="neutral">{payer.payerType}</Pill>}
                          {cred ? <Pill type="success">Saved</Pill> : <Pill type="neutral">No credential</Pill>}
                        </div>
                        {cred ? (
                          <div className="flex items-center gap-3 text-xs flex-wrap">
                            <div>
                              <span className="text-ink-light">User:</span> <span className="font-mono">{cred.username}</span>
                            </div>
                            <div>
                              <span className="text-ink-light">Pass:</span>{" "}
                              <span className="font-mono">{isPwVisible ? cred.password : "•".repeat(Math.min(cred.password?.length || 8, 12))}</span>
                              <button
                                onClick={() => setShowPasswords({ ...showPasswords, [key]: !isPwVisible })}
                                className="ml-1 text-ink-light hover:text-accent"
                                aria-label={isPwVisible ? "Hide password" : "Show password"}
                              >
                                <Icon name={isPwVisible ? "EyeOff" : "Eye"} size={11} />
                              </button>
                            </div>
                            <button
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(cred.password);
                                  toast("Password copied");
                                } catch {
                                  toast("Clipboard unavailable", "error");
                                }
                              }}
                              className="text-ink-light hover:text-accent"
                              aria-label="Copy password"
                            >
                              <Icon name="Copy" size={11} />
                            </button>
                            <span className="text-ink-faint text-[10px]">Updated {fmtDate(cred.updated?.slice(0, 10))}</span>
                          </div>
                        ) : (
                          <div className="text-xs text-ink-faint">Not yet configured</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {cred && payer.portalUrl && (
                          <a href={payer.portalUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary text-xs" title="Open portal">
                            <Icon name="ExternalLink" size={11} />
                          </a>
                        )}
                        <button onClick={() => setEditingCred({ providerId: selectedProvider, payerId: payer.id, existing: cred || null })} className="btn btn-primary text-xs">
                          {cred ? (
                            <>
                              <Icon name="Edit" size={11} /> Edit
                            </>
                          ) : (
                            <>
                              <Icon name="Plus" size={11} /> Add
                            </>
                          )}
                        </button>
                        {cred && (
                          <button onClick={() => setDeleting({ providerId: selectedProvider, payerId: payer.id, payerName: payer.name })} className="btn-ghost p-1 hover:text-danger" title="Delete">
                            <Icon name="Trash2" size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="card card-pad text-center" style={{ padding: 60 }}>
              <Icon name="MousePointer2" size={32} className="mx-auto text-ink-faint mb-3" />
              <div className="font-medium text-ink">Select a provider from the list</div>
              <div className="text-xs text-ink-light mt-1">Choose a provider to manage their payer portal credentials</div>
            </div>
          )}
        </div>
      </div>

      {editingCred && editingPayer && (
        <CredentialEditModal
          payer={editingPayer}
          existing={editingCred.existing}
          onSave={(cred) => upsertCredential(editingCred.providerId, editingCred.payerId, cred)}
          onClose={() => setEditingCred(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete credential"
          message={"Delete the " + deleting.payerName + " credential from the vault?"}
          busy={deleteBusy}
          onConfirm={deleteCredential}
          onClose={() => setDeleting(null)}
        />
      )}
      {wipeDialog}
    </div>
  );
}
