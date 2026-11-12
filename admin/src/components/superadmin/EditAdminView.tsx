"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/Select";
import { CitySelect, StateSelect } from "@/components/AddressFields";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { PasswordInput } from "@/components/PasswordInput";
import { PhoneInput } from "@/components/PhoneInput";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAsync, useDebounced } from "@/lib/hooks";
import { useMasterList, withCurrent } from "@/lib/masterLists";
import { cardExpProblem, phoneDigits, PHONE_RE } from "@/lib/validation";
import { useToast } from "@/stores/toast";
import { detectCardBrand, EMAIL_RE, loadPackages, overCap, type Package } from "@/types/signup";
import { Breadcrumbs } from "./Breadcrumbs";

/** GET /platform/admins/{userId} */
interface AdminDetail {
  userId: number;
  orgId: number;
  orgName: string;
  orgType: string | null;
  taxId: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  packageId: string | null;
  estimatedProviders: number | null;
  cardBrand: string | null;
  cardLast4: string | null;
  cardExp: string | null;
  billingName: string | null;
  billingZip: string | null;
}

interface Form {
  orgName: string; orgType: string; taxId: string; website: string; address: string; city: string; state: string; zip: string;
  firstName: string; lastName: string; email: string; phone: string; password: string; confirmPassword: string;
  packageId: string; estimatedProviders: string;
  cardNumber: string; cardExp: string; cardName: string; cardZip: string;
}
type Errors = Partial<Record<keyof Form | "form", string>>;

// server field-error keys → form keys
const SERVER_KEYS: Record<string, keyof Form> = {
  "org.name": "orgName", "org.type": "orgType", "org.taxId": "taxId", "org.website": "website", "org.address": "address",
  "org.city": "city", "org.state": "state", "org.zip": "zip",
  "admin.firstName": "firstName", "admin.lastName": "lastName", "admin.email": "email", "admin.phone": "phone", "admin.password": "password",
  "plan.packageId": "packageId", "plan.estimatedProviders": "estimatedProviders",
  "paymentMethod.brand": "cardNumber", "paymentMethod.last4": "cardNumber", "paymentMethod.exp": "cardExp",
  "paymentMethod.billingName": "cardName", "paymentMethod.billingZip": "cardZip",
};

const toForm = (a: AdminDetail): Form => ({
  orgName: a.orgName || "", orgType: a.orgType || "", taxId: a.taxId || "", website: a.website || "", address: a.address || "",
  city: a.city || "", state: a.state || "", zip: a.zip || "",
  firstName: a.firstName || "", lastName: a.lastName || "", email: a.email || "", phone: phoneDigits(a.phone), password: "", confirmPassword: "",
  packageId: a.packageId || "", estimatedProviders: a.estimatedProviders != null ? String(a.estimatedProviders) : "1",
  cardNumber: "", cardExp: a.cardExp || "", cardName: a.billingName || "", cardZip: a.billingZip || "",
});

/**
 * Super admin → Create Admin → Edit: every detail entered when the admin was created — organization, admin account
 * (a new password only when typed), plan and card (a new card number only when it changes).
 */
