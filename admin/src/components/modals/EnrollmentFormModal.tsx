"use client";

import { Select } from "@/components/Select";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { Field } from "@/components/Field";
import { AlertBox } from "@/components/AlertBox";
import { Loading } from "@/components/AsyncState";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useToast } from "@/stores/toast";
import { useAsync } from "@/lib/hooks";
import { todayISO } from "@/lib/utils";
import { fetchProvidersLite, providerName, STATUS_OPTIONS } from "@/components/enrollments/shared";
import type { Enrollment, EnrollmentRequest, EnrollmentStatus, Payer } from "@/types/enrollments";

/** The later of two ISO dates (an empty one is ignored). */
const laterOf = (a: string, b: string) => (b && b > a ? b : a);

interface FormState {
  providerId: string;
  payerId: string;
  status: EnrollmentStatus;
  submittedDate: string;
  /** the approved date (asked when the status is Approved) */
  effectiveDate: string;
  /** the last follow-up with the payer (today or earlier) */
  followUpDate: string;
  /** the next follow-up (today or later) */
  nextFollowUpDate: string;
  estApprovedDate: string;
  notes: string;
}

/**
 * Port of the prototype EnrollmentFormModal (create / edit).
 * Saves through POST/PUT /enrollments and returns the saved row.
 */
