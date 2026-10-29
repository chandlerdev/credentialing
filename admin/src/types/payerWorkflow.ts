// Payer Submission: the payers assigned to a provider and their credentialing workflows (/payer-workflows).

export interface WfField {
  key: string;
  label: string;
  type: "text" | "date";
}

export interface WfStep {
  key: string;
  phase: string;
  title: string;
  short: string;
  owner?: string;
  slaDays?: number | null;
  description: string;
  methods?: string[];
  tasks: string[];
  fields?: WfField[];
  actions?: ("portal" | "call" | "email" | "caqh")[];
  links?: string[];
  tip?: string;
  template?: string;
  milestone?: string;
  showDocuments?: boolean;
  showMaintenance?: boolean;
  showDevDeadline?: boolean;
}

export interface WfMaintenance {
  key: string;
  label: string;
  from: string;
  everyDays?: number;
  everyMonths?: number;
}

export interface Workflow {
  label: string;
  standard?: string;
  etaDays?: number;
  steps: WfStep[];
  documents: string[];
  maintenance?: WfMaintenance[];
}

export interface EmailTemplateDef {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export interface WorkflowMeta {
  followUpCadenceDays: number;
  links: Record<string, { label: string; url: string }>;
  workflows: Record<string, Workflow>;
  emailTemplates: EmailTemplateDef[];
  /* attended: the payer was reached (notes are logged); else a next follow-up is set */
  callStatuses: { label: string; attended: boolean }[];
}

export interface PayerCard {
  enrollmentId: number;
  payerId: number;
  name: string;
  fullName: string | null;
  category: string | null;
  color: string | null;
  logo: string | null;
  initials: string;
  avgTatDays: number | null;
  integration: string | null;
  appForm: string | null;
  portalUrl: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  workflow: "commercial" | "medicare" | "medicaid";
  workflowLabel: string;
  step: number;
  totalSteps: number;
  stepShort: string;
  statusLabel: string;
  /** active | ok */
  statusTone: string;
  approved: boolean;
  enrollmentStatus: string;
}

export interface WfLogItem {
  id: number;
  /** call | email | stage | task | field | file */
  type: string;
  text: string;
  at: string;
  by: string | null;
}

export interface PayerFlow {
  card: PayerCard;
  provider: { id: number; name: string; credentials: string | null; npi: string | null; caqhId: string | null; email: string | null };
  step: number;
  method: "portal" | "phone" | null;
  tasks: Record<string, Record<string, boolean>>;
  fields: Record<string, string>;
  docs: Record<string, { fileId?: number; file?: string; caqh?: boolean; at?: string }>;
  stepStarted: Record<string, string>;
  log: WfLogItem[];
  emailVars: Record<string, string>;
  senderName: string | null;
  /* the enrollment's Last / Next Follow Up dates (set by each logged call or e-mail) */
  lastFollowUp: string | null;
  nextFollowUp: string | null;
}
