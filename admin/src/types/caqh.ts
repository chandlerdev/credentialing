// Response / request types for the CAQH module (docs/api/operations.md §6, providers.md import, organization.md).

export type CaqhPath = "direct" | "aggregator" | "csv";
export type CaqhEnvironment = "production" | "sandbox";
export type AggregatorVendor = "certifyos" | "andros" | "verifiable" | "medallion";
export type SyncCadence = "hourly" | "daily" | "weekly" | "monthly";
export type DayOfWeek = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";

export interface CaqhConfig {
  path: CaqhPath;
  directUsername: string | null;
  directOrgId: string | null;
  directEnvironment: CaqhEnvironment | null;
  hasDirectPassword: boolean;
  aggregatorVendor: AggregatorVendor | null;
  aggregatorBaseUrl: string | null;
  hasAggregatorKey: boolean;
  syncEnabled: boolean;
  syncCadence: SyncCadence;
  syncDayOfWeek: DayOfWeek;
  syncHour: number;
  syncOnlyAttested: boolean;
  syncNotifyChanges: boolean;
  syncRateLimit: number;
  nextRunAt: string | null;
  updatedAt: string | null;
}

export interface CaqhConfigTestResult {
  integration: "deferred";
  configured: boolean;
  path: CaqhPath;
  message: string;
}

export type CaqhProviderStatusCode = "ok" | "due_soon" | "overdue" | "not_enrolled" | "unknown";

export interface CaqhProviderStatus {
  providerId: number;
  name: string;
  npi: string | null;
  caqhId: string | null;
  lastAttested: string | null;
  nextAttestationDue: string | null;
  daysLeft: number | null;
  lastSynced: string | null;
  attestationStatus: string | null;
  status: CaqhProviderStatusCode;
}

export interface CaqhStatusResponse {
  stats: { withCaqh: number; withoutCaqh: number; attestSoon: number; overdue: number; unknown: number };
  items: CaqhProviderStatus[];
}

export interface SyncRun {
  id: number;
  triggerType: string;
  status: "success" | "partial" | "failed" | "running";
  providersChecked: number;
  providersUpdated: number;
  changes: string[];
  durationSec: number;
  startedAt: string;
}

export interface SyncDeferredResponse {
  integration: "deferred";
  message: string;
  providerId: number | null;
}

export type RuleChannel = "email" | "email+sms" | "email+sms+call" | "email+manager";
export type RuleTemplate = "friendly" | "standard" | "urgent" | "final" | "escalation";

export interface RuleItem {
  id: number;
  name: string;
  daysBefore: number;
  channel: RuleChannel;
  template: RuleTemplate;
  enabled: boolean;
  lastTriggeredAt: string | null;
  sentCount: number;
}

/** Rule being edited; id is null for a new rule. */
export interface RuleDraft {
  id: number | null;
  name: string;
  daysBefore: number;
  channel: RuleChannel;
  template: RuleTemplate;
  enabled: boolean;
}

export interface ReminderLogItem {
  id: number;
  ruleId: number | null;
  ruleName: string | null;
  providerId: number;
  providerName: string | null;
  channel: string;
  template: string;
  dueDate: string | null;
  status: "queued" | "sent" | "failed" | "dry_run";
  triggeredBy: string;
  sentAt: string;
}

export type AttestationStatusCode = "expired" | "urgent" | "critical" | "warning" | "info" | "ok";

export interface AttestationItem {
  providerId: number;
  name: string;
  email: string | null;
  caqhId: string | null;
  lastAttested: string | null;
  dueDate: string | null;
  daysUntilDue: number;
  status: AttestationStatusCode;
}

export interface AttestationsResponse {
  stats: { expired: number; urgent: number; warning: number; upcoming: number; missingAttestationDate: number };
  items: AttestationItem[];
}

export interface RuleRunMatch {
  ruleId: number;
  ruleName: string;
  providerId: number;
  providerName: string;
  daysLeft: number;
  dueDate: string | null;
  channel: string;
  template: string;
  alreadySent: boolean;
}

export interface RuleRunResult {
  dryRun: boolean;
  rulesEvaluated: number;
  remindersQueued: number;
  matches: RuleRunMatch[];
  /** smtp = reminder emails were sent; deferred = email sending is switched off on the server */
  integration: "smtp" | "deferred";
  remindersSent: number;
  remindersFailed: number;
}

// ---- Organization ----
export interface Practice {
  id: number;
  name: string;
}

export interface LocationItem {
  id: number;
  practiceId: number | null;
  practiceName: string | null;
  name: string;
  active: boolean;
}

// ---- Provider import (POST /providers/import) ----
export interface ImportProviderRow {
  rowIndex?: number;
  caqhId?: string;
  npi?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  suffix?: string;
  specialty?: string;
  taxonomy?: string;
  dob?: string;
  gender?: string;
  email?: string;
  phone?: string;
  license?: string;
  licenseState?: string;
  licenseExpiration?: string;
  licenseIssued?: string;
  licenseStatus?: string;
  dea?: string;
  deaExpiration?: string;
  malpracticeCarrier?: string;
  malpracticeExpiration?: string;
  boardCert?: string;
  boardCertExpiration?: string;
  lastAttestation?: string;
  attestationStatus?: string;
  profileStatus?: string;
  authStatus?: string;
}

export interface ImportRequest {
  practiceId?: number;
  locationId?: number;
  providers: ImportProviderRow[];
}

export interface ImportResponse {
  created: { id: number; name: string }[];
  skipped: { rowIndex: number; name: string; reason: string }[];
}

// ---- CAQH lookup ("Import from CAQH", CAQH Config) ----
export type CaqhLookupMode = "mock" | "real";

export interface CaqhLookupConfig {
  mode: CaqhLookupMode;
  apiUrl: string | null;
  hasApiKey: boolean;
  orgId: string | null;
  mockCaqhIds: string[];
}

export interface CaqhLookupTest {
  ok: boolean;
  mode: CaqhLookupMode;
  message: string;
}

export interface CaqhLookupDocument {
  id: string;
  type: string;
  label: string;
  fileName: string;
  status: string;
  expires: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  sizeKB: number | null;
  coverageLimit: string | null;
}

export interface CaqhProfile {
  caqhId: string;
  firstName: string;
  lastName: string;
  suffix: string | null;
  specialty: string | null;
  npi: string | null;
  email: string | null;
  phone: string | null;
  license: string | null;
  licenseState: string | null;
  licenseExpires: string | null;
  deaNumber: string | null;
  deaExpires: string | null;
  boardCert: { board: string; status: string; expires: string | null } | null;
  taxonomy: string | null;
  gender: string | null;
  dob: string | null;
  address: { street: string; city: string; state: string; zip: string } | null;
  educationHistory: { school: string; degree: string; year: string }[] | null;
  workHistory: { employer: string; title: string; startDate: string; endDate: string | null }[] | null;
  malpractice: { carrier: string; policyNumber: string | null; expires: string | null; limit: string | null } | null;
  docCount: number | null;
  attestedAt: string | null;
  documents: CaqhLookupDocument[];
  source: CaqhLookupMode;
}

export interface CaqhImportResponse {
  providerId: number;
  providerName: string;
  documentsImported: number;
}