export function EnrollmentFormModal({
  enrollment,
  defaultProviderId,
  onSaved,
  onClose,
}: {
  enrollment: Enrollment | null;
  /** Prefills (and keeps) the provider when starting from a provider record. */
  defaultProviderId?: number;
  onSaved: (e: Enrollment) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() =>
    enrollment
      ? {
          providerId: String(enrollment.providerId),
          payerId: String(enrollment.payerId),
          status: enrollment.status,
          submittedDate: enrollment.submittedDate || "",
          effectiveDate: enrollment.effectiveDate || "",
          followUpDate: enrollment.followUpDate || "",
          nextFollowUpDate: enrollment.nextFollowUpDate || "",
          estApprovedDate: enrollment.estApprovedDate || "",
          notes: enrollment.notes || "",
        }
      : { providerId: defaultProviderId ? String(defaultProviderId) : "", payerId: "", status: "draft", submittedDate: "", effectiveDate: "", followUpDate: "", nextFollowUpDate: "", estApprovedDate: "", notes: "" }
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const providers = useAsync(fetchProvidersLite, []);
  // every payer the super admin added (plus the organization's own), not only the ones switched on
  const payers = useAsync(() => api.get<Payer[]>("/payers", { activeOnly: false, scope: "enrollment" }), []);
  const payerOptions = (payers.data || []).filter((p) => p.active || String(p.id) === form.payerId);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.providerId) e.providerId = "Required";
    if (!form.payerId) e.payerId = "Required";
    if (!form.status) e.status = "Required";
    const today = todayISO();
    // Last Follow Up: any date on or after the submitted date. Next Follow Up and Est Approved: today or later (an unchanged earlier date of an existing enrollment is kept)
    const approvedStatus = form.status === "approved";
    if (!approvedStatus && form.estApprovedDate && form.estApprovedDate < today && form.estApprovedDate !== (enrollment?.estApprovedDate || "")) e.estApprovedDate = "Choose today or a later date";
    // follow-up and estimated approval dates are on or after the submitted date too
    if (!e.followUpDate && form.submittedDate && form.followUpDate && form.followUpDate < form.submittedDate) e.followUpDate = "Last follow up date must be on or after the submitted date";
    if (!approvedStatus && !e.nextFollowUpDate && form.submittedDate && form.nextFollowUpDate && form.nextFollowUpDate < form.submittedDate) e.nextFollowUpDate = "Next follow up date must be on or after the submitted date";
    if (!approvedStatus && form.nextFollowUpDate && form.nextFollowUpDate < today && form.nextFollowUpDate !== (enrollment?.nextFollowUpDate || "")) e.nextFollowUpDate = "Choose today or a later date";
    if (!approvedStatus && !e.estApprovedDate && form.submittedDate && form.estApprovedDate && form.estApprovedDate < form.submittedDate) e.estApprovedDate = "Estimated approval date must be on or after the submitted date";
    // Approved date: required when the status is Approved
    if (form.status === "approved") {
      if (!form.effectiveDate) e.effectiveDate = "Approved date is required";
      else if (form.submittedDate && form.effectiveDate < form.submittedDate) e.effectiveDate = "Approved date must be on or after the submitted date";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    setFormError(null);
    const body: EnrollmentRequest = {
      providerId: Number(form.providerId),
      payerId: Number(form.payerId),
      status: form.status,
      submittedDate: form.submittedDate || null,
      effectiveDate: form.status === "approved" ? form.effectiveDate || null : enrollment?.effectiveDate || null,
      // an approved enrollment has no follow-up / estimated approval date
      followUpDate: form.followUpDate || null,
      // an approved enrollment has no next follow-up
      nextFollowUpDate: form.status === "approved" ? null : form.nextFollowUpDate || null,
      estApprovedDate: form.status === "approved" ? null : form.estApprovedDate || null,
      notes: form.notes || undefined,
    };
    if (enrollment) {
      // PUT is a full replace: keep the fields this form doesn't edit.
      body.applicationType = enrollment.applicationType;
      if (enrollment.practiceId != null && Number(form.providerId) === enrollment.providerId) body.practiceId = enrollment.practiceId;
      if (enrollment.formId != null && Number(form.payerId) === enrollment.payerId) body.formId = enrollment.formId;
      if (enrollment.assignedUserId != null) body.assignedUserId = enrollment.assignedUserId;
    }
    try {
      const saved = enrollment ? await api.put<Enrollment>("/enrollments/" + enrollment.id, body) : await api.post<Enrollment>("/enrollments", body);
      toast(enrollment ? "Enrollment updated" : "Enrollment created");
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const loadingLists = providers.loading || payers.loading;

  return (
    <Modal title={enrollment ? "Edit Enrollment" : "New Enrollment"} onClose={onClose} maxWidth={520}>
      {loadingLists ? (
        <Loading />
      ) : (
        <div className="space-y-3">
          {(providers.error || payers.error) && <AlertBox>{providers.error || payers.error}</AlertBox>}
          <Field label="Provider *" error={errors.providerId}>
            <Select value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })} className="input" disabled={!!defaultProviderId && !enrollment}>
              <option value="">— Select —</option>
              {(providers.data || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {providerName(p)} — NPI {p.npi || "—"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Payer *" error={errors.payerId}>
            <Select value={form.payerId} onChange={(e) => setForm({ ...form, payerId: e.target.value })} className="input">
              <option value="">— Select —</option>
              {payerOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status *" error={errors.status}>
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EnrollmentStatus })} className="input">
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Submitted Date" error={errors.submittedDate}>
              <input
                type="date"
                max={form.status === "approved" && form.effectiveDate ? form.effectiveDate : undefined}
                value={form.submittedDate || ""}
                onChange={(e) => setForm({ ...form, submittedDate: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Last Follow Up Date" error={errors.followUpDate}>
              {/* when the payer was last followed up with: any date on or after the submitted date */}
              <input
                type="date"
                min={form.submittedDate || undefined}
                value={form.followUpDate || ""}
                onChange={(e) => setForm({ ...form, followUpDate: e.target.value })}
                className="input"
                aria-label="Last Follow Up Date"
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Next Follow Up Date" error={errors.nextFollowUpDate}>
              <input
                type="date"
                min={laterOf(todayISO(), form.submittedDate)}
                value={form.status === "approved" ? "" : form.nextFollowUpDate || ""}
                onChange={(e) => setForm({ ...form, nextFollowUpDate: e.target.value })}
                className="input"
                disabled={form.status === "approved"}
                title={form.status === "approved" ? "Not used for an approved enrollment" : undefined}
                aria-label="Next Follow Up Date"
              />
            </Field>
            <Field label="Estimated Approval Date" error={errors.estApprovedDate}>
              <input type="date" min={laterOf(todayISO(), form.submittedDate)} value={form.status === "approved" ? "" : form.estApprovedDate || ""} onChange={(e) => setForm({ ...form, estApprovedDate: e.target.value })} className="input" disabled={form.status === "approved"} title={form.status === "approved" ? "Not used for an approved enrollment" : undefined} />
            </Field>
          </div>
          {form.status === "approved" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Approved Date *" error={errors.effectiveDate}>
                {/* on or after the submitted date */}
                <input type="date" min={form.submittedDate || undefined} value={form.effectiveDate || ""} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} className="input" />
              </Field>
            </div>
          )}
          <Field label="Notes" error={errors.notes}>
            <textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input" rows={3} />
          </Field>
          {formError && <AlertBox>{formError}</AlertBox>}
          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <button onClick={onClose} className="btn btn-secondary" disabled={saving}>
              Cancel
            </button>
            <button onClick={submit} className="btn btn-primary" disabled={saving}>
              {saving ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Save" size={13} />} {enrollment ? "Update" : "Create Enrollment"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
