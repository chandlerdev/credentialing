"use client";

import { Select } from "@/components/Select";

import type { ReactNode } from "react";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { PasswordInput } from "@/components/PasswordInput";
import { PhoneInput } from "@/components/PhoneInput";
import { CitySelect, StateSelect } from "@/components/AddressFields";
import { useMasterList, withCurrent, type MasterOption } from "@/lib/masterLists";
import { todayISO } from "@/lib/utils";
import { EMAIL_RE, PHONE_RE, phoneDigits } from "@/lib/validation";
import type { ProviderExtraView } from "@/types/providers";

/**
 * More provider details on the provider forms (Add / Edit Provider and the secure-link form): group, IDs, SSN,
 * home / practice / billing details. Every field is optional.
 */
export interface ExtraForm {
  taxonomyCode: string;
  groupName: string;
  groupNpi: string;
  taxId: string;
  ssn: string;
  homeAddress: string;
  homeCity: string;
  homeState: string;
  homeZip: string;
  medicarePhone: string;
  medicaidNumber: string;
  medicarePtan: string;
  drivingLicense: string;
  pecosPassword: string;
  practiceLegalName: string;
  practiceDbaName: string;
  practiceOwnerName: string;
  practiceManagerName: string;
  practiceManagerContact: string;
  practiceAddress: string;
  practiceCity: string;
  practiceState: string;
  practiceZip: string;
  practicePhone: string;
  practiceFax: string;
  practiceEmail: string;
  practiceStartDate: string;
  officeHours: string;
  billingAddress: string;
  billingCity: string;
  billingState: string;
  billingZip: string;
  billingPhone: string;
  billingFax: string;
  billingEmail: string;
  billingContactPerson: string;
}

const PHONE_KEYS = ["medicarePhone", "practiceManagerContact", "practicePhone", "billingPhone"] as const;
/** fax numbers: 10 digits, no country code */
const FAX_KEYS = ["practiceFax", "billingFax"] as const;
const faxDigits = (v: string | null | undefined) => (v || "").replace(/^\+(1|91)\s?/, "").replace(/\D/g, "").slice(-10);

/** Form values from the stored details (blank when there are none). */
export function extraFromView(v?: ProviderExtraView | null, taxonomyCode?: string | null): ExtraForm {
  const s = (x: string | null | undefined) => x || "";
  const f: ExtraForm = {
    taxonomyCode: s(v?.taxonomyCode ?? taxonomyCode),
    groupName: s(v?.groupName),
    groupNpi: s(v?.groupNpi),
    taxId: s(v?.taxId),
    ssn: "",
    homeAddress: s(v?.homeAddress),
    homeCity: s(v?.homeCity),
    homeState: s(v?.homeState),
    homeZip: s(v?.homeZip),
    medicarePhone: s(v?.medicarePhone),
    medicaidNumber: s(v?.medicaidNumber),
    medicarePtan: s(v?.medicarePtan),
    drivingLicense: s(v?.drivingLicense),
    pecosPassword: "",
    practiceLegalName: s(v?.practiceLegalName),
    practiceDbaName: s(v?.practiceDbaName),
    practiceOwnerName: s(v?.practiceOwnerName),
    practiceManagerName: s(v?.practiceManagerName),
    practiceManagerContact: s(v?.practiceManagerContact),
    practiceAddress: s(v?.practiceAddress),
    practiceCity: s(v?.practiceCity),
    practiceState: s(v?.practiceState),
    practiceZip: s(v?.practiceZip),
    practicePhone: s(v?.practicePhone),
    practiceFax: s(v?.practiceFax),
    practiceEmail: s(v?.practiceEmail),
    practiceStartDate: s(v?.practiceStartDate),
    officeHours: s(v?.officeHours),
    billingAddress: s(v?.billingAddress),
    billingCity: s(v?.billingCity),
    billingState: s(v?.billingState),
    billingZip: s(v?.billingZip),
    billingPhone: s(v?.billingPhone),
    billingFax: s(v?.billingFax),
    billingEmail: s(v?.billingEmail),
    billingContactPerson: s(v?.billingContactPerson),
  };
  for (const k of PHONE_KEYS) f[k] = f[k] ? phoneDigits(f[k]) : "";
  for (const k of FAX_KEYS) f[k] = faxDigits(f[k]);
  return f;
}

