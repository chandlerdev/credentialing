"use client";

import { useRef, useState } from "react";
import { AccessDenied } from "@/components/AlertBox";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { PasswordInput } from "@/components/PasswordInput";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { fmtDate, fmtTsZone, todayISO } from "@/lib/utils";
import { useUser } from "@/stores/auth";
import { useToast } from "@/stores/toast";

interface StorageSettings {
  enabled: boolean;
  authMethod: "certificate" | "secret";
  tenantId: string | null;
  clientId: string | null;
  clientSecretSet: boolean;
  secretExpires: string | null;
  certificateSet: boolean;
  certThumbprint: string | null;
  certSubject: string | null;
  certExpires: string | null;
  siteUrl: string | null;
  library: string | null;
  folder: string | null;
  folderUrl: string | null;
  connected: boolean;
  lastUploadAt: string | null;
  lastUploadName: string | null;
  lastUploadOk: boolean | null;
  lastUploadError: string | null;
}

const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const hex = (t: string) => t.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();

/** Super admin → Storage: keep uploaded documents in OneDrive / SharePoint instead of the server. */
export function StorageView() {
  const user = useUser();
  const toast = useToast();
  const allowed = user.role === "platform_admin";
  const q = useAsync<StorageSettings>(allowed ? () => api.get("/storage/settings") : null, [allowed]);
  if (!allowed) return <AccessDenied action="manage" entity="storage settings" role={user.role} />;
  return (
    <div>
      <PageHeader title="Storage" subtitle="Where uploaded documents are kept: OneDrive / SharePoint (Microsoft 365) or this server." />
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !q.data ? <Loading /> : <StorageForm initial={q.data} onSaved={q.setData} onReload={q.reload} toast={toast} />}
    </div>
  );
}

