"use client";

import { Select } from "@/components/Select";

import { AlertBox } from "./AlertBox";
import { Field, RequiredMark } from "./Field";
import { Icon } from "./Icon";
import { useOrgStructure } from "@/components/providers/shared";

export interface OrgAssignment {
  practiceId: string;
  locationId: string;
}

export const EMPTY_ASSIGNMENT: OrgAssignment = { practiceId: "", locationId: "" };

/** API payload for an assignment (ids as numbers, blanks as null). */
export const assignmentPayload = (a: OrgAssignment) => ({
  practiceId: a.practiceId ? Number(a.practiceId) : null,
  locationId: a.locationId ? Number(a.locationId) : null,
});

/**
 * "Assign to Organization": the organization's practice → location, both optional when adding a provider.
 */
export function OrgAssignmentFields({
  value,
  onChange,
  title = "Assign to Organization",
  error,
  locationRequired = false,
  locationError,
}: {
  value: OrgAssignment;
  onChange: (v: OrgAssignment) => void;
  title?: string;
  error?: string;
  /** adding a provider: the location must be chosen too */
  locationRequired?: boolean;
  locationError?: string;
}) {
  const org = useOrgStructure();
  const { practices = [], locations = [] } = org.data || {};
  const practiceLocations = value.practiceId ? locations.filter((l) => String(l.practiceId) === value.practiceId) : [];

  return (
    <div className="pt-3 mt-1 border-t border-line">
      <div className="text-xs font-semibold text-ink mb-2 flex items-center gap-1.5">
        <Icon name="Building2" size={13} className="text-accent" />
        {title.replace(/\s*\*$/, "")}
        {/\*$/.test(title) && <RequiredMark />}
      </div>
      {org.error ? (
        <AlertBox type="danger">
          {org.error}{" "}
          <button className="underline" onClick={org.reload}>Retry</button>
        </AlertBox>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          <Field label="Practice" error={error}>
            <Select
              value={value.practiceId}
              onChange={(e) => onChange({ practiceId: e.target.value, locationId: "" })}
              className="input"
              disabled={!org.data}
              style={error ? { borderColor: "var(--danger)" } : {}}
            >
              <option value="">{org.data ? "— Select practice —" : "Loading…"}</option>
              {practices.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={locationRequired ? "Location *" : "Location (optional)"} error={locationError}>
            <Select
              value={value.locationId}
              onChange={(e) => onChange({ ...value, locationId: e.target.value })}
              className="input"
              disabled={!value.practiceId}
              style={locationError ? { borderColor: "var(--danger)" } : {}}
            >
              <option value="">{locationRequired ? (value.practiceId ? "— Select location —" : "Pick practice first") : "— None —"}</option>
              {practiceLocations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          </Field>
          {org.data && practices.length === 0 && (
            <div className="text-[11px]" style={{ color: "#a16207" }}>
              ⚠ No practices yet. Add one from Organization → &quot;+ Add Practice / Location&quot;.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Pre-fills the assignment from where a provider is being added (Organization screen). */
export const placementAssignment = (p: { practiceId: number | null; locationId: number | null }): OrgAssignment => ({
  practiceId: p.practiceId ? String(p.practiceId) : "",
  locationId: p.locationId ? String(p.locationId) : "",
});
