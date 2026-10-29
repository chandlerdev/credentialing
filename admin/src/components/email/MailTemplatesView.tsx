"use client";

import { useRef, useState } from "react";
import { AsyncBoundary } from "@/components/AsyncState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { matchesSearch } from "@/lib/search";
import { cleanSearch } from "@/lib/utils";
import { useToast } from "@/stores/toast";

export type MailTemplateType = "provider_link" | "enrollment_approved" | "document_request" | "payer_communication";

interface MailTemplateItem {
  id: number;
  type: MailTemplateType;
  name: string;
  subject: string;
  body: string;
  builtIn: boolean;
  inUse: boolean;
  variables: string[];
}

interface VariableInfo {
  key: string;
  label: string;
  required: boolean;
}

interface MailTemplateList {
  type: MailTemplateType;
  templates: MailTemplateItem[];
  variables: VariableInfo[];
}

const COPY: Record<MailTemplateType, { title: string; subtitle: string; used: string; icon: string }> = {
  provider_link: {
    title: "Provider Link Templates",
    subtitle: "The email a provider receives when you send them a secure link (Add Provider → Send Link).",
    used: "Send Link emails use this template",
    icon: "MailPlus",
  },
  document_request: {
    title: "Document Request Templates",
    subtitle: "The email a provider receives when you request missing documents from their page (Request Documents).",
    used: "Document request emails use this template",
    icon: "FileQuestion",
  },
  payer_communication: {
    title: "Payer Communication Templates",
    subtitle: "The emails to the payers from Payer Submission (Email). Every template here is offered in the Email dialog, filled with the provider's and payer's details.",
    used: "",
    icon: "Building2",
  },
  enrollment_approved: {
    title: "Enrollment Mail Templates",
    subtitle: "The email a provider receives when one of their enrollments is approved.",
    used: "Approval emails use this template",
    icon: "MailCheck",
  },
};

/** Sample values for the preview. */
const SAMPLE: Record<string, string> = {
  provider_first_name: "Jose",
  provider_name: "Jose Davis",
  upload_link: "https://your-site/admin/upload/•••",
  pin: "482913",
  link_expires: "10/19/2026",
  missing_document_list: "- Medical License\n- DEA Certificate",
  requested_document_list: "- Medical License\n- DEA Certificate",
  organization_name: "Your Organization",
  payer_name: "BCBS TX",
  effective_date: "11/01/2026",
  status: "Approved",
  credentials: "MD",
  npi: "1234567890",
  specialty: "Family Medicine",
  caqh_id: "15238870",
  group_npi: "1987654321",
  tin: "74-1234567",
  practice: "Austin Family Clinic",
  address: "100 Main St, Austin, TX 78701",
  case_no: "CASE-7781",
  reference_no: "REF-55120",
  payer_provider_id: "P-448812",
  submitted_date: "Oct 1, 2026",
  days_since_submit: "28",
  current_step: "Review",
  sender_name: "Jake Zebaida",
};
const fill = (text: string) => text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => SAMPLE[k] ?? m);

