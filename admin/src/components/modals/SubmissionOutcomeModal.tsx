"use client";

import { Select } from "@/components/Select";

import { useState } from "react";
import { AlertBox } from "@/components/AlertBox";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useToast } from "@/stores/toast";
import type { PayerSubmission, SubmissionOutcome } from "@/types/submissions";

/** Records the manual outcome of a queued submission (PATCH /payer-submissions/{id}). */
export function SubmissionOutcomeModal({ submission, onSaved, onClose }: { submission: PayerSubmission; onSaved: () => void; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<SubmissionOutcome>({
    status: submission.status === "queued" || submission.status === "in_progress" ? "submitted" : submission.status,
    confirmationNumber: submission.confirmationNumber || "",
    message: submission.status === "queued" ? "" : submission.message || "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setErrors({});
    setSaving(true);
    setFormError(null);
    try {
      await api.patch<PayerSubmission>("/payer-submissions/" + submission.id, {
        status: form.status,
        confirmationNumber: form.confirmationNumber?.trim() || undefined,
        message: form.message?.trim() || undefined,
      });
      toast("Submission updated");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Record Outcome" subtitle={submission.providerName + " → " + submission.payerName} onClose={onClose} maxWidth={460}>
      <div className="space-y-3">
        <Field label="Status" error={errors.status}>
          <Select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as SubmissionOutcome["status"] })}>
            <option value="submitted">Submitted</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="failed">Failed</option>
          </Select>
        </Field>
        <Field label="Confirmation Number" error={errors.confirmationNumber}>
          <input className="input font-mono" value={form.confirmationNumber || ""} onChange={(e) => setForm({ ...form, confirmationNumber: e.target.value })} placeholder="Enter Confirmation Number" />
        </Field>
        <Field label="Message" error={errors.message}>
          <textarea className="input" rows={2} value={form.message || ""} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Enter Message" />
        </Field>
        {submission.enrollmentId && form.status === "submitted" && (
          <div className="text-[11px] text-ink-light p-2 rounded" style={{ background: "var(--bg-soft)" }}>
            <Icon name="Info" size={10} className="inline mr-1" />
            The linked enrollment will move to Submitted.
          </div>
        )}
        {formError && <AlertBox>{formError}</AlertBox>}
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={saving}>
            Cancel
          </button>
          <button onClick={save} className="btn btn-primary" disabled={saving}>
            {saving ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Save" size={13} />} Update Outcome
          </button>
        </div>
      </div>
    </Modal>
  );
}
