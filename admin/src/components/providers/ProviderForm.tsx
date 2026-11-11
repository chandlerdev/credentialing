"use client";

import { Select } from "@/components/Select";
import { StateSelect } from "@/components/AddressFields";

import { useState, type ReactNode } from "react";
import { PhoneInput } from "@/components/PhoneInput";
import { useEmailCheck } from "@/lib/useEmailCheck";
import { todayISO } from "@/lib/utils";
import { PasswordInput } from "@/components/PasswordInput";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { ApiError, errorMessage } from "@/lib/api";
import { useToast } from "@/stores/toast";
import { PHONE_RE, phoneDigits } from "@/lib/validation";
import { EMAIL_RE, NPI_RE, PROVIDER_STATUS_OPTIONS, type OrgStructure } from "@/components/providers/shared";
import type { ProviderExtraView, ProviderStatus } from "@/types/providers";
import {
  BillingSection,
  FormSection,
  GroupRow,
  HomeAddressBlock,
  IdsRow,
  OTHER,
  PecosPasswordField,
  PersonalRow,
  PracticeSection,
  SpecialtyField,
  SuffixSelect,
  extraFieldErrors,
  extraFromView,
  extraPayload,
  extraProblems,
  specialtyValue,
  type ExtraForm,
} from "./ProviderExtraFields";

/** Starting values of the provider form (an existing provider, a CAQH profile, or blanks). */
export interface ProviderFormValues {
  firstName?: string | null;
  lastName?: string | null;
  suffix?: string | null;
  npi?: string | null;
  specialty?: string | null;
  email?: string | null;
  phone?: string | null;
  licenseNumber?: string | null;
  licenseState?: string | null;
  licenseExpires?: string | null;
  dateOfBirth?: string | null;
  deaNumber?: string | null;
  deaExpires?: string | null;
  caqhId?: string | null;
  caqhUsername?: string | null;
  caqhPassword?: string | null;
  pecosAccessGranted?: boolean | null;
  pecosUsername?: string | null;
  status?: string | null;
  practiceId?: number | null;
  locationId?: number | null;
  taxonomyCode?: string | null;
  /** more provider details (group, IDs, home / practice / billing) */
  extra?: ProviderExtraView | null;
}

/** What the form sends (the body of POST /providers, PUT /providers/{id} and the CAQH import "details"). */
export interface ProviderFormPayload {
  firstName: string;
  lastName: string;
  suffix: string;
  npi: string | null;
  specialty: string;
  email: string;
  phone: string;
  licenseNumber: string;
  licenseState: string;
  licenseExpires: string | null;
  dateOfBirth?: string | null;
  deaNumber?: string;
  deaExpires?: string | null;
  caqhId: string;
  caqhUsername: string;
  /** omitted when editing and left blank (keeps the stored password) */
  caqhPassword?: string;
  pecosAccessGranted: boolean;
  pecosUsername?: string;
  status: ProviderStatus;
  practiceId: number | null;
  locationId: number | null;
  /** withLogin: the provider's sign-in password (their email is the username) */
  password?: string;
  /** Edit Provider → Change Password: a new sign-in password (only when one was typed) */
  newPassword?: string;
  /** more provider details (all optional) */
  extra: ReturnType<typeof extraPayload>;
}

const LOCKED_HINT = "Set by your credentialing team";

const idStr = (v: number | null | undefined) => (v == null ? "" : String(v));
const num = (v: string) => (v ? Number(v) : null);

/**
 * The one provider form used everywhere a provider is added or edited (Add Provider Manually, Organization →
 * Add Provider, Import from CAQH, Edit Provider): the same fields and sections as the provider's secure-link form.
 * Prototype ProviderEditModal (L14614) layout.
 */