/** A phone field with no digits typed is empty (the country code alone is not a number). */
const phoneOut = (v: string) => (v.replace(/^\+(1|91)\s?/, "").replace(/\D/g, "") ? v : "");

/** What the forms send as `extra` (SSN / PECOS password only when typed: blank keeps the stored ones). */
export function extraPayload(f: ExtraForm) {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(f) as [keyof ExtraForm, string][]) {
    if (k === "ssn" || k === "pecosPassword") continue;
    out[k] = (PHONE_KEYS as readonly string[]).includes(k) ? phoneOut(v) : v.trim();
  }
  out.practiceStartDate = f.practiceStartDate || null;
  if (f.ssn.trim()) out.ssn = f.ssn.trim();
  if (f.pecosPassword) out.pecosPassword = f.pecosPassword;
  return out;
}

const ZIP = /^\d{5}(-?\d{4})?$/;

/** Problems of the optional fields (only checked when something was entered). */
export function extraProblems(f: ExtraForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.groupNpi && !/^\d{10}$/.test(f.groupNpi)) e.groupNpi = "Group NPI must be 10 digits";
  if (f.taxId && !/^\d{2}-?\d{7}$/.test(f.taxId)) e.taxId = "Tax ID must be 9 digits";
  if (f.ssn && !/^\d{3}-?\d{2}-?\d{4}$/.test(f.ssn)) e.ssn = "SSN must be 9 digits";
  for (const k of ["homeZip", "practiceZip", "billingZip"] as const) if (f[k] && !ZIP.test(f[k])) e[k] = "ZIP must be 5 or 9 digits";
  for (const k of ["practiceEmail", "billingEmail"] as const) if (f[k].trim() && !EMAIL_RE.test(f[k].trim())) e[k] = "Enter a valid email address";
  for (const k of PHONE_KEYS) if (phoneOut(f[k]) && !PHONE_RE.test(f[k])) e[k] = "Must be 10 digits";
  for (const k of FAX_KEYS) if (f[k] && !/^\d{10}$/.test(f[k])) e[k] = "Fax number must be 10 digits";
  if (f.practiceStartDate && f.practiceStartDate > todayISO()) e.practiceStartDate = "Can't be a future date";
  return e;
}

/** Server errors of the block come back as "extra.<field>". */
export function extraFieldErrors(fe: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fe)) out[k.replace(/^(provider\.|details\.)?extra\./, "")] = v;
  return out;
}

type Set = (k: keyof ExtraForm, v: string) => void;
interface SectionProps {
  f: ExtraForm;
  set: Set;
  errors: Record<string, string>;
  /** the secure-link page: State / City lists come from the public endpoint */
  publicToken?: string | null;
}

