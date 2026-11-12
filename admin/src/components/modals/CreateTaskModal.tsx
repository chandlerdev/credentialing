"use client";

import { Select } from "@/components/Select";

import { useEffect, useState } from "react";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useToast } from "@/stores/toast";

interface ProviderLite {
  id: number;
  firstName?: string;
  lastName?: string;
  name?: string;
}

export function CreateTaskModal({ onClose, onCreated, defaultProviderId }: { onClose: () => void; onCreated?: () => void; defaultProviderId?: number }) {
  const toast = useToast();
  const [providers, setProviders] = useState<ProviderLite[]>([]);
  const [form, setForm] = useState({ title: "", description: "", priority: "medium", dueDate: "", providerId: defaultProviderId ? String(defaultProviderId) : "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<ProviderLite[]>("/providers/all-lite").then(setProviders).catch(() => {});
  }, []);

  const save = async () => {
    if (!form.title.trim()) {
      setErrors({ title: "Title is required" });
      return;
    }
    setBusy(true);
    try {
      await api.post("/tasks", {
        title: form.title.trim(),
        description: form.description || null,
        priority: form.priority,
        dueDate: form.dueDate || null,
        providerId: form.providerId ? Number(form.providerId) : null,
      });
      toast("Task created");
      onCreated?.();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Create Task" subtitle="Track a credentialing task with priority and due date." onClose={onClose} maxWidth={560}>
      <div className="space-y-3">
        <Field label="Title" error={errors.title}>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={"input " + (errors.title ? "input-error" : "")} placeholder="Enter Title" autoFocus />
        </Field>
        <Field label="Description" error={errors.description}>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" rows={3} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="input">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </Field>
          <Field label="Due Date" error={errors.dueDate}>
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="input" />
          </Field>
        </div>
        <Field label="Related Provider (optional)">
          <Select value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })} className="input">
            <option value="">— None —</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={save} disabled={!form.title || busy} className="btn btn-primary">
            {busy ? <span className="loader" style={{ borderTopColor: "white" }} /> : null} Create Task <Icon name="Plus" size={13} />
          </button>
        </div>
      </div>
    </Modal>
  );
}