export function ProviderForm({
  org,
  initial,
  hasStoredPassword = false,
  providerId,
  withLogin = false,
  changePassword,
  lockCaqhId = false,
  lockPlacement = false,
  selfService = false,
  submitLabel,
  submitIcon = "Save",
  onSubmit,
  onCancel,
  cancelLabel = "Cancel",
  top,
}: {
  org: OrgStructure;
  initial: ProviderFormValues;
  /** editing a provider that already has a CAQH password: the field may stay blank */
  hasStoredPassword?: boolean;
  /** editing: the provider's id (its own email is not a duplicate) */
  providerId?: number;
  /** adding a provider: also ask for a sign-in password (the provider signs in with their email) */
  withLogin?: boolean;
  /** editing a provider: an optional Change Password field; hasLogin = the provider already has a sign-in */
  changePassword?: { hasLogin: boolean };
  /** CAQH import: the CAQH ID comes from the lookup and can't change */
  lockCaqhId?: boolean;
  /** Organization screen: the practice / location are fixed */
  lockPlacement?: boolean;
  /** the provider's own Manage Profile: email (their sign-in), NPI, status and the organization are not changed here */
  selfService?: boolean;
  submitLabel: string;
  submitIcon?: string;
  onSubmit: (payload: ProviderFormPayload) => Promise<void>;
  onCancel: () => void;
  cancelLabel?: string;
  top?: ReactNode;
}) {
  const toast = useToast();
  const { practices, locations } = org;

  // Derive the practice from the location when it is missing.
  const initialLoc = locations.find((l) => l.id === initial.locationId);
  const initialPracticeId = initial.practiceId ?? initialLoc?.practiceId ?? null;

  const [form, setForm] = useState({
    firstName: initial.firstName || "",
    lastName: initial.lastName || "",
    suffix: initial.suffix || "MD",
    npi: (initial.npi || "").replace(/\D/g, "").slice(0, 10),
    specialty: initial.specialty === "Other" ? OTHER : initial.specialty || "",
    specialtyOther: "",
    email: initial.email || "",
    phone: phoneDigits(initial.phone),
    license: initial.licenseNumber || "",
    licenseState: initial.licenseState || "TX",
    licenseExpires: initial.licenseExpires || "",
    dateOfBirth: initial.dateOfBirth || "",
    deaNumber: initial.deaNumber || "",
    deaExpires: initial.deaExpires || "",
    caqhId: initial.caqhId || "",
    caqhUsername: initial.caqhUsername || "",
    caqhPassword: initial.caqhPassword || "",
    pecosAccess: initial.pecosAccessGranted == null ? "" : initial.pecosAccessGranted ? "yes" : "no",
    pecosUsername: initial.pecosUsername || "",
    status: (initial.status || "draft") as string,
    practiceId: idStr(initialPracticeId),
    locationId: idStr(initial.locationId),
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<ExtraForm>(() => extraFromView(initial.extra, initial.taxonomyCode));
  const setX = (k: keyof ExtraForm, v: string) => {
    setExtra((x) => ({ ...x, [k]: v }));
    setErrors((er) => (er[k] ? { ...er, [k]: "" } : er));
  };
  const [busy, setBusy] = useState(false);
  const emailTaken = useEmailCheck(form.email, { kind: "provider", id: providerId }, !selfService);
  // Typing in a field clears its message.
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((er) => (er[k] ? { ...er, [k]: "" } : er));
  };

  // Cascading: the organization's practices, then the locations of the chosen practice
  const availablePractices = practices;
  const availableLocations = form.practiceId ? locations.filter((l) => String(l.practiceId) === form.practiceId) : [];

  const handlePracticeChange = (practiceId: string) => {
    setForm((f) => ({ ...f, practiceId, locationId: "" }));
    setErrors((er) => ({ ...er, practiceId: "" }));
  };
  const handleLocationChange = (locationId: string) => {
    const loc = locations.find((l) => String(l.id) === locationId);
    const practice = loc ? practices.find((p) => p.id === loc.practiceId) : null;
    setForm((f) => ({ ...f, locationId, practiceId: practice ? String(practice.id) : f.practiceId }));
    setErrors((er) => ({ ...er, locationId: "", practiceId: "" }));
  };

  // the provider's own Manage Profile marks its required details; staff need only the name, email and password
  const star = (label: string) => (selfService ? label + " *" : label);

  const validate = () => {
    const e: Record<string, string> = {};
    const req = (k: string, v: string) => {
      if (!v.trim()) e[k] = "Required";
    };
    if (withLogin) {
      if (!form.password) e.password = "Required";
      else if (form.password.length < 8) e.password = "At least 8 characters";
      if (!form.confirmPassword) e.confirmPassword = "Required";
      else if (form.confirmPassword !== form.password) e.confirmPassword = "Passwords do not match";
    }
    // Change Password is optional: checked only when something was typed
    if (changePassword && form.password && form.password.length < 8) e.password = "At least 8 characters";
    // Staff adding / editing a provider: only the name, the email (the sign-in) and the password are required; the
    // provider's own Manage Profile keeps its required details. Formats are checked whenever something is entered.
    const strict = selfService;
    req("firstName", form.firstName);
    req("lastName", form.lastName);
    if (strict) req("suffix", form.suffix);
    if (!form.npi) {
      if (strict) e.npi = "Required";
    } else if (!NPI_RE.test(form.npi)) e.npi = "10 digits required";
    // CAQH ID is optional; when entered it must be 6-10 digits
    if (form.caqhId && !/^[0-9]{6,10}$/.test(form.caqhId)) e.caqhId = "6-10 digits";
    if (strict) req("specialty", form.specialty);
    if (strict && form.specialty === OTHER && !form.specialtyOther.trim()) e.specialtyOther = "Required";
    if (!form.email.trim()) e.email = "Required";
    else if (!EMAIL_RE.test(form.email.trim())) e.email = "Valid email required";
    else if (emailTaken) e.email = emailTaken;
    if (!form.phone) {
      if (strict) e.phone = "Required";
    } else if (!PHONE_RE.test(form.phone)) e.phone = "Ph.No must be 10 digits";
    if (strict) {
      req("license", form.license);
      req("licenseState", form.licenseState);
      req("licenseExpires", form.licenseExpires);
    }
    // expiration dates can't be in the past (an unchanged date of an existing provider is left alone)
    if (form.licenseExpires && form.licenseExpires < todayISO() && form.licenseExpires !== (initial.licenseExpires || "")) e.licenseExpires = "Choose today or a later date";
    if (form.deaExpires && form.deaExpires < todayISO() && form.deaExpires !== (initial.deaExpires || "")) e.deaExpires = "Choose today or a later date";
    if (strict) req("status", form.status);
    Object.assign(e, extraProblems(extra));
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) {
      toast("Fill in all the required fields", "error");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        suffix: form.suffix,
        npi: form.npi || null,
        specialty: specialtyValue(form.specialty, form.specialtyOther),
        email: form.email.trim(),
        phone: form.phone,
        licenseNumber: form.license.trim(),
        licenseState: form.licenseState,
        licenseExpires: form.licenseExpires || null,
        dateOfBirth: form.dateOfBirth || null,
        deaNumber: form.deaNumber.trim(),
        deaExpires: form.deaExpires || null,
        caqhId: form.caqhId,
        caqhUsername: form.caqhUsername.trim(),
        caqhPassword: form.caqhPassword || undefined,
        pecosAccessGranted: form.pecosAccess === "yes",
        pecosUsername: form.pecosAccess === "yes" ? form.pecosUsername.trim() : undefined,
        status: form.status as ProviderStatus,
        practiceId: num(form.practiceId),
        locationId: num(form.locationId),
        ...(withLogin ? { password: form.password } : {}),
        ...(changePassword && form.password ? { newPassword: form.password } : {}),
        extra: extraPayload(extra),
      });
    } catch (err) {
      if (err instanceof ApiError) {
        const fe: Record<string, string> = {};
        // errors of the nested provider ("provider.npi" / "details.npi") belong to the same fields
        for (const [k, v] of Object.entries(extraFieldErrors(err.fieldErrors))) fe[k.replace(/^(provider|details)\./, "")] = v;
        if (fe.licenseNumber) fe.license = fe.licenseNumber;
        // a 409 without a field (duplicate NPI) is shown under NPI
        if (err.status === 409 && Object.keys(fe).length === 0) fe.npi = err.message;
        setErrors(fe);
      }
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const selectedLoc = form.locationId ? locations.find((l) => String(l.id) === form.locationId) : null;
  const err = (k: string) => errors[k];

  return (
    <div className="space-y-3">
      {top}
      {/* the same sections, fields and order as the provider's secure-link form */}
      <FormSection icon="User" title="Provider Details">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="First Name *" error={err("firstName")}>
            <input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} className="input" maxLength={80} />
          </Field>
          <Field label="Last Name *" error={err("lastName")}>
            <input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} className="input" maxLength={80} />
          </Field>
          <Field label={star("Suffix")} error={err("suffix")}>
            <SuffixSelect value={form.suffix} onChange={(v) => set("suffix", v)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={star("NPI")} error={err("npi")} hint={selfService ? LOCKED_HINT : undefined}>
            <input value={form.npi} onChange={(e) => set("npi", e.target.value.replace(/\D/g, "").slice(0, 10))} className="input font-mono" placeholder="10 digits" inputMode="numeric" disabled={selfService} />
          </Field>
          <SpecialtyField
            choice={form.specialty}
            other={form.specialtyOther}
            onChange={(c, o) => {
              setForm((f) => ({ ...f, specialty: c, specialtyOther: o }));
              setErrors((er) => ({ ...er, specialty: "", specialtyOther: "" }));
            }}
            error={err("specialty")}
            otherError={err("specialtyOther")}
            required={selfService}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Email *" error={err("email") || emailTaken} hint={selfService ? "Your sign-in — can't be changed here" : undefined}>
            <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="input" disabled={selfService} />
          </Field>
          <Field label={star("Ph.No")} error={err("phone")}>
            <PhoneInput value={form.phone} onChange={(v) => set("phone", v)} invalid={!!err("phone")} />
          </Field>
          <Field label="Date of Birth" error={err("dateOfBirth")}>
            <input type="date" max={todayISO()} value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} className="input" />
          </Field>
        </div>
        <GroupRow f={extra} set={setX} errors={errors} />
        <PersonalRow f={extra} set={setX} errors={errors} hasSsn={!!initial.extra?.hasSsn} ssnLast4={initial.extra?.ssnLast4} />
      </FormSection>
      <FormSection icon="Home" title="Home Address">
        <HomeAddressBlock f={extra} set={setX} errors={errors} />
      </FormSection>
      <FormSection icon="Award" title="License & IDs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={star("License Number")} error={err("license")}>
            <input value={form.license} onChange={(e) => set("license", e.target.value)} className="input font-mono" maxLength={40} />
          </Field>
          <Field label={star("License State")} error={err("licenseState")}>
            <StateSelect value={form.licenseState} onChange={(v) => set("licenseState", v)} ariaLabel="License State" invalid={!!err("licenseState")} />
          </Field>
          <Field label={star("License Expiration")} error={err("licenseExpires")}>
            <input type="date" min={todayISO()} value={form.licenseExpires} onChange={(e) => set("licenseExpires", e.target.value)} className="input" />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="DEA Number" error={err("deaNumber")}>
            <input value={form.deaNumber} onChange={(e) => set("deaNumber", e.target.value.toUpperCase())} className="input font-mono" maxLength={20} placeholder="(optional for mid-levels)" />
          </Field>
          <Field label="DEA Expiration" error={err("deaExpires")}>
            <input type="date" min={todayISO()} value={form.deaExpires} onChange={(e) => set("deaExpires", e.target.value)} className="input" />
          </Field>
        </div>
        <IdsRow f={extra} set={setX} errors={errors} />
      </FormSection>
      <FormSection icon="Database" title="CAQH">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="CAQH Number" error={err("caqhId")}>
            <input
              value={form.caqhId}
              onChange={(e) => set("caqhId", e.target.value.replace(/\D/g, "").slice(0, 10))}
              className="input font-mono"
              placeholder="8 digits"
              inputMode="numeric"
              disabled={lockCaqhId}
            />
          </Field>
          <Field label="CAQH User ID" error={err("caqhUsername")}>
            <input value={form.caqhUsername} onChange={(e) => set("caqhUsername", e.target.value.replace(/\s/g, ""))} className="input font-mono" maxLength={100} autoComplete="off" />
          </Field>
          <Field label="CAQH Password" error={err("caqhPassword")} hint={hasStoredPassword ? "Leave blank to keep the saved password" : undefined}>
            <PasswordInput
              value={form.caqhPassword}
              onChange={(e) => set("caqhPassword", e.target.value)}
              className="input font-mono"
              maxLength={200}
              autoComplete="new-password"
              placeholder={hasStoredPassword ? "••••••••" : ""}
            />
          </Field>
        </div>
      </FormSection>
      <FormSection icon="ShieldCheck" title="PECOS">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="PECOS Access Granted" error={err("pecosAccess")}>
            <Select
              value={form.pecosAccess}
              onChange={(e) => {
                set("pecosAccess", e.target.value);
                if (e.target.value !== "yes") {
                  setForm((f) => ({ ...f, pecosUsername: "" }));
                  setX("pecosPassword", "");
                }
              }}
              className="input"
              aria-label="PECOS Access Granted"
            >
              <option value="">— Select —</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </Field>
          <Field label="PECOS User Name" error={err("pecosUsername")}>
            <input
              value={form.pecosUsername}
              onChange={(e) => set("pecosUsername", e.target.value.replace(/\s/g, ""))}
              className="input font-mono"
              maxLength={100}
              disabled={form.pecosAccess !== "yes"}
              autoComplete="off"
            />
          </Field>
          <PecosPasswordField f={extra} set={setX} errors={errors} hasStored={!!initial.extra?.hasPecosPassword} disabled={form.pecosAccess !== "yes"} />
        </div>
      </FormSection>
      <PracticeSection f={extra} set={setX} errors={errors} />
      <BillingSection f={extra} set={setX} errors={errors} />
      <FormSection icon="KeyRound" title="Status & Sign-in">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={star("Status")} error={err("status")} hint={selfService ? LOCKED_HINT : undefined}>
            <Select value={form.status} onChange={(e) => set("status", e.target.value)} className="input" disabled={selfService}>
              {PROVIDER_STATUS_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </Select>
          </Field>
          {withLogin && (
            <>
              <Field label="Password *" error={err("password")} hint="Sign-in: the email + this password">
                <PasswordInput value={form.password} onChange={(e) => set("password", e.target.value)} className="input" autoComplete="new-password" placeholder="At least 8 characters" />
              </Field>
              <Field label="Confirm Password *" error={err("confirmPassword")}>
                <PasswordInput value={form.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)} className="input" autoComplete="new-password" />
              </Field>
            </>
          )}
          {changePassword && (
            <div className="sm:col-span-2">
              <Field
                label="Change Password"
                error={err("password")}
                hint={changePassword.hasLogin ? "Leave blank to keep the current password" : "No sign-in yet — a password lets the provider sign in with their email"}
              >
                <PasswordInput value={form.password} onChange={(e) => set("password", e.target.value)} className="input" autoComplete="new-password" placeholder="New password" />
              </Field>
            </div>
          )}
        </div>
      </FormSection>
      {!selfService && (
      <div className="pt-3 mt-3 border-t border-line">
        <div className="text-xs font-semibold text-ink mb-2 flex items-center gap-1.5">
          <Icon name="Building2" size={13} className="text-accent" />
          Assign to Organization
        </div>
        <div className="grid grid-cols-1 gap-3">
          <Field
            label={
              <>
                Practice {availablePractices.length === 0 && <span className="text-xs text-ink-faint">(no practices yet)</span>}
              </>
            }
            error={err("practiceId")}
          >
            <Select
              value={form.practiceId}
              onChange={(e) => handlePracticeChange(e.target.value)}
              className="input"
              disabled={lockPlacement || availablePractices.length === 0}
              style={errors.practiceId ? { borderColor: "var(--danger)" } : {}}
              aria-label="Practice"
            >
              <option value="">— Select a practice —</option>
              {availablePractices.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                  {pr.taxId ? " (TIN " + pr.taxId + ")" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={
              <>
                Location{" "}
                {form.practiceId && availableLocations.length === 0 && (
                  <span className="text-xs" style={{ color: "#a16207" }}>
                    ⚠ No locations under this practice. Add one from Organization → &quot;+ Add Practice / Location&quot;
                  </span>
                )}
              </>
            }
            error={err("locationId")}
          >
            <Select
              value={form.locationId}
              onChange={(e) => handleLocationChange(e.target.value)}
              className="input"
              disabled={lockPlacement || !form.practiceId || availableLocations.length === 0}
              style={errors.locationId ? { borderColor: "var(--danger)" } : {}}
              aria-label="Location"
            >
              <option value="">{form.practiceId ? "— Select a location —" : "Pick a practice first"}</option>
              {availableLocations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name} — {loc.address ? loc.address.split(",")[0] : ""}
                </option>
              ))}
            </Select>
          </Field>
          {selectedLoc && (
            <div className="p-2 rounded text-[11px]" style={{ background: "var(--bg-soft)" }}>
              <div className="flex items-center gap-1 text-ink-light">
                <Icon name="MapPin" size={10} />
                <span>{selectedLoc.legalName || "—"}</span>
                {selectedLoc.npi && <span className="font-mono">· NPI {selectedLoc.npi}</span>}
              </div>
              <div className="text-ink-faint mt-0.5">{[selectedLoc.address, selectedLoc.city, selectedLoc.state].filter(Boolean).join(", ")}</div>
            </div>
          )}
        </div>
      </div>
      )}
      <div className="flex justify-end gap-2 pt-3 border-t border-line">
        <button onClick={onCancel} className="btn btn-secondary" disabled={busy}>
          {cancelLabel}
        </button>
        <button onClick={submit} className="btn btn-primary" disabled={busy}>
          {busy ? <span className="loader" /> : <Icon name={submitIcon} size={13} />} {submitLabel}
        </button>
      </div>
    </div>
  );
}