/** Admin → Provider Link Templates / Enrollment Mail Templates: add, edit, delete and pick the template in use. */
export function MailTemplatesView({ type, embedded = false }: { type: MailTemplateType; /** inside Custom Templates (no page title) */ embedded?: boolean }) {
  const toast = useToast();
  const copy = COPY[type];
  // payer communication: every template is offered when emailing a payer (none is "the one in use")
  const pickable = type !== "payer_communication";
  const list = useAsync<MailTemplateList>(() => api.get<MailTemplateList>("/mail-templates", { type }), [type]);
  const [editing, setEditing] = useState<MailTemplateItem | "new" | null>(null);
  const [deleting, setDeleting] = useState<MailTemplateItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [using, setUsing] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState<MailTemplateItem | null>(null);
  const [search, setSearch] = useState("");

  const templates = (list.data?.templates || []).filter((t) => matchesSearch(search, t.name, t.subject));
  const variables = list.data?.variables || [];

  const use = async (t: MailTemplateItem) => {
    setUsing(t.id);
    try {
      await api.post("/mail-templates/" + t.id + "/use");
      toast("“" + t.name + "” is now the template in use");
      list.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setUsing(null);
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete("/mail-templates/" + deleting.id);
      toast("Template deleted");
      setDeleting(null);
      list.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div>
      {embedded ? (
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <p className="text-sm text-ink-light">{copy.subtitle}</p>
          <button onClick={() => setEditing("new")} className="btn btn-primary">
            <Icon name="Plus" size={14} /> Add Template
          </button>
        </div>
      ) : (
        <PageHeader
          title={copy.title}
          subtitle={copy.subtitle}
          actions={
            <button onClick={() => setEditing("new")} className="btn btn-primary">
              <Icon name="Plus" size={14} /> Add Template
            </button>
          }
        />
      )}
      <div className="relative mb-4">
        <Icon name="Search" size={14} className="absolute" style={{ left: 10, top: 10, color: "var(--ink-faint)" }} />
        <input value={search} onChange={(e) => setSearch(cleanSearch(e.target.value))} placeholder={"Search " + copy.title.toLowerCase() + "..."} className="input" style={{ paddingLeft: 32 }} aria-label="Search templates" />
      </div>
      <AsyncBoundary loading={list.loading && !list.data} error={list.error} onRetry={list.reload}>
        {templates.length === 0 ? (
          <div className="card card-pad text-center text-sm text-ink-light py-10">{search ? "No templates match “" + search.trim() + "”" : "No templates yet — click “Add Template”."}</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {templates.map((t) => (
              <div
                key={t.id}
                className="card flex flex-col"
                style={pickable && t.inUse ? { borderColor: "var(--accent)", boxShadow: "0 0 0 1px var(--accent)" } : undefined}
              >
                <div className="p-4 pb-3 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--bg-soft-2)" }}>
                    <Icon name={copy.icon} size={16} style={{ color: "var(--accent)" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display font-semibold text-ink truncate">{t.name}</h3>
                      {t.builtIn && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: "var(--bg-soft-2)", color: "var(--ink-light)" }}>Built-in</span>
                      )}
                      {pickable && t.inUse && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded inline-flex items-center gap-1" style={{ background: "var(--accent)", color: "white" }}>
                          <Icon name="Check" size={10} /> In use
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-light mt-0.5 truncate" title={t.subject}>
                      <span className="text-ink-faint">Subject:</span> {t.subject}
                    </div>
                  </div>
                </div>
                <div className="px-4 flex-1">
                  <div className="text-xs text-ink-light whitespace-pre-wrap rounded-md p-3 border border-line" style={{ background: "var(--bg-soft)", maxHeight: 132, overflow: "hidden", position: "relative" }}>
                    {t.body}
                  </div>
                </div>
                <div className="p-4 pt-3 flex items-center gap-2 flex-wrap">
                  {!pickable ? null : t.inUse ? (
                    <span className="text-xs text-ink-light inline-flex items-center gap-1"><Icon name="CheckCircle2" size={13} style={{ color: "var(--success)" }} /> {copy.used}</span>
                  ) : (
                    <button onClick={() => use(t)} disabled={using !== null} className="btn btn-primary" style={{ fontSize: 12, padding: "6px 12px" }}>
                      {using === t.id ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Send" size={12} />} Use this template
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => setPreviewing(t)} className="btn btn-ghost text-xs" title="Preview with sample values">
                      <Icon name="Eye" size={12} /> Preview
                    </button>
                    {(
                      <>
                        <button onClick={() => setEditing(t)} className="btn btn-ghost text-xs" aria-label={"Edit " + t.name}>
                          <Icon name="Pencil" size={12} /> Edit
                        </button>
                        <button onClick={() => setDeleting(t)} className="btn btn-ghost text-xs" style={{ color: "var(--danger)" }} aria-label={"Delete " + t.name}>
                          <Icon name="Trash2" size={12} /> Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </AsyncBoundary>

      {editing && (
        <TemplateModal
          type={type}
          template={editing === "new" ? null : editing}
          variables={variables}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      )}
      {previewing && (
        <Modal title={"Preview — " + previewing.name} onClose={() => setPreviewing(null)} maxWidth={620}>
          <EmailPreview subject={previewing.subject} body={previewing.body} />
          <div className="text-[11px] text-ink-faint mt-3">Shown with sample values; the real email uses the provider&apos;s details.</div>
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete template"
          message={
            <>
              Delete <strong>{deleting.name}</strong>?{deleting.builtIn ? " It is removed for your organization only." : ""}{pickable && deleting.inUse ? " It is the template in use — emails will use the first template in the list until you pick another." : ""}
            </>
          }
          busy={deleteBusy}
          onConfirm={doDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function EmailPreview({ subject, body }: { subject: string; body: string }) {
  return (
    <div className="rounded-lg border border-line overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line text-sm" style={{ background: "var(--bg-soft)" }}>
        <span className="text-ink-faint">Subject:</span> <span className="font-medium text-ink">{fill(subject)}</span>
      </div>
      <div className="px-4 py-3 text-sm text-ink whitespace-pre-wrap" style={{ maxHeight: 340, overflowY: "auto" }}>{fill(body)}</div>
    </div>
  );
}

function TemplateModal({
  type,
  template,
  variables,
  onClose,
  onSaved,
}: {
  type: MailTemplateType;
  template: MailTemplateItem | null;
  variables: VariableInfo[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(template?.name || "");
  const [subject, setSubject] = useState(template?.subject || "");
  const [body, setBody] = useState(template?.body || "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<"subject" | "body">("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  /** Puts {{key}} where the cursor is in the subject or the message. */
  const insert = (key: string) => {
    const token = "{{" + key + "}}";
    const el = focus === "subject" ? subjectRef.current : bodyRef.current;
    const value = focus === "subject" ? subject : body;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    if (focus === "subject") setSubject(next);
    else setBody(next);
    setErrors((e) => ({ ...e, [focus]: "" }));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = "Template name is required (2+ characters)";
    if (!subject.trim()) e.subject = "Subject is required";
    if (!body.trim()) e.body = "Message is required";
    for (const v of variables.filter((x) => x.required)) {
      if (!e.body && !body.includes("{{" + v.key + "}}")) e.body = "The message must include {{" + v.key + "}} (" + v.label + ")";
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const payload = { type, name: name.trim(), subject: subject.trim(), body };
      if (template) await api.put("/mail-templates/" + template.id, payload);
      else await api.post("/mail-templates", payload);
      toast(template ? "Template updated" : "Template added");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={template ? "Edit Template" : "Add Template"} onClose={busy ? undefined : onClose} maxWidth={760}>
      <div className="space-y-3">
        {template?.builtIn && (
          <div className="text-xs text-ink-light rounded-md px-3 py-2" style={{ background: "var(--bg-soft)" }}>
            This is a built-in template: your changes apply to your organization only.
          </div>
        )}
        <Field label="Template Name" required error={errors.name}>
          <input value={name} onChange={(e) => { setName(e.target.value.replace(/^\s+/, "")); setErrors((x) => ({ ...x, name: "" })); }} className="input" maxLength={150} placeholder="e.g. Friendly invitation" autoFocus />
        </Field>
        <Field label="Subject" required error={errors.subject}>
          <input
            ref={subjectRef}
            value={subject}
            onFocus={() => setFocus("subject")}
            onChange={(e) => { setSubject(e.target.value); setErrors((x) => ({ ...x, subject: "" })); }}
            className="input"
            maxLength={255}
            placeholder="e.g. {{organization_name}}: please complete your profile"
          />
        </Field>
        <div>
          <div className="label mb-1">Placeholders <span className="text-ink-faint font-normal">— click to insert where the cursor is</span></div>
          <div className="flex flex-wrap gap-1.5">
            {variables.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => insert(v.key)}
                className="text-[11px] font-mono rounded-full px-2.5 py-1 border transition-colors hover:border-accent"
                style={{ background: "var(--bg-soft)", borderColor: v.required ? "var(--accent)" : "var(--line)", color: "var(--ink)" }}
                title={v.label + (v.required ? " (required)" : "")}
              >
                {"{{" + v.key + "}}"}{v.required && <span style={{ color: "var(--danger)" }}> *</span>}
              </button>
            ))}
          </div>
        </div>
        <Field label="Message" required error={errors.body}>
          <textarea
            ref={bodyRef}
            value={body}
            onFocus={() => setFocus("body")}
            onChange={(e) => { setBody(e.target.value); setErrors((x) => ({ ...x, body: "" })); }}
            className="input font-mono text-xs"
            rows={11}
            maxLength={10000}
            placeholder={"Hi {{provider_first_name}},\n\n..."}
          />
        </Field>
        <div>
          <div className="label mb-1">Preview</div>
          <EmailPreview subject={subject || "(no subject)"} body={body || "(empty message)"} />
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={save} className="btn btn-primary" disabled={busy}>
            {busy ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Save" size={13} />} {template ? "Update" : "Add Template"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
