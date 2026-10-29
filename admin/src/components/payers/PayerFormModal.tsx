"use client";

import { Select } from "@/components/Select";

import { useMasterList, withCurrent } from "@/lib/masterLists";
import { useRef, useState } from "react";
import { Field } from "@/components/Field";
import { PhoneInput } from "@/components/PhoneInput";
import { EMAIL_RE, PHONE_RE, phoneDigits } from "@/lib/validation";
import { Icon } from "@/components/Icon";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { PayerLogo } from "@/components/payers/PayerLogo";
import { PasswordInput } from "@/components/PasswordInput";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useToast } from "@/stores/toast";
import type { Payer } from "@/types/enrollments";

export const INTEGRATIONS: { value: string; label: string }[] = [
  { value: "caqh", label: "CAQH" },
  { value: "availity", label: "Availity" },
  { value: "pecos", label: "PECOS" },
  { value: "portal", label: "Portal" },
];
export const integrationLabel = (v: string) => INTEGRATIONS.find((i) => i.value === v)?.label || v;
export const MAX_IMAGE_BYTES = 500 * 1024;

interface PayerForm {
  name: string;
  fullName: string;
  category: string;
  avgTatDays: string;
  integration: string;
  appForm: string;
  portalAvailable: boolean;
  portalUrl: string;
  logo: string;
  caqhUpdate: string;
  supportEmail: string;
  supportPhone: string;
  apiAccess: boolean;
  apiKey: string;
  apiToken: string;
}

const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

/**
 * Add / Edit Payer popup. mode "platform": the super admin's Payers page. mode "org": an organization admin adds a
 * payer of their own (always portal-available; a payer that already exists but is switched off for the
 * organization can be enabled instead).
 */
