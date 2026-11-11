"use client";

import { useState } from "react";
import { useEmailCheck } from "@/lib/useEmailCheck";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { ResultAlert, mailResult } from "@/components/ResultAlert";
import { OrgAssignmentFields, assignmentPayload, type OrgAssignment, placementAssignment } from "@/components/OrgAssignmentFields";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useToast } from "@/stores/toast";
import { EMAIL_RE } from "@/components/providers/shared";
import type { InviteResponse } from "@/types/providers";

/**
 * Prototype SendLinkModal (L1634).
 * - Without `provider`: AddProvider → "Send Link to Provider" → POST /providers/invite-new (creates a draft provider).
 * - With `provider`: Provider detail "Send Link" → POST /providers/{id}/invites.
 * The provider can be assigned to a practice / location (optional) before the link is sent.
 */
export function SendLinkModal({
  provider,
  onClose,
  onBack,
  onSent,
  placement,
}: {
  /** Organization screen: the new provider goes under this practice / location (pre-filled). */
  placement?: { practiceId: number | null; locationId: number | null };
  provider?: { id: number; firstName: string; lastName: string; email: string | null; practiceId?: number | null; locationId?: number | null };
  onClose: () => void;
  onBack?: () => void;
  onSent: (invite: InviteResponse) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ firstName: provider?.firstName || "", lastName: provider?.lastName || "", email: provider?.email || "" });
  const emailTaken = useEmailCheck(form.email, { kind: "provider", id: provider?.id });
  const [assignment, setAssignment] = useState<OrgAssignment>(
    !provider && placement
      ? placementAssignment(placement)
      : {
          practiceId: provider?.practiceId ? String(provider.practiceId) : "",
          locationId: provider?.locationId ? String(provider.locationId) : "",
        }
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<InviteResponse | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSend = async () => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = "Required";
    if (!form.lastName.trim()) e.lastName = "Required";
    if (!form.email.trim()) e.email = "Required";
    else if (!EMAIL_RE.test(form.email.trim())) e.email = "Valid email required";
    else if (emailTaken) e.email = emailTaken;
    // practice / location are optional (they can be set later on the provider)
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const res = provider
        ? await api.post<InviteResponse>("/providers/" + provider.id + "/invites", { email: form.email.trim(), ...assignmentPayload(assignment) })
        : await api.post<InviteResponse>("/providers/invite-new", {
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            email: form.email.trim(),
            ...assignmentPayload(assignment),
          });
      setSent(res);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const back = onBack || onClose;

  // after sending: only "Mail sent" / "Failed to send email" (the link and PIN go by email)
  if (sent) {
    const r = mailResult(sent);
    return <ResultAlert {...r} onClose={() => onSent(sent)} />;
  }

  return (
    <Modal
      title="Send Secure Link to Provider"
      subtitle="They'll complete their own profile and upload documents."
      onClose={onClose}
      showBack={!!onBack}
      onBack={onBack}
      maxWidth={520}
    >
      <div className="space-y-3 mt-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="First Name" required error={errors.firstName}>
            <input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} className="input" disabled={!!provider} />
          </Field>
          <Field label="Last Name" required error={errors.lastName}>
            <input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} className="input" disabled={!!provider} />
          </Field>
        </div>
        <Field label="Email" required error={errors.email || emailTaken}>
          <input value={form.email} onChange={(e) => set("email", e.target.value)} type="email" className="input" placeholder="provider@example.com" />
        </Field>
        <OrgAssignmentFields
          value={assignment}
          onChange={(a) => {
            setAssignment(a);
            setErrors((er) => ({ ...er, practiceId: "", locationId: "" }));
          }}
          error={errors.practiceId}
          locationError={errors.locationId}
        />
        <div className="px-3 py-3 rounded-lg" style={{ background: "var(--info-soft)" }}>
          <div className="flex items-start gap-2 text-xs text-ink">
            <Icon name="Shield" size={14} style={{ color: "var(--info)", marginTop: 1 }} />
            <div>
              <div className="font-semibold mb-1">What the provider receives:</div>
              <ul className="space-y-1 text-ink-light">
                <li>· A secure link to a personal upload portal</li>
                <li>· A 6-digit PIN required to access the portal</li>
                <li>· A list of required documents and a profile form</li>
                <li>· Link expires after 7 days (auto-renewable)</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={back} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button
            onClick={handleSend}
            disabled={busy || !form.firstName || !form.lastName || !form.email}
            className="btn btn-primary"
          >
            {busy ? (
              <>
                <span className="loader" /> Sending...
              </>
            ) : (
              <>
                Send Secure Link <Icon name="Send" size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
