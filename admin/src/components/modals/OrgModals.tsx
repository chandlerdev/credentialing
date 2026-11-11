"use client";

import { Select } from "@/components/Select";

import { useState } from "react";
import { PhoneInput } from "@/components/PhoneInput";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useToast } from "@/stores/toast";
import { addressChars, addressRule, digitsOnly, emailRule, nameRule, npiRule, phoneDigits, phoneRule, taxIdChars, taxIdRule, validate } from "@/lib/validation";
import {
  blankToNull,
  toLocationRequest,
  type Location,
  type LocationRequest,
  type Practice,
  type PracticeRequest,
  type TreePractice,
} from "@/types/organization";

type Errors = Record<string, string>;

/** Shared submit helper: busy flag, server field errors and a generic error message. */
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setFormError("");
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      // A duplicate name (409) is shown under the name field.
      else if (e instanceof ApiError && e.status === 409) setErrors({ name: e.message });
      setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, errors, setErrors, formError, run };
}

function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="px-3 py-2 rounded-lg flex items-center gap-2" style={{ background: "var(--danger-soft)", color: "#991b1b", fontSize: 13 }}>
      <Icon name="AlertCircle" size={14} /> {message}
    </div>
  );
}

const Busy = ({ on }: { on: boolean }) => (on ? <span className="loader" style={{ borderTopColor: "white" }} /> : null);

