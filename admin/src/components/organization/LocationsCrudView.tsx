"use client";

import { Select } from "@/components/Select";
import { CitySelect, StateSelect } from "@/components/AddressFields";

import { useMasterList, withCurrent } from "@/lib/masterLists";
import { useState } from "react";
import { PhoneInput } from "@/components/PhoneInput";
import { AccessDenied } from "@/components/AlertBox";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { Pill } from "@/components/Pill";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth, useUser } from "@/stores/auth";
import { useAsync } from "@/lib/hooks";
import { useToast } from "@/stores/toast";
import { useShell } from "@/stores/shell";
import { ROLE_LABEL } from "@/lib/constants";
import { addressChars, addressRule, cityRule, digitsOnly, nameRule, npiRule, phoneDigits, phoneRule, validate as runRules, zipRule } from "@/lib/validation";
import { blankToNull, type DeleteResult, type Location, type LocationRequest, type LocationType, type Practice } from "@/types/organization";

export function LocationsCrudView() {
  const user = useUser();
  const { can } = useAuth();
  const toast = useToast();
  const { publish } = useShell();
  const [editing, setEditing] = useState<Location | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Location | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canList = can("list", "location");
  const locations = useAsync<Location[]>(canList ? () => api.get<Location[]>("/locations") : null, [canList]);
  const practices = useAsync<Practice[]>(canList ? () => api.get<Practice[]>("/practices") : null, [canList]);

  if (!canList) return <AccessDenied action="list" entity="locations" role={ROLE_LABEL[user.role] || user.role} />;

  const list = locations.data || [];

  const doDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.delete<DeleteResult>("/locations/" + pendingDelete.id);
      toast("Location deleted");
      setPendingDelete(null);
      publish("providers");
      locations.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Locations"
        subtitle={locations.data ? list.length + " practice location(s)" : "Loading…"}
        actions={
          can("create", "location") && (
            <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn btn-primary">
              <Icon name="Plus" size={13} /> Add Location
            </button>
          )
        }
      />

      {locations.error ? (
        <ErrorState message={locations.error} onRetry={locations.reload} />
      ) : locations.loading && !locations.data ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((loc) => (
            <div key={loc.id} className="card">
              <div className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-ink">{loc.name}</h3>
                    <p className="text-xs text-ink-light mt-1">{loc.locationType || "Primary location"}</p>
                  </div>
                  <Pill type={loc.active !== false ? "success" : "neutral"}>{loc.active !== false ? "Active" : "Inactive"}</Pill>
                </div>
                <div className="text-xs text-ink-light space-y-1">
                  {loc.practiceName && <div><Icon name="Briefcase" size={11} className="inline mr-1" /> {loc.practiceName}</div>}
                  <div><Icon name="MapPin" size={11} className="inline mr-1" /> {loc.address}</div>
                  <div className="ml-4">
                    {loc.city}, {loc.state} {loc.zip}
                  </div>
                  {loc.phone && <div><Icon name="Phone" size={11} className="inline mr-1" /> {loc.phone}</div>}
                  <div><Icon name="Users" size={11} className="inline mr-1" /> {loc.providerCount} providers</div>
                </div>
                {(can("update", "location") || can("delete", "location")) && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-line">
                    {can("update", "location") && (
                      <button onClick={() => { setEditing(loc); setShowForm(true); }} className="btn btn-secondary text-xs flex-1">
                        <Icon name="Edit" size={11} /> Edit
                      </button>
                    )}
                    {can("delete", "location") && (
                      <button onClick={() => setPendingDelete(loc)} className="btn-ghost p-1.5 hover:text-danger" title="Delete location">
                        <Icon name="Trash2" size={11} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {list.length === 0 && (
            <div className="md:col-span-2 lg:col-span-3">
              <EmptyState icon="Building2" title="No locations yet" description="Add your first practice location." />
            </div>
          )}
        </div>
      )}

      {showForm && (
        <LocationFormModal
          location={editing}
          practices={practices.data || []}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            locations.reload();
          }}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="Delete location"
          message={
            pendingDelete.providerCount > 0
              ? "Delete " + pendingDelete.name + "? " + pendingDelete.providerCount + " provider(s) are at this location and will be unassigned."
              : "Delete " + pendingDelete.name + "?"
          }
          busy={deleting}
          onConfirm={doDelete}
          onClose={() => !deleting && setPendingDelete(null)}
        />
      )}
    </div>
  );
}

interface LocationForm {
  name: string;
  locationType: LocationType;
  practiceId: string;
  legalName: string;
  npi: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  active: boolean;
}

export function LocationFormModal({ location, practices, onSaved, onClose }: { location: Location | null; practices: Practice[]; onSaved: () => void; onClose: () => void }) {
  const locationTypes = useMasterList("location_type");
  const [form, setForm] = useState<LocationForm>(
    location
      ? {
          name: location.name,
          locationType: location.locationType || "Primary",
          practiceId: location.practiceId ? String(location.practiceId) : "",
          legalName: location.legalName || "",
          npi: location.npi || "",
          address: location.address || "",
          city: location.city || "",
          state: location.state || "",
          zip: location.zip || "",
          phone: phoneDigits(location.phone),
          active: location.active !== false,
        }
      : { name: "", locationType: "Primary", practiceId: "", legalName: "", npi: "", address: "", city: "", state: "TX", zip: "", phone: "", active: true }
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const validate = () => {
    const e = runRules({
      name: [form.name, nameRule("Location name", 150)],
      legalName: [form.legalName, nameRule("Legal name", 200, false)],
      npi: [form.npi, npiRule],
      address: [form.address, addressRule(true)],
      city: [form.city, cityRule(true)],
      zip: [form.zip, zipRule(true)],
      phone: [form.phone, phoneRule],
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setBusy(true);
    setFormError("");
    const body: LocationRequest = {
      name: form.name.trim(),
      practiceId: form.practiceId ? Number(form.practiceId) : null,
      legalName: blankToNull(form.legalName),
      npi: form.npi || "",
      locationType: form.locationType,
      address: form.address.trim(),
      city: form.city.trim(),
      state: form.state || "",
      zip: form.zip,
      phone: blankToNull(form.phone),
      // Coordinates are not edited here; keep what is stored (no default coordinates).
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
      active: form.active,
    };
    try {
      if (location) {
        await api.put("/locations/" + location.id, body);
        toast("Location updated");
      } else {
        await api.post("/locations", body);
        toast("Location created");
      }
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={location ? "Edit Location" : "Add Location"} onClose={onClose} maxWidth={520}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name *" error={errors.name}>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" placeholder="Enter Name" maxLength={150} />
          </Field>
          <Field label="Type" error={errors.locationType}>
            <Select value={form.locationType} onChange={(e) => setForm({ ...form, locationType: e.target.value as LocationType })} className="input">
              {withCurrent(locationTypes, form.locationType).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
        </div>
        <Field
          label={
            <>
              Parent Practice {!form.practiceId && <span className="text-xs text-ink-faint">(unlinked location won&apos;t appear in Organization tree)</span>}
            </>
          }
          error={errors.practiceId}
        >
          <Select value={form.practiceId} onChange={(e) => setForm({ ...form, practiceId: e.target.value })} className="input">
            <option value="">— No practice (unlinked) —</option>
            {practices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Legal Name" error={errors.legalName}>
            <input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} className="input" placeholder="Enter Legal Name" maxLength={200} />
          </Field>
          <Field label="Location NPI" error={errors.npi}>
            <input value={form.npi} onChange={(e) => setForm({ ...form, npi: digitsOnly(e.target.value, 10) })} className="input font-mono" inputMode="numeric" placeholder="Enter Location NPI" />
          </Field>
        </div>
        <Field label="Address *" error={errors.address}>
          <input value={form.address} onChange={(e) => setForm({ ...form, address: addressChars(e.target.value) })} className="input" placeholder="Enter Address" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="State" error={errors.state}>
            <StateSelect value={form.state || ""} onChange={(v) => setForm({ ...form, state: v, city: v === form.state ? form.city : "" })} />
          </Field>
          <Field label="City *" error={errors.city}>
            <CitySelect state={form.state || ""} value={form.city || ""} onChange={(v) => setForm({ ...form, city: v })} invalid={!!errors.city} />
          </Field>
          <Field label="ZIP *" error={errors.zip}>
            <input value={form.zip} onChange={(e) => setForm({ ...form, zip: digitsOnly(e.target.value, 5) })} className="input font-mono" inputMode="numeric" placeholder="Enter ZIP" />
          </Field>
        </div>
        <Field label="Ph.No" error={errors.phone}>
          <PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} invalid={!!errors.phone} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Location is active
        </label>
        {formError && (
          <div className="px-3 py-2 rounded-lg flex items-center gap-2" style={{ background: "var(--danger-soft)", color: "#991b1b", fontSize: 13 }}>
            <Icon name="AlertCircle" size={14} /> {formError}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={submit} className="btn btn-primary" disabled={busy}>
            {busy ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Save" size={13} />} {location ? "Update" : "Create Location"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
