"use client";

import { RequiredMark } from "@/components/Field";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useToast } from "@/stores/toast";
import type { ChannelItem } from "@/types/chat";

export function NewChannelModal({ onCreated, onClose }: { onCreated: (ch: ChannelItem) => void; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const normalized = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-");

  const create = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Channel name is required";
    else if (name.trim().length > 80) errs.name = "Channel name must be 80 characters or less";
    if (description.length > 255) errs.description = "Description must be 255 characters or less";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const ch = await api.post<ChannelItem>("/chat/channels", { name: name.trim(), description: description.trim() || undefined });
      onCreated(ch);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setErrors({ name: e.message || "A channel with this name already exists" });
      else if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      else toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New Channel" subtitle="Create a channel for your team" onClose={onClose} maxWidth={460}>
      <div className="space-y-3">
        <div>
          <label className="label">Channel Name<RequiredMark /></label>
          <div className="flex items-center gap-2">
            <span className="text-ink-faint">#</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={"input " + (errors.name ? "input-error" : "")} placeholder="Enter Channel Name" autoFocus maxLength={80} />
          </div>
          {name && normalized !== name && (
            <div className="text-[10px] text-ink-faint mt-1">Will be saved as: <span className="font-mono">#{normalized}</span></div>
          )}
          {errors.name && <div className="field-error">{errors.name}</div>}
        </div>
        <div>
          <label className="label">Description (optional)</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="input" placeholder="Enter Description" maxLength={255} />
          {errors.description && <div className="field-error">{errors.description}</div>}
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={create} disabled={!name.trim() || busy} className="btn btn-primary">
            {busy ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Plus" size={13} />} Create
          </button>
        </div>
      </div>
    </Modal>
  );
}