// ============================================================
// EDIT PRACTICE MODAL (name, Tax ID, address, phone, email)
// ============================================================
export function EditPracticeModal({
  practice,
  organizationName,
  onClose,
  onSaved,
}: {
  practice: TreePractice | Practice;
  /** the organization the practice belongs to (shown, not editable) */
  organizationName?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(practice?.name || "");
  const [taxId, setTaxId] = useState(practice?.taxId || "");
  const [address, setAddress] = useState(practice?.address || "");
  const [phone, setPhone] = useState(phoneDigits(practice?.phone));
  const [email, setEmail] = useState(practice?.email || "");
  const toast = useToast();
  const { busy, errors, setErrors, formError, run } = useSubmit();

  const save = () => {
    const e = validate({
      name: [name, nameRule("Practice name", 200)],
      taxId: [taxId, taxIdRule],
      address: [address, addressRule(false)],
      phone: [phone, phoneRule],
      email: [email, emailRule],
    });
    setErrors(e);
    if (Object.keys(e).length) return;
    run(async () => {
      const body: PracticeRequest = {
        name: name.trim(),
        taxId: taxId || "",
        address: blankToNull(address),
        phone: blankToNull(phone),
        email: blankToNull(email),
      };
      await api.put("/practices/" + practice.id, body);
      toast("Practice updated");
      onSaved();
      onClose();
    });
  };

  return (
    <Modal title="Edit Practice" subtitle={practice?.name || ""} onClose={onClose} maxWidth={460}>
      <div className="space-y-3">
        {organizationName && (
          <div className="p-2 rounded text-xs" style={{ background: "var(--bg-soft)" }} data-practice-org>
            <span className="text-ink-light">Organization:</span> <span className="font-semibold">{organizationName}</span>
          </div>
        )}
        <Field label="Practice Name" required error={errors.name}>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" autoFocus maxLength={200} />
        </Field>
        <Field label="Tax ID (EIN)" error={errors.taxId} hint="Letters and digits, 5-20 characters">
          <input value={taxId} onChange={(e) => setTaxId(taxIdChars(e.target.value))} className="input font-mono" placeholder="e.g. 12-3456789 or TX12AB345" />
        </Field>
        <PracticeContactFields
          address={address}
          phone={phone}
          email={email}
          errors={errors}
          onChange={(k, v) => (k === "address" ? setAddress(v) : k === "phone" ? setPhone(v) : setEmail(v))}
        />
        <FormError message={formError} />
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={save} disabled={!name.trim() || busy} className="btn btn-primary">
            {busy ? <Busy on /> : <Icon name="Save" size={13} />} Update
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Practice Address / Phone / Email inputs, shared by Add and Edit Practice. */
function PracticeContactFields({
  address,
  phone,
  email,
  errors,
  onChange,
}: {
  address: string;
  phone: string;
  email: string;
  errors: Errors;
  onChange: (field: "address" | "phone" | "email", value: string) => void;
}) {
  return (
    <>
      <Field label="Address" error={errors.address}>
        <input value={address} onChange={(e) => onChange("address", addressChars(e.target.value))} className="input" placeholder="e.g. 30 Pearly Lane, Gardner, MA 01440" />
      </Field>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Ph.No" error={errors.phone}>
          <PhoneInput value={phone} onChange={(v) => onChange("phone", v)} invalid={!!errors.phone} />
        </Field>
        <Field label="Email" error={errors.email}>
          <input type="email" value={email} onChange={(e) => onChange("email", e.target.value.trim())} className="input" maxLength={255} placeholder="info@practice.com" />
        </Field>
      </div>
    </>
  );
}

// ============================================================
// EDIT LOCATION MODAL (prototype: name, legal name, NPI, address, phone)
// ============================================================
export function EditLocationModal({ location, onClose, onSaved }: { location: Location; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: location?.name || "",
    legalName: location?.legalName || "",
    npi: location?.npi || "",
    address: location?.address || "",
    phone: phoneDigits(location?.phone),
  });
  const toast = useToast();
  const { busy, errors, setErrors, formError, run } = useSubmit();

  const save = () => {
    const e = validate({
      name: [form.name, nameRule("Location name", 150)],
      legalName: [form.legalName, nameRule("Legal name", 200, false)],
      npi: [form.npi, npiRule],
      address: [form.address, addressRule(false)],
      phone: [form.phone, phoneRule],
    });
    setErrors(e);
    if (Object.keys(e).length) return;
    run(async () => {
      // PUT is a full replace: keep the fields this modal does not edit (practice, type, city/state/zip, coordinates, active).
      const body = toLocationRequest(location, {
        name: form.name.trim(),
        legalName: blankToNull(form.legalName),
        npi: form.npi || "",
        address: form.address.trim(),
        phone: blankToNull(form.phone),
      });
      await api.put("/locations/" + location.id, body);
      toast("Location updated");
      onSaved();
      onClose();
    });
  };

  return (
    <Modal title="Edit Location" subtitle={location?.name} onClose={onClose} maxWidth={520}>
      <div className="space-y-3">
        <Field label="Location Name" required error={errors.name}>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" maxLength={150} />
        </Field>
        <Field label="Legal Name" error={errors.legalName}>
          <input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} className="input" maxLength={200} placeholder="LLC / INC name" />
        </Field>
        <Field label="NPI" error={errors.npi}>
          <input value={form.npi} onChange={(e) => setForm({ ...form, npi: digitsOnly(e.target.value, 10) })} className="input font-mono" inputMode="numeric" placeholder="10 digits" />
        </Field>
        <Field label="Address" error={errors.address}>
          <input value={form.address} onChange={(e) => setForm({ ...form, address: addressChars(e.target.value) })} className="input" placeholder="e.g. 30 Pearly Lane, Gardner, MA 01440" />
        </Field>
        <Field label="Ph.No" error={errors.phone}>
          <PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} invalid={!!errors.phone} />
        </Field>
        <FormError message={formError} />
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={save} disabled={busy} className="btn btn-primary"><Busy on={busy} /> Update</button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// LOCATION MAP VIEW (OpenStreetMap embed)
// ============================================================
export function LocationMapModal({ location, onClose }: { location: Location; onClose: () => void }) {
  const hasCoords = location.lat != null && location.lng != null;
  const lat = location.lat ?? 0;
  const lng = location.lng ?? 0;
  const bbox = lng - 0.02 + "," + (lat - 0.01) + "," + (lng + 0.02) + "," + (lat + 0.01);
  const mapUrl = "https://www.openstreetmap.org/export/embed.html?bbox=" + bbox + "&layer=mapnik&marker=" + lat + "," + lng;
  const fullAddress = [location.address, location.city, [location.state, location.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const externalUrl = hasCoords
    ? "https://www.openstreetmap.org/?mlat=" + lat + "&mlon=" + lng + "#map=15/" + lat + "/" + lng
    : "https://www.openstreetmap.org/search?query=" + encodeURIComponent(fullAddress);

  return (
    <Modal title={location.name} subtitle={location.address} onClose={onClose} maxWidth={760}>
      <div className="space-y-3">
        <div className="rounded-lg overflow-hidden border border-line" style={{ height: 400 }}>
          {hasCoords ? (
            <iframe src={mapUrl} style={{ width: "100%", height: "100%", border: 0 }} title="Location map" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-center bg-soft px-6">
              <Icon name="MapPinOff" size={28} className="text-ink-faint mb-2" />
              <div className="font-display font-semibold text-ink">No map coordinates</div>
              <div className="text-sm text-ink-light mt-1 max-w-sm">This location has no latitude/longitude saved yet. Open the address in OpenStreetMap to find it.</div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-ink-faint">Legal Name</div>
            <div className="font-medium">{location.legalName || "—"}</div>
          </div>
          <div>
            <div className="text-xs text-ink-faint">NPI</div>
            <div className="font-mono">{location.npi || "—"}</div>
          </div>
          <div>
            <div className="text-xs text-ink-faint">Ph.No</div>
            <div>{location.phone || "—"}</div>
          </div>
          <div>
            <div className="text-xs text-ink-faint">Providers</div>
            <div>{location.providerCount}</div>
          </div>
        </div>
        <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline flex items-center gap-1">
          <Icon name="ExternalLink" size={11} /> View on OpenStreetMap
        </a>
      </div>
    </Modal>
  );
}

// ============================================================
// ADD PRACTICE / LOCATION
// practice = name, Tax ID, contact (it belongs to the organization); location = name, parent practice, legal name,
// NPI, address.
// ============================================================
type AddType = "practice" | "location";

export function AddPracticeLocationModal({
  organizationName,
  practices,
  onClose,
  onSaved,
  initialType = "practice",
  initialParentId,
}: {
  organizationName: string;
  practices: Practice[];
  onClose: () => void;
  onSaved: (type: AddType) => void;
  initialType?: AddType;
  /** Pre-selected parent practice of a new location. */
  initialParentId?: number;
}) {
  const [type, setType] = useState<AddType>(initialType);
  const [form, setForm] = useState({
    name: "", taxId: "", parentId: initialParentId && initialType === "location" ? String(initialParentId) : "",
    legalName: "", npi: "", address: "", phone: "", email: "",
  });
  const toast = useToast();
  const { busy, errors, setErrors, formError, run } = useSubmit();
  const label = type === "practice" ? "Practice name" : "Location name";
  const switchType = (t: AddType) => {
    setType(t);
    setErrors({});
  };

  const save = () => {
    const rules: Parameters<typeof validate>[0] = { name: [form.name, nameRule(label, type === "location" ? 150 : 200)] };
    if (type === "practice") {
      rules.taxId = [form.taxId, taxIdRule];
      rules.address = [form.address, addressRule(false)];
      rules.phone = [form.phone, phoneRule];
      rules.email = [form.email, emailRule];
    }
    if (type === "location") {
      rules.legalName = [form.legalName, nameRule("Legal name", 200, false)];
      rules.npi = [form.npi, npiRule];
      rules.address = [form.address, addressRule(false)];
    }
    const e = validate(rules);
    setErrors(e);
    if (Object.keys(e).length) return;
    run(async () => {
      if (type === "practice") {
        await api.post("/practices", {
          name: form.name.trim(),
          taxId: form.taxId || "",
          address: blankToNull(form.address),
          phone: blankToNull(form.phone),
          email: blankToNull(form.email),
        });
        toast("Practice added");
      } else {
        const body: LocationRequest = {
          name: form.name.trim(),
          practiceId: form.parentId ? Number(form.parentId) : null,
          legalName: blankToNull(form.legalName),
          npi: form.npi || "",
          locationType: "Primary",
          address: form.address.trim(),
          city: "",
          state: "",
          zip: "",
          phone: null,
          active: true,
        };
        await api.post("/locations", body);
        toast("Location added");
      }
      onSaved(type);
      onClose();
    });
  };

  return (
    <Modal title="Add Practice / Location" subtitle={"Add a new practice or location to " + organizationName} onClose={onClose} maxWidth={560}>
      <div className="space-y-3">
        <div>
          <label className="label">Type</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: "practice" as const, label: "Practice", icon: "Briefcase" },
              { id: "location" as const, label: "Location", icon: "MapPin" },
            ].map((o) => (
              <button key={o.id} onClick={() => switchType(o.id)} className={"card p-3 text-center transition-all " + (type === o.id ? "border-accent bg-accent-soft" : "card-hover")}>
                <Icon name={o.icon} size={18} className="mx-auto mb-1" style={{ color: type === o.id ? "var(--accent)" : "var(--ink-light)" }} />
                <div className="text-sm font-medium">{o.label}</div>
              </button>
            ))}
          </div>
        </div>
        <Field label={type === "practice" ? "Practice Name" : "Location Name"} required error={errors.name}>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" maxLength={type === "location" ? 150 : 200} />
        </Field>
        {type === "practice" && (
          <>
            <Field label="Tax ID" error={errors.taxId} hint="Letters and digits, 5-20 characters">
              <input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: taxIdChars(e.target.value) })} className="input font-mono" placeholder="e.g. 12-3456789 or TX12AB345" />
            </Field>
            <Field label="Organization">
              <input value={organizationName} className="input" disabled aria-label="Organization" data-practice-org />
            </Field>
            <PracticeContactFields
              address={form.address}
              phone={form.phone}
              email={form.email}
              errors={errors}
              onChange={(k, v) => setForm({ ...form, [k]: v })}
            />
          </>
        )}
        {type === "location" && (
          <>
            <Field label="Parent Practice" error={errors.practiceId}>
              <Select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} className="input">
                <option value="">— Select practice —</option>
                {practices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Legal Name" error={errors.legalName}>
              <input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} className="input" maxLength={200} placeholder="LLC / INC name" />
            </Field>
            <Field label="NPI" error={errors.npi}>
              <input value={form.npi} onChange={(e) => setForm({ ...form, npi: digitsOnly(e.target.value, 10) })} className="input font-mono" inputMode="numeric" placeholder="10 digits" />
            </Field>
            <Field label="Address" error={errors.address}>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: addressChars(e.target.value) })} className="input" placeholder="e.g. 30 Pearly Lane, Gardner, MA 01440" />
            </Field>
          </>
        )}
        <FormError message={formError} />
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={save} disabled={!form.name.trim() || busy} className="btn btn-primary"><Busy on={busy} /> Add {type}</button>
        </div>
      </div>
    </Modal>
  );
}
