// Response / request types for the providers module (docs/api/providers.md).

export type ProviderStatus = "draft" | "in_progress" | "active" | "on_hold" | "terminated";
export type DocStatus = "approved" | "missing" | "expired" | "pending_review" | "na";
export type DocType =
  | "diploma" | "medical_license" | "dea" | "malpractice" | "cv" | "board_cert" | "w9" | "irs_letter" | "gov_id"
  | "csr_license" | "cme" | "claim_history" | "clia" | "collaborative" | "ecfmg";
export type ProviderSource = "manual" | "caqh" | "invite" | "self_signup";

export interface DocProgress {
  approved: number;
  required: number;
  missingCritical: number;
}

export interface EnrollmentCounts {
  total: number;
  approved: number;
}

/** An extra document the provider added (My Documents → Add More Document). */
export interface AdditionalDocument {
  id: number;
  providerId: number;
  docType: string;
  docTypeLabel: string;
  title: string | null;
  notes: string | null;
  expiresAt: string | null;
  fileName: string | null;
  mimeType?: string | null;
  sizeBytes: number | null;
  status: string;
  uploadedAt: string;
  notesUpdatedAt?: string | null;
  notesUpdatedBy?: string | null;
}

export interface DocumentRow {
  id: number;
  providerId: number;
  docType: DocType;
  label: string;
  critical: boolean;
  expires: boolean;
  sortOrder: number | null;
  status: DocStatus;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  originalRelativePath: string | null;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  uploadedAt: string | null;
  hasFile: boolean;
  /** staff notes: why the document is pending / on hold */
  notes?: string | null;
  notesUpdatedAt?: string | null;
  notesUpdatedBy?: string | null;
  /** an additional document the provider added (My Documents → Add More Document) */
  extra?: boolean;
}

/** More provider details (group, IDs, home / practice / billing); the SSN only as its last 4 digits. */
export interface ProviderExtraView {
  taxonomyCode: string | null;
  groupName: string | null;
  groupNpi: string | null;
  taxId: string | null;
  homeAddress: string | null;
  homeCity: string | null;
  homeState: string | null;
  homeZip: string | null;
  medicarePhone: string | null;
  medicaidNumber: string | null;
  medicarePtan: string | null;
  drivingLicense: string | null;
  practiceLegalName: string | null;
  practiceDbaName: string | null;
  practiceOwnerName: string | null;
  practiceManagerName: string | null;
  practiceManagerContact: string | null;
  practiceAddress: string | null;
  practiceCity: string | null;
  practiceState: string | null;
  practiceZip: string | null;
  practicePhone: string | null;
  practiceFax: string | null;
  practiceEmail: string | null;
  practiceStartDate: string | null;
  officeHours: string | null;
  billingAddress: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingZip: string | null;
  billingPhone: string | null;
  billingFax: string | null;
  billingEmail: string | null;
  billingContactPerson: string | null;
  hasSsn: boolean;
  ssnLast4: string | null;
  hasPecosPassword: boolean;
}

export interface ProviderDetail {
  /** the provider has a sign-in (username = their email) */
  hasLogin?: boolean;
  id: number;
  firstName: string;
  lastName: string;
  suffix: string | null;
  specialty: string | null;
  practitionerType: string | null;
  taxonomyCode: string | null;
  gender: string | null;
  ethnicity: string | null;
  dateOfBirth: string | null;
  npi: string | null;
  email: string | null;
  phone: string | null;
  licenseNumber: string | null;
  licenseState: string | null;
  licenseExpires: string | null;
  deaNumber: string | null;
  deaExpires: string | null;
  boardCert: string | null;
  malpracticeCarrier: string | null;
  caqhId: string | null;
  caqhUsername: string | null;
  /** a CAQH password is stored (the password itself is never sent) */
  hasCaqhPassword?: boolean;
  pecosAccessGranted?: boolean | null;
  pecosUsername?: string | null;
  caqhLastAttested: string | null;
  caqhLastSynced: string | null;
  caqhAttestationStatus: string | null;
  clientId: number | null;
  clientName: string | null;
  practiceId: number | null;
  practiceName: string | null;
  locationId: number | null;
  locationName: string | null;
  status: ProviderStatus;
  telemed: boolean;
  source: ProviderSource;
  dateAdded: string;
  selfSignup: boolean;
  createdAt: string;
  updatedAt: string;
  documentProgress: DocProgress;
  enrollments: EnrollmentCounts;
  documents: DocumentRow[];
  extra?: ProviderExtraView | null;
}

export interface ProviderListItem {
  id: number;
  firstName: string;
  lastName: string;
  suffix: string | null;
  specialty: string | null;
  status: ProviderStatus;
  email: string | null;
  phone: string | null;
  npi: string | null;
  caqhId: string | null;
  clientId: number | null;
  practiceId: number | null;
  practiceName: string | null;
  locationId: number | null;
  locationName: string | null;
  telemed: boolean;
  source: ProviderSource;
  dateAdded: string;
  documents: DocProgress;
  enrollments: EnrollmentCounts;
}

export interface ProviderLite {
  id: number;
  name: string;
  npi: string | null;
  specialty: string | null;
  status: ProviderStatus;
  locationId: number | null;
}

export interface AssignmentSummary {
  total: number;
  assigned: number;
  unassigned: number;
  locations: number;
  byLocation: { locationId: number; locationName: string; legalName: string | null; practiceId: number | null; count: number }[];
}

export interface BulkAssignResult {
  updated: number;
  locationId: number | null;
  locationName: string | null;
}

export interface ClassifyResult {
  fileName: string;
  docType: DocType | null;
  label: string | null;
  confidence: "filename";
}