/** A heading between the groups of fields. */
export function FormSection({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="pt-3 mt-1 border-t border-line first:border-t-0 first:pt-0 first:mt-0">
      <div className="text-xs font-semibold text-ink mb-2 flex items-center gap-1.5 uppercase tracking-wide">
        <Icon name={icon} size={13} className="text-accent" />
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Text({ f, set, errors, k, label, max = 100, mono, placeholder, digits }: SectionProps & { k: keyof ExtraForm; label: string; max?: number; mono?: boolean; placeholder?: string; digits?: number }) {
  return (
    <Field label={label} error={errors[k]}>
      <input
        value={f[k]}
        onChange={(e) => set(k, digits ? e.target.value.replace((FAX_KEYS as readonly string[]).includes(k) ? /\D/g : /[^\d-]/g, "").slice(0, digits) : e.target.value)}
        className={"input" + (mono ? " font-mono" : "")}
        maxLength={max}
        placeholder={placeholder}
        inputMode={digits ? "numeric" : undefined}
        autoComplete="off"
      />
    </Field>
  );
}

function Phone({ f, set, errors, k, label }: SectionProps & { k: keyof ExtraForm; label: string }) {
  return (
    <Field label={label} error={errors[k]}>
      <PhoneInput value={f[k]} onChange={(v) => set(k, v)} invalid={!!errors[k]} />
    </Field>
  );
}

/** Street, then State / City (the cities of the state) / ZIP. */
function Address({ f, set, errors, prefix, publicToken }: SectionProps & { prefix: "home" | "practice" | "billing" }) {
  const k = (s: string) => (prefix + s) as keyof ExtraForm;
  return (
    <>
      <Text f={f} set={set} errors={errors} k={k("Address")} label="Street Address" max={255} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="State" error={errors[k("State")]}>
          <StateSelect
            value={f[k("State")]}
            onChange={(v) => {
              set(k("State"), v);
              // another state: its own cities
              if (v !== f[k("State")]) set(k("City"), "");
            }}
            publicToken={publicToken}
          />
        </Field>
        <Field label="City" error={errors[k("City")]}>
          <CitySelect state={f[k("State")]} value={f[k("City")]} onChange={(v) => set(k("City"), v)} publicToken={publicToken} />
        </Field>
        <Text f={f} set={set} errors={errors} k={k("Zip")} label="ZIP" max={10} mono digits={10} placeholder="5 or 9 digits" />
      </div>
    </>
  );
}

/** Provider section: Group Name / Group NPI / Tax ID. */
export function GroupRow(p: SectionProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Text {...p} k="groupName" label="Group Name" max={200} />
      <Text {...p} k="groupNpi" label="Group NPI" mono digits={10} placeholder="10 digits" />
      <Text {...p} k="taxId" label="Tax ID" mono digits={10} placeholder="9 digits" />
    </div>
  );
}

/** Provider section: Taxonomy Code / SSN / Ph.No listed in Medicare. */
export function PersonalRow({ hasSsn, ssnLast4, ...p }: SectionProps & { hasSsn?: boolean; ssnLast4?: string | null }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Text {...p} k="taxonomyCode" label="Taxonomy Code" max={20} mono />
      <Field label="SSN" error={p.errors.ssn} hint={hasSsn ? "Saved (•••-••-" + (ssnLast4 || "••••") + ") — leave blank to keep it" : undefined}>
        <PasswordInput
          value={p.f.ssn}
          onChange={(e) => p.set("ssn", e.target.value.replace(/[^\d-]/g, "").slice(0, 11))}
          className="input font-mono"
          autoComplete="off"
          placeholder={hasSsn ? "•••-••-" + (ssnLast4 || "••••") : "9 digits"}
        />
      </Field>
      <Phone {...p} k="medicarePhone" label="Ph.No Listed in Medicare" />
    </div>
  );
}

/** Home address of the provider. */
export function HomeAddressBlock(p: SectionProps) {
  return <Address {...p} prefix="home" />;
}

/** License & IDs section: Driving License / Medicaid Number / Medicare PTAN. */
export function IdsRow(p: SectionProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Text {...p} k="drivingLicense" label="Driving License" max={40} mono />
      <Text {...p} k="medicaidNumber" label="Medicaid Number" max={40} mono />
      <Text {...p} k="medicarePtan" label="Medicare PTAN" max={40} mono />
    </div>
  );
}

/** PECOS section: the PECOS password (stored encrypted; blank keeps it). */
export function PecosPasswordField({ hasStored, disabled, ...p }: SectionProps & { hasStored?: boolean; disabled?: boolean }) {
  return (
    <Field label="PECOS Password" error={p.errors.pecosPassword} hint={hasStored ? "Leave blank to keep the saved password" : undefined}>
      <PasswordInput
        value={p.f.pecosPassword}
        onChange={(e) => p.set("pecosPassword", e.target.value)}
        className="input font-mono"
        maxLength={200}
        autoComplete="new-password"
        placeholder={hasStored ? "••••••••" : ""}
        disabled={disabled}
      />
    </Field>
  );
}

