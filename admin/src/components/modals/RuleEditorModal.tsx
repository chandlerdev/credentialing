"use client";

import { Select } from "@/components/Select";

import { useState } from "react";
import { Field } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useToast } from "@/stores/toast";
import type { RuleChannel, RuleDraft, RuleItem, RuleTemplate } from "@/types/caqh";

export function RuleEditorModal({ rule, onClose, onSaved }: { rule: RuleDraft; onClose: () => void; onSaved: (r: RuleItem) => void }) {
  const toast = useToast();
  const [form, setForm] = useState<RuleDraft>(rule);
  const [daysText, setDaysText] = useState(String(rule.daysBefore));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const isEdit = rule.id != null;

  const save = async () => {
    const errs: Record<string, string> = {};
    const name = form.name.trim();
    const days = Number(daysText);
    if (!name) errs.name = "Rule name is required";
    else if (name.length > 100) errs.name = "Rule name must be 100 characters or fewer";
    if (daysText.trim() === "" || !Number.isInteger(days)) errs.daysBefore = "Enter a whole number of days";
    else if (days < -90 || days > 365) errs.daysBefore = "Must be between -90 and 365";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body = { name, daysBefore: days, channel: form.channel, template: form.template, enabled: form.enabled };
    setBusy(true);
    try {
      const saved = isEdit ? await api.put<RuleItem>("/caqh/attestation-rules/" + rule.id, body) : await api.post<RuleItem>("/caqh/attestation-rules", body);
      toast("Rule saved");
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError) {
        if (Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
        else if (e.status === 409) setErrors({ name: e.message || "A rule with this name already exists" });
      }
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isEdit ? "Edit Reminder Rule" : "Add Reminder Rule"} onClose={onClose} maxWidth={520}>
      <div className="space-y-3">
        <Field label="Rule Name" error={errors.name}>
          <input value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" placeholder="Enter Rule Name" />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Trigger (days before due)" error={errors.daysBefore} hint="Negative = days after expiry">
            <input type="number" min={-90} max={365} value={daysText} onChange={(e) => setDaysText(e.target.value)} className="input font-mono" />
          </Field>
          <Field label="Channel" error={errors.channel}>
            <Select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as RuleChannel })} className="input">
              <option value="email">Email only</option>
              <option value="email+sms">Email + SMS</option>
              <option value="email+sms+call">Email + SMS + Phone call</option>
              <option value="email+manager">Email + escalate to manager</option>
            </Select>
          </Field>
        </div>
        <Field label="Email template" error={errors.template}>
          <Select value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value as RuleTemplate })} className="input">
            <option value="friendly">Friendly heads-up (warm, no pressure)</option>
            <option value="standard">Standard reminder (neutral, informative)</option>
            <option value="urgent">Urgent (emphasizes consequences)</option>
            <option value="final">Final notice (last call before expiry)</option>
            <option value="escalation">Escalation (post-expiry, manager CCed)</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          Rule active
        </label>
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={save} disabled={!form.name.trim() || busy} className="btn btn-primary">
            {busy && <span className="loader" style={{ borderTopColor: "white" }}></span>} {isEdit ? "Update Rule" : "Save Rule"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
