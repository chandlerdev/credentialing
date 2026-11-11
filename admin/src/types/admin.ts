export interface TestDataCounts {
  providers: number;
  enrollments: number;
  locations: number;
  users: number;
  tasks: number;
  clients: number;
  practices: number;
}

// ---- Test Data → JSON Data Management (GET /admin/test-data/export, POST /admin/test-data/import) ----
// Records reference each other by the file's "id" strings.

export interface BundleDocument {
  status: string;
  expires?: string | null;
}

export interface BundlePractice {
  id: string;
  name: string;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface DataBundleData {
  orgName?: string | null;
  /** the organization's practices */
  practices?: BundlePractice[];
  /** older files only: practices grouped under clients (imported as plain practices) */
  clients?: { id: string; name: string; practices?: BundlePractice[] }[];
  locations?: {
    id: string;
    practiceId?: string | null;
    name: string;
    legalName?: string | null;
    npi?: string | null;
    locationType?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    phone?: string | null;
    lat?: number | null;
    lng?: number | null;
    active?: boolean | null;
  }[];
  providers: {
    id: string;
    firstName: string;
    lastName: string;
    suffix?: string | null;
    specialty?: string | null;
    npi?: string | null;
    email?: string | null;
    phone?: string | null;
    licenseNumber?: string | null;
    licenseState?: string | null;
    licenseExpires?: string | null;
    deaNumber?: string | null;
    deaExpires?: string | null;
    caqhId?: string | null;
    status?: string | null;
    dateAdded?: string | null;
    practiceId?: string | null;
    locationId?: string | null;
    documents?: Record<string, BundleDocument>;
  }[];
  enrollments?: { providerId: string; payerCode: string; status?: string | null; submittedDate?: string | null; effectiveDate?: string | null }[];
  tasks?: { title: string; description?: string | null; status?: string | null; priority?: string | null; dueDate?: string | null; providerId?: string | null }[];
}

export interface DataBundle {
  exportedAt: string;
  version: string;
  description?: string | null;
  data: DataBundleData;
}

export interface DataImportResult {
  removed: TestDataCounts;
  created: TestDataCounts;
  totals: TestDataCounts;
  skipped: string[];
}

export interface TestDataResult {
  created: TestDataCounts;
  totals: TestDataCounts;
  testUserPassword: string | null;
}

export interface AdminOrg {
  id: number;
  name: string;
  orgType: string | null;
  city: string | null;
  state: string | null;
  email: string | null;
  phone: string | null;
  status: "active" | "suspended";
  selfSignup: boolean;
  inviteCode: string | null;
  userCount: number;
  providerCount: number;
  packageCode: string | null;
  packageName: string | null;
  subscriptionStatus: string | null;
  createdAt: string;
}

export interface AdminOrgCreate {
  name: string;
  orgType?: string;
  taxId?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  packageCode?: string;
  estimatedProviders?: number;
  admin?: { firstName: string; lastName: string; email: string; password: string; title?: string; phone?: string };
}

/** Organization types used by the org sign-up form (prototype L10456). */
export const ORG_TYPES: { id: string; label: string }[] = [
  { id: "physician_group", label: "Physician Group" },
  { id: "hospital", label: "Hospital" },
  { id: "clinic", label: "Clinic" },
  { id: "aba", label: "ABA / Behavioral Health" },
  { id: "urgent_care", label: "Urgent Care" },
  { id: "cred_service", label: "Credentialing Service" },
  { id: "other", label: "Other" },
];

export const orgTypeLabel = (id: string | null) => ORG_TYPES.find((t) => t.id === id)?.label || id || "—";