export interface UploadResult {
  uploaded: { fileName: string; docType: DocType; label: string; classification: "manual" | "filename"; status: DocStatus }[];
  documents: DocumentRow[];
}

export interface BatchResultRow {
  fileName: string;
  relativePath: string | null;
  docType: DocType | null;
  label: string | null;
  status: "uploaded" | "skipped";
  reason: string | null;
}

export interface InviteResponse {
  inviteId: number;
  providerId: number;
  providerName: string;
  email: string;
  pin: string;
  expiresAt: string;
  uploadUrl: string;
  /** sent | failed (emailError says why) | queued (email sending disabled on the server; only logged) */
  emailStatus: "sent" | "failed" | "queued";
  emailError: string | null;
}

export interface TimeEntry {
  id: number;
  providerId: number;
  userId: number | null;
  userName: string | null;
  startedAt: string;
  endedAt: string | null;
  seconds: number;
  note: string | null;
  createdAt: string;
}

export type FollowUpType = "phone_call" | "email" | "meeting" | "note";

export interface FollowUp {
  id: number;
  providerId: number;
  userId: number | null;
  userName: string | null;
  type: FollowUpType | string;
  subject: string;
  outcome: string | null;
  occurredAt: string;
  nextDate: string | null;
  createdAt: string;
  task: { id: number; title: string; dueDate: string; status: "open"; priority: "medium" } | null;
}

export type VerificationSource = "npi" | "oig" | "sam" | "state_license";

export interface Verification {
  id: number;
  providerId: number;
  source: VerificationSource;
  sourceLabel: string;
  status: "clear" | "flagged";
  message: string | null;
  checkedAt: string;
  runBy: number | null;
  runByName: string | null;
}

export type LetterType = "initial" | "recred" | "privileging";

export interface Letter {
  id: number;
  letterType: LetterType;
  title: string;
  confirmationText: string;
  provider: {
    id: number; firstName: string; lastName: string; suffix: string | null; npi: string | null;
    specialty: string | null; licenseNumber: string | null; licenseState: string | null;
  };
  organization: {
    id: number; name: string; address: string | null; city: string | null; state: string | null;
    zip: string | null; phone: string | null; email: string | null;
  } | null;
  hospital: { id: number; name: string; city: string | null; state: string | null } | null;
  letterDate: string;
  effectiveDate: string;
  nextRecredDue: string;
  generatedAt: string;
  generatedBy: number | null;
  generatedByName: string | null;
}

export interface Hospital {
  id: number;
  name: string;
  city: string | null;
  state: string | null;
  active: boolean;
}

// ---- Organization structure (docs/api/organization.md) ----

export interface ClientItem {
  id: number;
  name: string;
  practiceCount: number;
  providerCount: number;
}

export interface PracticeItem {
  id: number;
  clientId: number;
  clientName: string | null;
  name: string;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  locationCount: number;
  providerCount: number;
}

export interface LocationItem {
  id: number;
  practiceId: number | null;
  practiceName: string | null;
  clientId: number | null;
  clientName: string | null;
  name: string;
  legalName: string | null;
  npi: string | null;
  locationType: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  active: boolean;
  providerCount: number;
}

// ---- Provider portal ----

export interface MyEnrollment {
  id: number;
  payerId: number;
  payerName: string | null;
  payerColor: string | null;
  status: string;
  applicationType: string;
  submittedDate: string | null;
  effectiveDate: string | null;
  tatDays: number | null;
}

// ---- Public secure upload ----

export interface PublicMissingDoc {
  docType: DocType;
  label: string;
  critical: boolean;
  expires: boolean;
  status: DocStatus;
}

export interface PublicInviteInfo {
  providerName: string;
  organizationName: string | null;
  email: string;
  missingDocuments: PublicMissingDoc[];
  expiresAt: string;
  firstName: string;
  lastName: string;
  profile: PublicProfile;
  /** profile = Send Link (profile + documents); documents = Request Documents (only the requested documents) */
  purpose?: "profile" | "documents";
}

/** Current provider values used to pre-fill the portal profile step. */
export interface PublicProfile {
  npi: string | null;
  caqhId: string | null;
  suffix: string | null;
  specialty: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  licenseNumber: string | null;
  licenseState: string | null;
  licenseExpires: string | null;
  deaNumber: string | null;
  deaExpires: string | null;
  /** false = the provider chooses a sign-in password on the profile step (their email is the username). */
  hasLogin: boolean;
  loginEmail: string | null;
  /** set by the staff member who sent the link (shown, not editable) */
  status?: string | null;
  clientName?: string | null;
  practiceName?: string | null;
  locationName?: string | null;
  extra?: ProviderExtraView | null;
}

/** GET /public/invites/{token}: link state before the PIN is entered. */
export interface PublicLinkStatus {
  state: "active" | "expired" | "locked" | "submitted" | "replaced";
  firstName: string | null;
  organizationName: string | null;
  expiresAt: string;
  attemptsRemaining: number;
  submittedAt: string | null;
  purpose?: "profile" | "documents";
}

export interface PublicUploadResult {
  uploaded: { fileName: string; docType: DocType; label: string; expiresAt: string | null }[];
  missingDocuments: PublicMissingDoc[];
}

// ---- Secure Links (admin) ----

export type SecureLinkStatus = "pending" | "accessed" | "submitted" | "expired" | "locked" | "replaced";

export interface SecureLinkItem {
  id: number;
  providerId: number;
  providerName: string;
  email: string;
  pin: string;
  status: SecureLinkStatus;
  attempts: number;
  maxAttempts: number;
  uploadUrl: string;
  createdAt: string;
  expiresAt: string;
  accessedAt: string | null;
  submittedAt: string | null;
  /** profile = invitation (Send Link); documents = document request */
  purpose?: "profile" | "documents";
}