export function PayerFormModal({ payer, mode = "platform", onClose, onSaved }: { payer: Payer | null; mode?: "platform" | "org"; onClose: () => void; onSaved: () => void }) {
  const categoryOptions = useMasterList("payer_category");
  const org = mode === "org";
  const [enableAsk, setEnableAsk] = useState<{ payerId: number; name: string } | null>(null);
  const [enabling, setEnabling] = useState(false);
  const toast = useToast();
  const [form, setForm] = useState<PayerForm>({
    name: payer?.name || "",
    fullName: payer?.fullName || "",
    category: payer?.category || "",
    avgTatDays: payer?.avgTatDays != null ? String(payer.avgTatDays) : "",
    integration: payer?.integration || "",
    appForm: payer?.appForm || "",
    portalAvailable: payer ? payer.portalAvailable : false,
    portalUrl: payer?.portalUrl || "",
    logo: payer?.logo || "",
    caqhUpdate: payer?.caqhUpdate || "",
    supportEmail: payer?.supportEmail || "",
    supportPhone: phoneDigits(payer?.supportPhone),
    apiAccess: !!payer?.apiAvailable,
    apiKey: "",
    apiToken: "",
  });
  const keySaved = !!payer?.hasApiKey, tokenSaved = !!payer?.hasApiToken;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof PayerForm>(k: K, v: PayerForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: "" } : e));
  };
  // Master Data → Payer Category (the payer's current category stays selectable)
  const categories = withCurrent(categoryOptions, form.category).map((o) => o.value);

  const pickImage = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return setErrors((e) => ({ ...e, logo: "Choose a PNG, JPG, WEBP or SVG image" }));
    if (file.size > MAX_IMAGE_BYTES) return setErrors((e) => ({ ...e, logo: "The image must be 500 KB or smaller" }));
    const reader = new FileReader();
    reader.onload = () => set("logo", String(reader.result || ""));
    reader.readAsDataURL(file);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Payer name is required";
    if (!form.fullName.trim()) e.fullName = "Insurance company name is required";
    if (!form.category) e.category = "Payer category is required";
    if (form.supportEmail.trim() && !EMAIL_RE.test(form.supportEmail.trim())) e.supportEmail = "Enter a valid email address";
    if (form.supportPhone && !PHONE_RE.test(form.supportPhone)) e.supportPhone = "Ph.No must be 10 digits";
    const tat = Number(form.avgTatDays);
    if (form.avgTatDays && (!Number.isInteger(tat) || tat < 1 || tat > 365)) e.avgTatDays = "1-365 days";
    // the portal login URL is asked only when the payer has a portal
    const url = form.portalUrl.trim();
    if (form.portalAvailable && !url) e.portalUrl = "Portal login URL is required when a portal is available";
    else if (form.portalAvailable && !URL_RE.test(url)) e.portalUrl = "Enter a full address starting with https://";
    // API access: key and token required (a saved one may stay blank on edit)
    if (form.apiAccess && !form.apiKey.trim() && !keySaved) e.apiKey = "API key is required";
    if (form.apiAccess && !form.apiToken.trim() && !tokenSaved) e.apiToken = "API token is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setBusy(true);
    const body = {
      name: form.name.trim(),
      fullName: form.fullName.trim(),
      category: form.category,
      avgTatDays: form.avgTatDays ? Number(form.avgTatDays) : null,
      integration: form.integration,
      appForm: form.appForm.trim(),
      portalAvailable: form.portalAvailable,
      portalUrl: form.portalAvailable ? form.portalUrl.trim() || null : null,
      logo: form.logo || null,
      apiAccess: form.apiAccess,
      apiKey: form.apiAccess ? form.apiKey.trim() || null : null,
      apiToken: form.apiAccess ? form.apiToken.trim() || null : null,
      caqhUpdate: form.caqhUpdate.trim() || null,
      supportEmail: form.supportEmail.trim() || null,
      supportPhone: form.supportPhone || null,
    };
    try {
      if (org) {
        const res = await api.post<{ status: "created" | "exists_disabled"; payerId: number; name: string }>("/payers/org-add", body);
        if (res.status === "exists_disabled") {
          setEnableAsk({ payerId: res.payerId, name: res.name });
          return;
        }
        toast("Payer added");
        onSaved();
        return;
      }
      if (payer) await api.put("/platform/payers/" + payer.id, body);
      else await api.post("/platform/payers", body);
      toast(payer ? "Payer updated" : "Payer added");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  // "already exists — enable it?" replaces the form popup
  if (enableAsk) {
    return (
      <ConfirmDialog
        title="Payer already exists"
        message={
          <>
            <strong>{enableAsk.name}</strong> already exists but is not enabled for your organization. Do you want to enable it?
          </>
        }
        confirmLabel="Yes, enable"
        cancelLabel="No"
        danger={false}
        busy={enabling}
        onConfirm={async () => {
          setEnabling(true);
          try {
            await api.post("/payers/" + enableAsk.payerId + "/org-enable");
            toast(enableAsk.name + " is now enabled for your organization");
            setEnableAsk(null);
            onSaved();
          } catch (e) {
            toast(errorMessage(e), "error");
          } finally {
            setEnabling(false);
          }
        }}
        onClose={() => setEnableAsk(null)}
      />
    );
  }

  return (
    <Modal title={payer ? "Edit Payer" : "Add Payer"} onClose={busy ? undefined : onClose} maxWidth={620}>
      <div className="space-y-3">
        <Field label="Payer Image" error={errors.logo} hint="Optional — without an image the payer name's letters are shown.">
          <div className="flex items-center gap-3">
            <PayerLogo name={form.name || "?"} color={payer?.color} logo={form.logo} size={56} />
            <button type="button" onClick={() => fileRef.current?.click()} className="btn btn-secondary" disabled={busy}>
              <Icon name="Upload" size={13} /> {form.logo ? "Change image" : "Choose image"}
            </button>
            {form.logo && (
              <button type="button" onClick={() => set("logo", "")} className="btn btn-ghost text-xs" disabled={busy}>
                Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                pickImage(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Payer Name" required error={errors.name}>
            <input value={form.name} onChange={(e) => set("name", e.target.value.replace(/^\s+/, ""))} className={"input" + (errors.name ? " input-error" : "")} maxLength={120} placeholder="e.g. BCBS TX" />
          </Field>
          <Field label="Payer Category" required error={errors.category}>
            <Select value={form.category} onChange={(e) => set("category", e.target.value)} className={"input" + (errors.category ? " input-error" : "")}>
              <option value="">— Select category —</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Insurance Company Name" required error={errors.fullName}>
            <input value={form.fullName} onChange={(e) => set("fullName", e.target.value.replace(/^\s+/, ""))} className={"input" + (errors.fullName ? " input-error" : "")} maxLength={200} placeholder="e.g. Blue Cross Blue Shield of Texas" />
          </Field>
          <Field label="CAQH Update" error={errors.caqhUpdate}>
            <input value={form.caqhUpdate} onChange={(e) => set("caqhUpdate", e.target.value.replace(/^\s+/, ""))} className="input" maxLength={255} />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Avg TAT (days)" error={errors.avgTatDays}>
            <input value={form.avgTatDays} onChange={(e) => set("avgTatDays", e.target.value.replace(/\D/g, "").slice(0, 3))} className={"input font-mono" + (errors.avgTatDays ? " input-error" : "")} inputMode="numeric" placeholder="e.g. 49" />
          </Field>
          <Field label="Integration" error={errors.integration}>
            <Select value={form.integration} onChange={(e) => set("integration", e.target.value)} className={"input" + (errors.integration ? " input-error" : "")}>
              <option value="">— Select integration —</option>
              {INTEGRATIONS.map((i) => (
                <option key={i.value} value={i.value}>{i.label}</option>
              ))}
            </Select>
          </Field>
        </div>
        {/* the payer's support contacts: the Email / Call buttons of Payer Submission */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Support Email" error={errors.supportEmail}>
            <input type="email" value={form.supportEmail} onChange={(e) => set("supportEmail", e.target.value.trim())} className={"input" + (errors.supportEmail ? " input-error" : "")} maxLength={255} aria-label="Support Email" />
          </Field>
          <Field label="Support Phone" error={errors.supportPhone}>
            <PhoneInput value={form.supportPhone} onChange={(v) => set("supportPhone", v)} invalid={!!errors.supportPhone} placeholder="" />
          </Field>
        </div>
        <Field label="Form" error={errors.appForm}>
          <input value={form.appForm} onChange={(e) => set("appForm", e.target.value.replace(/^\s+/, ""))} className={"input" + (errors.appForm ? " input-error" : "")} maxLength={150} placeholder="e.g. Ambetter Provider Set-up Form" />
        </Field>
        {/* last: the portal login URL is asked only when the payer has a portal */}
        {/* Is portal available → Portal Login URL; API access → API key and token */}
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={form.portalAvailable}
            onChange={(e) => {
              set("portalAvailable", e.target.checked);
              if (!e.target.checked) setErrors((er) => ({ ...er, portalUrl: "" }));
            }}
          />
          Is portal available
        </label>
        {form.portalAvailable && (
          <Field label="Portal Login URL" required error={errors.portalUrl}>
            <input
              value={form.portalUrl}
              onChange={(e) => set("portalUrl", e.target.value.replace(/\s/g, ""))}
              className={"input font-mono" + (errors.portalUrl ? " input-error" : "")}
              maxLength={500}
              placeholder="https://provider.payer.com/login"
              inputMode="url"
              autoComplete="off"
              autoFocus
            />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={form.apiAccess}
            onChange={(e) => {
              set("apiAccess", e.target.checked);
              if (!e.target.checked) setErrors((er) => ({ ...er, apiKey: "", apiToken: "" }));
            }}
          />
          API access
        </label>
        {form.apiAccess && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="API Key" required={!keySaved} error={errors.apiKey} hint={keySaved ? "Saved — leave blank to keep it" : undefined}>
              <PasswordInput value={form.apiKey} onChange={(e) => set("apiKey", e.target.value.trim())} className={"input font-mono" + (errors.apiKey ? " input-error" : "")} maxLength={2000} autoComplete="off" placeholder={keySaved ? "••••••••" : "API key"} />
            </Field>
            <Field label="API Token" required={!tokenSaved} error={errors.apiToken} hint={tokenSaved ? "Saved — leave blank to keep it" : undefined}>
              <PasswordInput value={form.apiToken} onChange={(e) => set("apiToken", e.target.value.trim())} className={"input font-mono" + (errors.apiToken ? " input-error" : "")} maxLength={4000} autoComplete="off" placeholder={tokenSaved ? "••••••••" : "API token"} />
            </Field>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={save} className="btn btn-primary" disabled={busy}>
            {busy ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Save" size={13} />} {payer ? "Update" : "Add Payer"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

