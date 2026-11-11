"use client";

import { Select } from "@/components/Select";

import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import type { LocationItem, Practice } from "@/types/caqh";

export interface ImportTargetValue {
  practiceId: number | null;
  locationId: number | null;
}

/** Practice / location picker shown before a CAQH import (replaces the prototype's hard-coded practice/location). */
export function ImportTarget({ value, onChange, disabled }: { value: ImportTargetValue; onChange: (v: ImportTargetValue) => void; disabled?: boolean }) {
  const practices = useAsync(() => api.get<Practice[]>("/practices"), []);
  const locations = useAsync(() => api.get<LocationItem[]>("/locations", { practiceId: value.practiceId ?? undefined, active: true }), [value.practiceId]);

  return (
    <div className="card card-pad mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="Building2" size={14} className="text-accent" />
        <h4 className="font-semibold text-sm text-ink">Import target</h4>
        <span className="text-xs text-ink-light">Assign imported providers to a practice and location (optional)</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Practice</label>
          <Select
            className="input"
            disabled={disabled || practices.loading}
            value={value.practiceId ?? ""}
            onChange={(e) => onChange({ practiceId: e.target.value ? Number(e.target.value) : null, locationId: null })}
          >
            <option value="">{practices.loading ? "Loading…" : "— No practice —"}</option>
            {(practices.data || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          {practices.error && (
            <div className="field-error">
              {practices.error}{" "}
              <button type="button" className="underline" onClick={practices.reload}>Retry</button>
            </div>
          )}
        </div>
        <div>
          <label className="label">Location</label>
          <Select
            className="input"
            disabled={disabled || locations.loading}
            value={value.locationId ?? ""}
            onChange={(e) => onChange({ ...value, locationId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">{locations.loading ? "Loading…" : "— No location —"}</option>
            {(locations.data || []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {!value.practiceId && l.practiceName ? " (" + l.practiceName + ")" : ""}
              </option>
            ))}
          </Select>
          {locations.error && (
            <div className="field-error">
              {locations.error}{" "}
              <button type="button" className="underline" onClick={locations.reload}>Retry</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Builds the optional target fields of the import request. */
export function targetPayload(v: ImportTargetValue): { practiceId?: number; locationId?: number } {
  return {
    ...(v.practiceId != null ? { practiceId: v.practiceId } : {}),
    ...(v.locationId != null ? { locationId: v.locationId } : {}),
  };
}