function StorageForm({ initial: s, onSaved, onReload, toast }: { initial: StorageSettings; onSaved: (s: StorageSettings) => void; onReload: () => void; toast: ReturnType<typeof useToast> }) {
  const [f, setF] = useState({
    enabled: s.enabled,
    authMethod: s.authMethod,
    tenantId: s.tenantId || "",
    clientId: s.clientId || "",
    clientSecret: "",
    secretExpires: s.secretExpires || "",
    certThumbprint: s.certThumbprint || "",
    certPassword: "",
    siteUrl: s.siteUrl || "",
    library: s.library || "Documents",
    folder: s.folder || "",
  });
  const [certFile, setCertFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "test" | "cert" | null>(null);
  const set = (k: keyof typeof f, v: string | boolean) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((x) => ({ ...x, [k]: "" }));
  };
  const cert = f.authMethod === "certificate";

  const uploadCert = async () => {
    const e: Record<string, string> = {};
    if (!certFile) e.certificate = "Choose the certificate file (.pfx or .pem)";
    if (f.certThumbprint && hex(f.certThumbprint).length !== 40) e.certThumbprint = "The thumbprint is 40 characters (0-9, A-F)";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy("cert");
    try {
      const fd = new FormData();
      fd.append("file", certFile!);
      if (f.certPassword) fd.append("password", f.certPassword);
      if (f.certThumbprint) fd.append("thumbprint", f.certThumbprint);
      const next = await api.upload<StorageSettings>("/storage/certificate", fd);
      onSaved(next);
      setF((x) => ({ ...x, certPassword: "", certThumbprint: next.certThumbprint || x.certThumbprint }));
      setCertFile(null);
      if (fileRef.current) fileRef.current.value = "";
      toast("Certificate saved — thumbprint " + next.certThumbprint);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (f.tenantId && !GUID.test(f.tenantId.trim()) && !/\.onmicrosoft\.com$/i.test(f.tenantId.trim())) e.tenantId = "Tenant ID is a GUID like 1a2b3c4d-1234-5678-9abc-1234567890ab";
    if (f.clientId && !GUID.test(f.clientId.trim())) e.clientId = "Client ID is a GUID like 1a2b3c4d-1234-5678-9abc-1234567890ab";
    if (f.siteUrl && !/^https?:\/\/.+/i.test(f.siteUrl.trim())) e.siteUrl = "Enter the site address, e.g. https://yourcompany.sharepoint.com/sites/Credentialing";
    if (/["*:<>?\\|#%]/.test(f.folder)) e.folder = "A folder name can't contain \" * : < > ? \\ | # %";
    if (f.enabled) {
      if (!f.tenantId.trim()) e.tenantId = "Tenant ID is required";
      if (!f.clientId.trim()) e.clientId = "Client ID is required";
      if (cert && !s.certificateSet) e.certificate = "Upload the certificate first";
      if (!cert && !f.clientSecret.trim() && !s.clientSecretSet) e.clientSecret = "Client secret is required";
      if (!f.siteUrl.trim()) e.siteUrl = "SharePoint site address is required";
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy("save");
    try {
      const next = await api.put<StorageSettings>("/storage/settings", {
        enabled: f.enabled,
        authMethod: f.authMethod,
        tenantId: f.tenantId.trim() || null,
        clientId: f.clientId.trim() || null,
        clientSecret: cert ? null : f.clientSecret.trim() || null,
        secretExpires: cert ? null : f.secretExpires || null,
        certThumbprint: cert ? f.certThumbprint || null : null,
        siteUrl: f.siteUrl.trim() || null,
        library: f.library.trim() || null,
        folder: f.folder.trim() || null,
      });
      setF((x) => ({ ...x, clientSecret: "", folder: next.folder || x.folder }));
      onSaved(next);
      toast(next.enabled ? "OneDrive storage is on — checked with Microsoft, the folder is ready" : "Storage settings saved (documents stay on the server)");
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    setBusy("test");
    try {
      onSaved(await api.post<StorageSettings>("/storage/settings/test"));
      toast("Connection OK — a test file was written to the folder and removed");
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  };
  const expiry = cert ? s.certExpires : s.secretExpires;
  const expiringSoon = expiry && expiry <= addDays(todayISO(), 30);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="card card-pad lg:col-span-2 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Icon name="Cloud" size={18} style={{ color: "var(--accent)" }} />
            <h3 className="font-display font-semibold">OneDrive / SharePoint</h3>
            <span
              className="text-[11px] font-semibold rounded-full px-2 py-0.5"
              style={s.enabled && s.connected ? { background: "var(--success-soft)", color: "#047857" } : { background: "var(--bg-soft)", color: "var(--ink-light)" }}
              data-storage-status
            >
              {s.enabled && s.connected ? "On — new uploads go to OneDrive" : "Off — documents are stored on the server"}
            </span>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={f.enabled} onChange={(e) => set("enabled", e.target.checked)} style={{ width: 16, height: 16 }} aria-label="Store documents in OneDrive" />
            Store documents in OneDrive
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Tenant ID" required={f.enabled} error={errors.tenantId}>
            <input value={f.tenantId} onChange={(e) => set("tenantId", e.target.value.trim())} className={"input font-mono" + (errors.tenantId ? " input-error" : "")} autoComplete="off" aria-label="Tenant ID" />
          </Field>
          <Field label="Client ID (Application ID)" required={f.enabled} error={errors.clientId}>
            <input value={f.clientId} onChange={(e) => set("clientId", e.target.value.trim())} className={"input font-mono" + (errors.clientId ? " input-error" : "")} autoComplete="off" aria-label="Client ID" />
          </Field>
        </div>

        <div>
          <div className="label mb-1">Sign-in with</div>
          <div className="flex gap-4 text-sm flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="auth" checked={cert} onChange={() => set("authMethod", "certificate")} aria-label="Sign in with a certificate" /> Certificate
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="auth" checked={!cert} onChange={() => set("authMethod", "secret")} aria-label="Sign in with a client secret" /> Client secret
            </label>
          </div>
        </div>

        {cert ? (
          <div className="rounded-lg border border-line p-3 space-y-3" data-cert-section>
            {s.certificateSet ? (
              <div className="text-xs space-y-0.5" data-cert-saved>
                <div className="flex items-center gap-1.5 font-semibold" style={{ color: "#047857" }}>
                  <Icon name="ShieldCheck" size={13} /> Certificate saved
                </div>
                <div>
                  Thumbprint: <span className="font-mono">{s.certThumbprint}</span>
                </div>
                <div className="text-ink-light break-all">{s.certSubject}</div>
                <div className="text-ink-light">Expires {fmtDate(s.certExpires)}</div>
              </div>
            ) : (
              <div className="text-xs text-ink-light">Upload the certificate whose thumbprint is on the app registration (Entra ID → Certificates &amp; secrets → Certificates).</div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Certificate thumbprint" error={errors.certThumbprint} className="sm:col-span-2">
                <input value={f.certThumbprint} onChange={(e) => set("certThumbprint", e.target.value.trim())} className={"input font-mono" + (errors.certThumbprint ? " input-error" : "")} autoComplete="off" aria-label="Certificate thumbprint" />
              </Field>
              <Field label={s.certificateSet ? "Replace the certificate (.pfx or .pem)" : "Certificate file (.pfx or .pem)"} required={f.enabled && !s.certificateSet} error={errors.certificate}>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pfx,.p12,.pem,.key,.crt,.cer"
                  onChange={(e) => {
                    setCertFile(e.target.files?.[0] || null);
                    setErrors((x) => ({ ...x, certificate: "" }));
                  }}
                  className="input"
                  aria-label="Certificate file"
                />
              </Field>
              <Field label="Certificate password (.pfx)" error={errors.certificatePassword}>
                <PasswordInput value={f.certPassword} onChange={(e) => set("certPassword", e.target.value)} className={"input" + (errors.certificatePassword ? " input-error" : "")} autoComplete="new-password" aria-label="Certificate password" />
              </Field>
            </div>
            <div className="flex justify-end">
              <button className="btn btn-secondary text-xs" onClick={uploadCert} disabled={busy !== null || !certFile}>
                {busy === "cert" ? <span className="loader" /> : <Icon name="Upload" size={12} />} Upload certificate
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-secret-section>
            <Field label="Client secret (Value)" required={f.enabled && !s.clientSecretSet} error={errors.clientSecret}>
              <PasswordInput value={f.clientSecret} onChange={(e) => set("clientSecret", e.target.value.trim())} className={"input font-mono" + (errors.clientSecret ? " input-error" : "")} autoComplete="new-password" placeholder={s.clientSecretSet ? "•••••••• (saved — leave blank to keep)" : ""} aria-label="Client secret" />
            </Field>
            <Field label="Secret expires on" error={errors.secretExpires}>
              <input type="date" value={f.secretExpires} onChange={(e) => set("secretExpires", e.target.value)} className="input" aria-label="Secret expires on" />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="SharePoint site address" required={f.enabled} error={errors.siteUrl} className="sm:col-span-2">
            <input value={f.siteUrl} onChange={(e) => set("siteUrl", e.target.value.trim())} className={"input" + (errors.siteUrl ? " input-error" : "")} autoComplete="off" aria-label="SharePoint site address" />
          </Field>
          <Field label="Document library" error={errors.library}>
            <input value={f.library} onChange={(e) => set("library", e.target.value)} className={"input" + (errors.library ? " input-error" : "")} aria-label="Document library" />
          </Field>
          <Field label="Folder (created automatically)" error={errors.folder}>
            <input value={f.folder} onChange={(e) => set("folder", e.target.value)} className={"input" + (errors.folder ? " input-error" : "")} aria-label="Folder" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-line flex-wrap">
          {(s.clientSecretSet || s.certificateSet) && s.siteUrl && (
            <button className="btn btn-secondary" onClick={test} disabled={busy !== null}>
              {busy === "test" ? <span className="loader" /> : <Icon name="PlugZap" size={13} />} Test connection
            </button>
          )}
          <button className="btn btn-primary" onClick={save} disabled={busy !== null}>
            {busy === "save" ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Save" size={13} />} {f.enabled ? "Save and check with Microsoft" : "Save"}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="card card-pad text-sm space-y-2" data-storage-last>
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold">Last upload</h3>
            <button className="btn btn-ghost text-xs" onClick={onReload} title="Refresh">
              <Icon name="RefreshCw" size={12} />
            </button>
          </div>
          {!s.lastUploadAt ? (
            <p className="text-xs text-ink-faint">No document uploaded to OneDrive yet.</p>
          ) : (
            <>
              <span
                className="text-[11px] font-semibold rounded-full px-2 py-0.5 inline-block"
                style={s.lastUploadOk ? { background: "var(--success-soft)", color: "#047857" } : { background: "#fee2e2", color: "#b91c1c" }}
                data-last-ok={s.lastUploadOk ? "yes" : "no"}
              >
                {s.lastUploadOk ? "Saved to OneDrive" : "Not saved to OneDrive"}
              </span>
              <div className="text-xs break-all" data-last-name>{s.lastUploadName}</div>
              <div className="text-[11px] text-ink-faint">{fmtTsZone(s.lastUploadAt)}</div>
              {s.lastUploadError && <div className="text-xs" style={{ color: "#b91c1c" }}>{s.lastUploadError}</div>}
            </>
          )}
          {s.folderUrl && (
            <a href={s.folderUrl} target="_blank" rel="noreferrer" className="text-xs inline-flex items-center gap-1" style={{ color: "var(--accent-strong)" }}>
              <Icon name="ExternalLink" size={11} /> Open the folder in SharePoint
            </a>
          )}
          {expiry && (
            <p className="text-xs" style={{ color: expiringSoon ? "#b91c1c" : "var(--ink-light)" }}>
              {cert ? "Certificate" : "Client secret"} expires {fmtDate(expiry)}
              {expiringSoon ? " — renew it in Entra ID and upload / save it here" : ""}
            </p>
          )}
        </div>
        <div className="card card-pad text-sm space-y-2">
          <h3 className="font-display font-semibold">Where to find these</h3>
          <ul className="text-xs text-ink-light list-disc pl-4 space-y-1">
            <li><strong>Tenant ID</strong>: Azure portal → Microsoft Entra ID → Overview.</li>
            <li><strong>Client ID</strong>: Entra ID → App registrations → your app → Overview.</li>
            <li><strong>Certificate</strong>: the app → Certificates &amp; secrets → Certificates shows the thumbprint. Upload the matching .pfx (with its password) or a .pem with the private key — the .cer alone can&apos;t sign in.</li>
            <li><strong>Permission</strong>: Microsoft Graph → Application → Sites.Selected (write access to the site) or Sites.ReadWrite.All, with admin consent.</li>
            <li><strong>Folder</strong>: filled in for this site; it and every sub-folder are created automatically.</li>
          </ul>
          <p className="text-xs text-ink-light">
            Files are filed as Folder / Organization / Providers / Name (NPI) / Documents, Additional Documents or Enrollments / Payer. Documents already on the server stay there and keep working. If OneDrive refuses an upload, the file is kept on the server and the reason shows above.
          </p>
        </div>
      </div>
    </div>
  );
}

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