/** Practice Information section. */
export function PracticeSection(p: SectionProps) {
  return (
    <FormSection icon="Building" title="Practice Information">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Text {...p} k="practiceLegalName" label="Practice Legal Name" max={200} />
        <Text {...p} k="practiceDbaName" label="Practice DBA Name" max={200} />
        <Text {...p} k="practiceOwnerName" label="Practice Owner Name" max={150} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Text {...p} k="practiceManagerName" label="Practice Manager / Administrator Name" max={150} />
        <Phone {...p} k="practiceManagerContact" label="Manager / Administrator Contact" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Phone {...p} k="practicePhone" label="Practice Ph.No" />
        <Text {...p} k="practiceFax" label="Practice Fax Number" max={10} mono digits={10} placeholder="10 digits" />
        <Text {...p} k="practiceEmail" label="Practice Email" max={255} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Date Started Practice at This Address" error={p.errors.practiceStartDate}>
          <input type="date" max={todayISO()} value={p.f.practiceStartDate} onChange={(e) => p.set("practiceStartDate", e.target.value)} className="input" />
        </Field>
        <Text {...p} k="officeHours" label="Office Hours" max={255} placeholder="e.g. Mon–Fri 8:00 AM – 5:00 PM" />
      </div>
      <Address {...p} prefix="practice" />
    </FormSection>
  );
}

/** Billing Information section. */
export function BillingSection(p: SectionProps) {
  return (
    <FormSection icon="Receipt" title="Billing Information">
      <Text {...p} k="billingContactPerson" label="Billing Contact Person" max={150} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Phone {...p} k="billingPhone" label="Billing Ph.No" />
        <Text {...p} k="billingFax" label="Billing Fax Number" max={10} mono digits={10} placeholder="10 digits" />
        <Text {...p} k="billingEmail" label="Billing Email" max={255} />
      </div>
      <Address {...p} prefix="billing" />
    </FormSection>
  );
}

// ---------- Specialty: Master Data list + "Other" ----------

export const OTHER = "__other__";

/** Specialty select value + "Other" text from a stored specialty (not in the list → Other with that text). */
export function specialtyParts(stored: string | null | undefined, options: MasterOption[]) {
  if (!stored) return { choice: "", other: "" };
  if (stored === "Other") return { choice: OTHER, other: "" };
  return options.some((o) => o.value === stored) ? { choice: stored, other: "" } : { choice: OTHER, other: stored };
}

/** The specialty to save. */
export const specialtyValue = (choice: string, other: string) => (choice === OTHER ? other.trim() : choice);

/**
 * A dropdown whose list is exactly as wide as the field (long names are cut with "…" and shown in full on hover);
 * the browser's own select list can grow wider than the field.
 */
export function OptionSelect({
  value,
  options,
  onChange,
  placeholder = "— Select —",
  ariaLabel,
  invalid,
}: {
  value: string;
  options: MasterOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel: string;
  invalid?: boolean;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={"input" + (invalid ? " input-error" : "")} aria-label={ariaLabel}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </Select>
  );
}

/** Specialty dropdown (Master Data) with "Other" last; Other opens a text box in the next column. */
export function SpecialtyField({
  choice,
  other,
  onChange,
  error,
  otherError,
  publicToken,
  required = true,
}: {
  choice: string;
  other: string;
  onChange: (choice: string, other: string) => void;
  error?: string;
  otherError?: string;
  /** the secure-link page reads the public list */
  publicToken?: string | null;
  /** false: Specialty (and Other Specialty) can be left empty */
  required?: boolean;
}) {
  const options = useMasterList("specialty", publicToken !== undefined ? { publicToken } : undefined);
  const list = [...withCurrent(options, choice && choice !== OTHER ? choice : null), { value: OTHER, label: "Other" }];
  return (
    <>
      <Field label={required ? "Specialty *" : "Specialty"} error={error}>
        <OptionSelect value={choice} options={list} onChange={(v) => onChange(v, v === OTHER ? other : "")} ariaLabel="Specialty" invalid={!!error} />
      </Field>
      {choice === OTHER && (
        <Field label={required ? "Other Specialty *" : "Other Specialty"} error={otherError}>
          <input value={other} onChange={(e) => onChange(OTHER, e.target.value)} className="input" maxLength={120} placeholder="Type the specialty" aria-label="Other Specialty" autoFocus />
        </Field>
      )}
    </>
  );
}

/** Suffix dropdown from Master Data (the stored value stays selectable). */
export function SuffixSelect({ value, onChange, publicToken, withEmpty }: { value: string; onChange: (v: string) => void; publicToken?: string | null; withEmpty?: boolean }) {
  const options = useMasterList("suffix", publicToken !== undefined ? { publicToken } : undefined);
  const list = withCurrent(options, value);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="input" aria-label="Suffix">
      {withEmpty && <option value="">— Select —</option>}
      {list.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </Select>
  );
}
