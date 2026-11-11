// Response / request types for the organization module (docs/api/organization.md).

/** Master Data → Location Type (Primary, Satellite, Hospital, Admin Office and any added there) */
export type LocationType = string;

export interface Organization {
  id: number;
  name: string;
  orgType: string | null;
  taxId: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  status: "active" | "suspended";
  selfSignup: boolean;
  createdAt: string;
}

export interface Location {
  id: number;
  practiceId: number | null;
  practiceName: string | null;
  name: string;
  legalName: string | null;
  npi: string | null;
  locationType: LocationType;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  active: boolean;
  testData: boolean;
  providerCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeleteResult {
  deleted: true;
  unassignedProviders: number;
  detachedLocations: number;
}

export interface TreePractice {
  id: number;
  name: string;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  locationCount: number;
  providerCount: number;
  locations: Location[];
}

/** The organization's practices, each with its locations (there is no client level). */
export interface OrgTree {
  organization: Organization;
  practices: TreePractice[];
  unassignedLocations: Location[];
  totals: { practices: number; locations: number; providers: number; unassignedProviders: number };
}

export interface Practice {
  id: number;
  name: string;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  locationCount: number;
  providerCount: number;
}

export interface PracticeRequest {
  name: string;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface LocationRequest {
  name: string;
  practiceId?: number | null;
  legalName?: string | null;
  npi?: string | null;
  locationType?: LocationType | "";
  address: string;
  city: string;
  state?: string | null;
  zip: string;
  phone?: string | null;
  lat?: number | null;
  lng?: number | null;
  active?: boolean;
}

export interface OrganizationUpdate {
  name: string;
  orgType?: string | null;
  taxId?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** Row of GET /api/providers (paged) — only the fields this module renders. */
export interface LocationProviderRow {
  id: number;
  firstName: string;
  lastName: string;
  suffix: string | null;
  specialty: string | null;
  npi: string | null;
  status: string;
}

/** Builds a full-replace LocationRequest from an existing location, with overrides. */
export function toLocationRequest(loc: Location, over: Partial<LocationRequest> = {}): LocationRequest {
  return {
    name: loc.name,
    practiceId: loc.practiceId,
    legalName: loc.legalName,
    npi: loc.npi,
    locationType: loc.locationType,
    address: loc.address || "",
    city: loc.city || "",
    state: loc.state,
    zip: loc.zip || "",
    phone: loc.phone,
    lat: loc.lat,
    lng: loc.lng,
    active: loc.active,
    ...over,
  };
}

/** Prototype mapping of provider status → enrollment StatusPill key. */
export const providerStatusPillKey = (s: string) =>
  s === "active" ? "approved" : s === "draft" ? "draft" : s === "on_hold" ? "on_hold" : s === "terminated" ? "terminated" : "in_progress";

export const blankToNull = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