export function EditAdminView({ userId, onDone }: { userId: number; onDone: () => void }) {
  const toast = useToast();
  const detail = useAsync<AdminDetail>(() => api.get<AdminDetail>("/platform/admins/" + userId), [userId]);
  const packages = useAsync<Package[]>(loadPackages, []);
  const orgTypes = useMasterList("org_type");
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  // the form starts from the saved details (render-time adjustment once they arrive)
  const [seen, setSeen] = useState<AdminDetail | undefined>(undefined);
  if (detail.data && detail.data !== seen) {
    setSeen(detail.data);
    setForm(toForm(detail.data));
  }
  const nameTaken = useOrgNameCheck(form?.orgName || "", detail.data?.orgId ?? null, !!form && form.orgName.trim() !== (detail.data?.orgName || "").trim());

  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!detail.data || !form) return <Loading />;
  const a = detail.data;
  const pkgList = packages.data || [];
  const selectedPkg = pkgList.find((p) => p.id === form.packageId || p.code === form.packageId);

  const set = (k: keyof Form, v: string) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
  };

  const validate = (): Errors => {
    const e: Errors = {};
    if (!form.orgName.trim()) e.orgName = "Organization name is required";
    else if (nameTaken) e.orgName = nameTaken;
    if (!/^\d{9}$/.test(form.taxId)) e.taxId = form.taxId ? "Tax ID must be 9 digits" : "Tax ID is required";
    if (!form.city.trim()) e.city = "City is required";
    if (!/^\d{5}$/.test(form.zip)) e.zip = form.zip ? "ZIP must be 5 digits" : "ZIP is required";
    if (!form.firstName.trim()) e.firstName = "First name is required";
    if (!form.lastName.trim()) e.lastName = "Last name is required";
    if (!form.email.trim()) e.email = "Email is required";
    else if (!EMAIL_RE.test(form.email.trim())) e.email = "Enter a valid email address";
    if (!form.phone) e.phone = "Ph.No is required";
    else if (!PHONE_RE.test(form.phone)) e.phone = "Ph.No must be 10 digits";
    // the password is changed only when a new one is typed
    if (form.password || form.confirmPassword) {
      if (form.password.length < 8) e.password = "Password must be at least 8 characters";
      if (form.password !== form.confirmPassword) e.confirmPassword = "Passwords don't match";
    }
    const n = Number(form.estimatedProviders);
    if (!selectedPkg) e.packageId = "Choose a plan";
    if (!Number.isInteger(n) || n < 1) e.estimatedProviders = "Whole number, at least 1";
    else if (selectedPkg && overCap(selectedPkg, n)) e.packageId = selectedPkg.name + " supports up to " + selectedPkg.providerCap + " providers";
    const digits = form.cardNumber.replace(/\D/g, "");
    if (digits && digits.length < 13) e.cardNumber = "Enter a valid card number";
    if (!digits && !a.cardLast4) e.cardNumber = "Card number is required";
    const expProblem = cardExpProblem(form.cardExp);
    if (expProblem) e.cardExp = expProblem;
    if (!form.cardName.trim()) e.cardName = "Name on card is required";
    if (!/^\d{5}$/.test(form.cardZip)) e.cardZip = form.cardZip ? "Billing ZIP must be 5 digits" : "Billing ZIP is required";
    return e;
  };

  const save = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      setTimeout(() => document.querySelector(".field-error")?.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return;
    }
    setBusy(true);
    const digits = form.cardNumber.replace(/\D/g, "");
    try {
      await api.put("/platform/admins/" + userId, {
        org: {
          name: form.orgName.trim(), type: form.orgType || null, taxId: form.taxId, website: form.website.trim(), address: form.address.trim(),
          city: form.city, state: form.state || null, zip: form.zip,
        },
        admin: { firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(), phone: form.phone, password: form.password },
        plan: { packageId: selectedPkg!.id, estimatedProviders: Number(form.estimatedProviders) },
        // the full card number never leaves the browser: only its brand and last 4 (when a new card was entered)
        paymentMethod: {
          brand: digits ? detectCardBrand(digits) : "",
          last4: digits ? digits.slice(-4) : "",
          exp: form.cardExp,
          billingName: form.cardName.trim(),
          billingZip: form.cardZip,
        },
      });
      toast("Admin updated · " + form.firstName.trim() + " " + form.lastName.trim());
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        const mapped: Errors = {};
        Object.entries(err.fieldErrors).forEach(([k, v]) => {
          const key = SERVER_KEYS[k];
          if (key) mapped[key] = v;
        });
        if (!Object.keys(mapped).length) mapped.form = errorMessage(err);
        setErrors(mapped);
      } else setErrors({ form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const section = (title: string, icon: string) => (
    <div className="flex items-center gap-2 text-sm font-semibold text-ink mb-3 pt-1">
      <Icon name={icon} size={15} className="text-accent" /> {title}
    </div>
  );

  return (
    <div>
      <Breadcrumbs items={[{ label: "Create Admin", href: "/create-admin" }, { label: "Edit " + a.firstName + " " + a.lastName }]} />
      <PageHeader
        title="Edit Admin"
        subtitle={a.firstName + " " + a.lastName + " — " + a.orgName}
        actions={
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={onDone} disabled={busy}>
              <Icon name="ArrowLeft" size={13} /> Back to admins
            </button>
            <button className="btn btn-primary" onClick={save} disabled={busy} data-save-admin>
              {busy ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Save" size={13} />} Save Changes
            </button>
          </div>
        }
      />
      {errors.form && (
        <div className="mb-4 px-3 py-2 rounded-lg flex items-center gap-2" style={{ background: "var(--danger-soft)", color: "#991b1b", fontSize: 13 }} data-form-error>
          <Icon name="AlertCircle" size={14} /> {errors.form}
        </div>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4" data-edit-admin>
        <div className="card card-pad">
          {section("Organization", "Building2")}
          <div className="space-y-3">
            <Field label="Organization Name *" error={errors.orgName || nameTaken}>
              <input value={form.orgName} onChange={(e) => set("orgName", e.target.value.slice(0, 200))} className={"input" + (errors.orgName || nameTaken ? " input-error" : "")} aria-label="Organization Name" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Organization Type" error={errors.orgType}>
                <Select value={form.orgType} onChange={(e) => set("orgType", e.target.value)} className="input" aria-label="Organization Type">
                  <option value="">— Select —</option>
                  {withCurrent(orgTypes, form.orgType).map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Tax ID (EIN) *" error={errors.taxId}>
                <input value={form.taxId} onChange={(e) => set("taxId", e.target.value.replace(/\D/g, "").slice(0, 9))} className={"input font-mono" + (errors.taxId ? " input-error" : "")} inputMode="numeric" aria-label="Tax ID" />
              </Field>
            </div>
            <Field label="Website" error={errors.website}>
              <input value={form.website} onChange={(e) => set("website", e.target.value.slice(0, 255))} className="input" aria-label="Website" />
            </Field>
            <Field label="Address" error={errors.address}>
              <input value={form.address} onChange={(e) => set("address", e.target.value.slice(0, 255))} className="input" aria-label="Address" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="State" error={errors.state}>
                <StateSelect
                  value={form.state}
                  onChange={(v) => {
                    if (v !== form.state) set("city", "");
                    set("state", v);
                  }}
                />
              </Field>
              <Field label="City *" error={errors.city}>
                <CitySelect state={form.state} value={form.city} onChange={(v) => set("city", v)} invalid={!!errors.city} />
              </Field>
              <Field label="ZIP *" error={errors.zip}>
                <input value={form.zip} onChange={(e) => set("zip", e.target.value.replace(/\D/g, "").slice(0, 5))} className={"input font-mono" + (errors.zip ? " input-error" : "")} inputMode="numeric" aria-label="ZIP" />
              </Field>
            </div>
          </div>
        </div>

        <div className="card card-pad">
          {section("Admin Account", "UserCog")}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="First Name *" error={errors.firstName}>
                <input value={form.firstName} onChange={(e) => set("firstName", e.target.value.slice(0, 100))} className={"input" + (errors.firstName ? " input-error" : "")} aria-label="First Name" />
              </Field>
              <Field label="Last Name *" error={errors.lastName}>
                <input value={form.lastName} onChange={(e) => set("lastName", e.target.value.slice(0, 100))} className={"input" + (errors.lastName ? " input-error" : "")} aria-label="Last Name" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Email *" error={errors.email} hint="The admin signs in with this email">
                <input type="email" value={form.email} onChange={(e) => set("email", e.target.value.slice(0, 255))} className={"input" + (errors.email ? " input-error" : "")} aria-label="Email" />
              </Field>
              <Field label="Ph.No *" error={errors.phone}>
                <PhoneInput value={form.phone} onChange={(v) => set("phone", v)} invalid={!!errors.phone} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="New Password" error={errors.password} hint="Leave blank to keep the current password">
                <PasswordInput value={form.password} onChange={(e) => set("password", e.target.value)} className={"input" + (errors.password ? " input-error" : "")} autoComplete="new-password" aria-label="New Password" />
              </Field>
              <Field label="Confirm New Password" error={errors.confirmPassword}>
                <PasswordInput value={form.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)} className={"input" + (errors.confirmPassword ? " input-error" : "")} autoComplete="new-password" aria-label="Confirm New Password" />
              </Field>
            </div>
          </div>
        </div>

        <div className="card card-pad">
          {section("Plan", "Package")}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Plan *" error={errors.packageId || packages.error || undefined}>
              <Select value={selectedPkg?.id || ""} onChange={(e) => set("packageId", e.target.value)} className={"input" + (errors.packageId ? " input-error" : "")} disabled={packages.loading} aria-label="Plan">
                <option value="">{packages.loading ? "Loading plans…" : "— Select a plan —"}</option>
                {pkgList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.providerCap != null && p.providerCap > 0 ? " (up to " + p.providerCap + " providers)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Estimated Providers *" error={errors.estimatedProviders}>
              <input value={form.estimatedProviders} onChange={(e) => set("estimatedProviders", e.target.value.replace(/\D/g, "").slice(0, 6))} className={"input" + (errors.estimatedProviders ? " input-error" : "")} inputMode="numeric" aria-label="Estimated Providers" />
            </Field>
          </div>
        </div>

        <div className="card card-pad">
          {section("Payment", "CreditCard")}
          <div className="space-y-3">
            {a.cardLast4 && (
              <div className="text-xs text-ink-light" data-card-on-file>
                Card on file: <span className="font-medium text-ink">{a.cardBrand || "Card"} •••• {a.cardLast4}</span>
              </div>
            )}
            <Field label={a.cardLast4 ? "New Card Number" : "Card Number *"} error={errors.cardNumber} hint={a.cardLast4 ? "Leave blank to keep the card on file" : undefined}>
              <input
                value={form.cardNumber}
                onChange={(e) => set("cardNumber", e.target.value.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})/g, "$1 ").trim())}
                className={"input font-mono" + (errors.cardNumber ? " input-error" : "")}
                placeholder="Enter Card Number"
                inputMode="numeric"
                autoComplete="off"
                aria-label="Card Number"
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Exp (MM/YY) *" error={errors.cardExp}>
                <input
                  value={form.cardExp}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                    set("cardExp", v.length <= 2 ? v : v.slice(0, 2) + "/" + v.slice(2));
                  }}
                  className={"input font-mono" + (errors.cardExp ? " input-error" : "")}
                  placeholder="Enter Exp (MM/YY)"
                  inputMode="numeric"
                  aria-label="Card Expiry"
                />
              </Field>
              <Field label="Name on Card *" error={errors.cardName}>
                <input value={form.cardName} onChange={(e) => set("cardName", e.target.value.slice(0, 120))} className={"input" + (errors.cardName ? " input-error" : "")} aria-label="Name on Card" />
              </Field>
              <Field label="Billing ZIP *" error={errors.cardZip}>
                <input value={form.cardZip} onChange={(e) => set("cardZip", e.target.value.replace(/\D/g, "").slice(0, 5))} className={"input font-mono" + (errors.cardZip ? " input-error" : "")} inputMode="numeric" aria-label="Billing ZIP" />
              </Field>
            </div>
            <div className="text-[10px] text-ink-faint">Only the card brand, last 4 digits, expiry and billing details are saved — the full card number never leaves your browser.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "" when the organization name is free for this organization (or unchanged / not checked yet). */
function useOrgNameCheck(name: string, orgId: number | null, enabled: boolean): string {
  const value = name.trim().replace(/\s+/g, " ");
  const debounced = useDebounced(value, 400);
  const [result, setResult] = useState<{ name: string; message: string }>({ name: "", message: "" });
  useEffect(() => {
    if (!enabled || !debounced) return;
    let cancelled = false;
    api
      .get<{ available: boolean; message: string | null }>("/email-check/org-name", { name: debounced, id: orgId ?? undefined })
      .then((r) => {
        if (!cancelled) setResult({ name: debounced, message: r.available ? "" : r.message || "This organization name is already in use" });
      })
      .catch(() => {
        /* the save reports it */
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, enabled, orgId]);
  return enabled && value && result.name === value ? result.message : "";
}
