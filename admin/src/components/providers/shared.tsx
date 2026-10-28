"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cleanSearch } from "@/lib/utils";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import type { ClientItem, LocationItem, PracticeItem, ProviderStatus } from "@/types/providers";

// ---------- Constants ----------

/** Provider status labels (API enum; prototype labels draft as "Pending"). */
export const PROVIDER_STATUS_OPTIONS: { id: ProviderStatus; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "draft", label: "Pending" },
  { id: "in_progress", label: "In Progress" },
  { id: "on_hold", label: "On Hold" },
  { id: "terminated", label: "Terminated" },
];

export const providerStatusLabel = (s: string) => PROVIDER_STATUS_OPTIONS.find((o) => o.id === s)?.label || s;

/** Prototype ProvidersView maps provider status onto the enrollment STATUS pill keys. */
export const listStatusKey = (s: string) =>
  s === "active" ? "approved" : s === "draft" ? "draft" : s === "on_hold" ? "on_hold" : s === "terminated" ? "terminated" : "in_progress";

/** License states offered by the prototype's ProviderEditModal. */
export const EDIT_LICENSE_STATES = ["TX", "CA", "NY", "FL", "IL", "PA", "MA", "GA", "NC", "WA", "OH", "MI", "NJ", "VA", "AZ", "TN", "IN", "MO", "MD", "WI", "CO", "MN", "SC", "AL", "LA"];

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const NPI_RE = /^\d{10}$/;

/** Max upload size per file (API: 25 MB). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Provider documents (Upload / Replace, Add More Document): PDF, Word, JPG or PNG. */
export const DOC_UPLOAD_EXT = ["pdf", "doc", "docx", "jpg", "jpeg", "png"];
export const ALLOWED_EXT = ["pdf", "png", "jpg", "jpeg", "gif", "webp", "tif", "tiff", "doc", "docx", "xls", "xlsx", "csv", "txt", "heic"];
export const fileExt = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

// ---------- Prototype "Field" (label + value display) ----------

export function ValField({ label, val }: { label: string; val?: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-medium text-ink-faint uppercase tracking-wider">{label}</div>
      <div className="text-sm text-ink mt-0.5">{val || "—"}</div>
    </div>
  );
}

// ---------- StatusDropdown (prototype L1853, now interactive) ----------

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  active: { label: "Active", bg: "var(--success-soft)", color: "#059669" },
  draft: { label: "Pending", bg: "var(--warn-soft)", color: "#a16207" },
  in_progress: { label: "In Progress", bg: "var(--info-soft)", color: "#1d4ed8" },
  on_hold: { label: "On Hold", bg: "var(--warn-soft)", color: "#a16207" },
  terminated: { label: "Terminated", bg: "var(--danger-soft)", color: "#991b1b" },
};

export function StatusDropdown({ status, disabled, busy, onChange }: { status: string; disabled?: boolean; busy?: boolean; onChange?: (s: ProviderStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const s = STATUS_STYLE[status] || STATUS_STYLE.draft;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium text-sm"
        style={{ background: s.bg, color: s.color, cursor: disabled ? "default" : "pointer" }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {busy ? <span className="loader" style={{ width: 12, height: 12 }} /> : <Icon name="CheckCircle2" size={12} />} {s.label} {!disabled && <Icon name="ChevronDown" size={12} />}
      </button>
      {open && (
        <div className="card absolute right-0 mt-1 py-1 z-20" style={{ minWidth: 160 }} role="listbox">
          {PROVIDER_STATUS_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === status}
              onClick={() => {
                setOpen(false);
                if (o.id !== status) onChange?.(o.id);
              }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-soft flex items-center gap-2"
            >
              <span className="w-2 h-2 rounded-full" style={{ background: STATUS_STYLE[o.id].color }} />
              <span className="flex-1">{o.label}</span>
              {o.id === status && <Icon name="Check" size={12} className="text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Org structure (client → practice → location cascade) ----------

export interface OrgStructure {
  clients: ClientItem[];
  practices: PracticeItem[];
  locations: LocationItem[];
}

/** orgId: a super admin working on one organization (its clients, practices and locations). */
export function useOrgStructure(enabled = true, orgId?: number | null) {
  return useAsync<OrgStructure>(
    enabled
      ? async () => {
          const opts = orgId != null ? { orgId } : undefined;
          const [clients, practices, locations] = await Promise.all([
            api.get<ClientItem[]>("/clients", undefined, opts),
            api.get<PracticeItem[]>("/practices", undefined, opts),
            api.get<LocationItem[]>("/locations", undefined, opts),
          ]);
          return { clients, practices, locations };
        }
      : null,
    [enabled, orgId]
  );
}

export function useLocations(enabled = true) {
  return useAsync<LocationItem[]>(enabled ? () => api.get<LocationItem[]>("/locations") : null, [enabled]);
}

// ---------- Printing (prototype exportPDF) ----------

export function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Opens a printable window (same CSS as the prototype's exportPDF). Returns false when the popup is blocked. */
export function printHtml(title: string, contentHtml: string): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  const css =
    "body { font-family: -apple-system, sans-serif; padding: 32px; color: #0f172a; line-height: 1.5; }" +
    " h1 { font-size: 24px; margin-bottom: 8px; }" +
    " @media print { body { padding: 0; } }";
  const closeScript = "<" + "/script>";
  win.document.open();
  win.document.write(
    "<!doctype html><html><head><title>" + esc(title) + "</title><style>" + css + "</style></head><body>" + contentHtml +
      "<script>setTimeout(function(){window.print();}, 300);" + closeScript + "</body></html>"
  );
  win.document.close();
  return true;
}

/** Search box used in prototype page headers. */
export function SearchInput({ value, onChange, placeholder, width }: { value: string; onChange: (v: string) => void; placeholder: string; width?: number }) {
  return (
    <div className="relative">
      <Icon name="Search" size={14} className="absolute" style={{ left: 10, top: 10, color: "var(--ink-faint)" }} />
      <input value={value} onChange={(e) => onChange(cleanSearch(e.target.value))} placeholder={placeholder} className="input" style={{ paddingLeft: 32, width, maxWidth: "100%" }} />
    </div>
  );
}
