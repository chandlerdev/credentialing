// Response/request types for the enrollments module (docs/api/enrollments.md).

export type EnrollmentStatus = "draft" | "in_progress" | "submitted" | "approved" | "needs_attention" | "on_hold" | "terminated";
export type ApplicationType = "initial" | "recred" | "update" | "terminate";

export interface Enrollment {
  id: number;
  providerId: number;
  providerName: string;
  providerNpi: string | null;
  payerId: number;
  payerName: string;
  payerColor: string;
  practiceId: number | null;
  practiceName: string | null;
  formId: number | null;
  formLabel: string | null;
  applicationType: ApplicationType;
  status: EnrollmentStatus;
  submittedDate: string | null;
  /** the approved date */
  effectiveDate: string | null;
  /** the last follow-up with the payer */
  followUpDate?: string | null;
  estApprovedDate?: string | null;
  /** the next follow-up with the payer */
  nextFollowUpDate?: string | null;
  notesUpdatedAt?: string | null;
  notesUpdatedBy?: string | null;
  /** the payer's acknowledgement / approval certificate (approved enrollments) */
  acknowledgementFileId?: number | null;
  acknowledgementFileName?: string | null;
  acknowledgementMimeType?: string | null;
  tatDays: number | null;
  notes: string | null;
  assignedUserId: number | null;
  assignedUserName: string | null;
  fileCount: number;
  eventCount: number;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EnrollmentFileType = "welcome_letter" | "application_form" | "contract" | "acknowledgement" | "other";

export interface EnrollmentFile {
  id: number;
  enrollmentId: number;
  name: string;
  fileType: EnrollmentFileType;
  mimeType: string | null;
  sizeBytes: number | null;
  hasFile: boolean;
  uploadedAt: string;
  uploadedBy: number | null;
  uploadedByName: string | null;
}

export interface EnrollmentEvent {
  id: number;
  enrollmentId: number;
  type: string;
  occurredAt: string;
  actorUserId: number | null;
  actorLabel: string | null;
  note: string | null;
  confirmationNumber: string | null;
}

export interface EnrollmentDetail {
  enrollment: Enrollment;
  files: EnrollmentFile[];
  events: EnrollmentEvent[];
}

export interface EnrollmentSummary {
  total: number;
  byStatus: Record<EnrollmentStatus, number>;
  approved: number;
  active: number;
  avgTatDays: number | null;
}

export interface EnrollmentRequest {
  providerId: number;
  payerId: number;
  status?: EnrollmentStatus;
  applicationType?: ApplicationType;
  practiceId?: number;
  formId?: number;
  submittedDate?: string | null;
  effectiveDate?: string | null;
  followUpDate?: string | null;
  estApprovedDate?: string | null;
  nextFollowUpDate?: string | null;
  notes?: string;
  assignedUserId?: number;
}

export interface EnrollmentPatch {
  status?: EnrollmentStatus;
  submittedDate?: string;
  effectiveDate?: string;
  assignedUserId?: number;
  notes?: string;
  clearSubmittedDate?: boolean;
  clearEffectiveDate?: boolean;
  clearAssignedUser?: boolean;
}

// ---------- Payers (global catalog) ----------

export interface PayerForm {
  id: number;
  payerId: number;
  code: string;
  label: string;
  description: string | null;
  sortOrder: number;
}

export type PayerIntegration = "caqh" | "availity" | "pecos" | "portal";
export type ApiSupport = "full" | "partial" | "portal" | "manual";

export type SubmissionMethod = "caqh_roster" | "availity" | "pecos" | "state_portal" | "direct_api" | "portal_only";

export interface Payer {
  id: number;
  code: string;
  name: string;
  fullName: string | null;
  category: string;
  payerType: string | null;
  color: string;
  appForm: string | null;
  integration: PayerIntegration;
  apiSupport: ApiSupport;
  /** How enrollments reach the payer (Payer API Reference). */
  submissionMethod: SubmissionMethod;
  apiAvailable: boolean;
  apiVendor: string | null;
  apiDocsUrl: string | null;
  submissionNotes: string | null;
  caqhParticipating: boolean;
  portalUrl: string | null;
  avgTatDays: number | null;
  pricingCategory: "medicare" | "medicaid" | "commercial" | null;
  pricingMult: number;
  recredCycleMonths: number;
  sortOrder: number;
  active: boolean;
  forms: PayerForm[];
  createdAt: string;
  updatedAt: string;
  /** Card image (data: URL) set by the super admin; the name's letters are shown without it. */
  logo: string | null;
  portalAvailable: boolean;
  /** API access: whether a key / token is saved (the values are never sent to the browser) */
  hasApiKey?: boolean;
  hasApiToken?: boolean;
  caqhUpdate?: string | null;
}

// ---------- Providers (owned by the providers module; only the lite list is used here) ----------

/** Row of GET /providers/all-lite. Handles both `name` and `firstName`/`lastName` shapes. */
export interface ProviderLite {
  id: number;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  suffix?: string | null;
  npi: string | null;
  specialty: string | null;
  status: string;
  caqhId?: string | null;
  email?: string | null;
  locationId?: number | null;
}

export interface StaffUser {
  id: number;
  displayName: string;
  role: string;
  title: string | null;
}
