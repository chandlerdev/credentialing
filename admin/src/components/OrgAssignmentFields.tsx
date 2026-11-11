"use client";

import { Select } from "@/components/Select";

import { AlertBox } from "./AlertBox";
import { Field, RequiredMark } from "./Field";
import { Icon } from "./Icon";
import { useOrgStructure } from "@/components/providers/shared";

export interface OrgAssignment {
  clientId: string;
  practiceId: string;
  locationId: string;
}

export const EMPTY_ASSIGNMENT: OrgAssignment = { clientId: "", practiceId: "", locationId: "" };

/** API payload for an assignment (ids as numbers, blanks as null). */
export const assignmentPayload = (a: OrgAssignment) => ({
  clientId: a.clientId ? Number(a.clientId) : null,
  practiceId: a.practiceId ? Number(a.practiceId) : null,
  locationId: a.locationId ? Number(a.locationId) : null,
});

/**
 * Prototype v2 "Assign to Organization": client → practice → location, all optional when adding a provider.
 * Picking a practice fills in its client.
 */
export function OrgAssignmentFields({
  value,
  onChange,
  title = "Assign to Organization",
  error,
  locationRequired = false,
  locationError,
  clientError,
}: {
  value: OrgAssignment;
  onChange: (v: OrgAssignment) => void;
  title?: string;
  error?: string;
  /** adding a provider: the location must be chosen too */
  locationRequired?: boolean;
  locationError?: string;
  /** the client is required: its message */
  clientError?: string;
}) {
  const org = useOrgStructure();
  const { clients = [], practices = [], locations = [] } = org.data || {};
  const clientPractices = value.clientId ? practices.filter((p) => String(p.clientId) === value.clientId) : [];
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
          <Field label="Client" error={clientError}>
            <Select
              value={value.clientId}
              onChange={(e) => onChange({ clientId: e.target.value, practiceId: "", locationId: "" })}
              className="input"
              disabled={!org.data}
            >
              <option value="">{org.data ? "— Select client —" : "Loading…"}</option>
              {clients.map((cl) => (
                <option key={cl.id} value={cl.id}>{cl.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Practice" error={error}>
            <Select
              value={value.practiceId}
              onChange={(e) => {
                const pid = e.target.value;
                const parent = practices.find((p) => String(p.id) === pid);
                onChange({ clientId: parent ? String(parent.clientId) : value.clientId, practiceId: pid, locationId: "" });
              }}
              className="input"
              disabled={!value.clientId}
              style={error ? { borderColor: "var(--danger)" } : {}}
            >
              <option value="">{value.clientId ? "— Select practice —" : "Pick client first"}</option>
              {clientPractices.map((p) => (
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
          {org.data && clients.length === 0 && (
            <div className="text-[11px]" style={{ color: "#a16207" }}>
              ⚠ No clients yet. Add one from Organization → &quot;+ Add Client / Practice / Location&quot;.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Pre-fills the assignment from where a provider is being added (Organization screen). */
export const placementAssignment = (p: { clientId: number | null; practiceId: number | null; locationId: number | null }): OrgAssignment => ({
  clientId: p.clientId ? String(p.clientId) : "",
  practiceId: p.practiceId ? String(p.practiceId) : "",
  locationId: p.locationId ? String(p.locationId) : "",
});
