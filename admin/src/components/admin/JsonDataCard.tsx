"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { ConfirmDialog } from "@/components/Modal";
import { api, errorMessage } from "@/lib/api";
import { useToast } from "@/stores/toast";
import { buildSampleJson } from "./sampleData";
import type { DataBundle, DataImportResult } from "@/types/admin";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

function downloadJson(payload: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/** Prototype v2 "JSON Data Management": sample file, export of the organization, import (replaces test data). */
export function JsonDataCard({ onImported }: { onImported: (res: DataImportResult) => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [pending, setPending] = useState<{ bundle: DataBundle; fileName: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<DataImportResult | null>(null);

  const downloadSample = () => {
    downloadJson(buildSampleJson(), "zmart_sample_data.json");
    toast("Downloaded sample data JSON — now click Import JSON to load it");
  };

  const exportJson = async () => {
    setExporting(true);
    try {
      const bundle = await api.get<DataBundle>("/admin/test-data/export");
      downloadJson(bundle, "zmart_backup_" + new Date().toISOString().slice(0, 10) + ".json");
      toast("Exported " + bundle.data.providers.length + " providers, " + (bundle.data.enrollments?.length || 0) + " enrollments");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setExporting(false);
    }
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast("File is larger than 20 MB", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.target?.result || "")) as DataBundle;
        if (!parsed?.data || !Array.isArray(parsed.data.providers)) {
          toast("Invalid file: missing data.providers", "error");
          return;
        }
        setPending({ bundle: parsed, fileName: file.name });
      } catch (err) {
        toast("Failed to parse JSON: " + (err instanceof Error ? err.message : String(err)), "error");
      }
    };
    reader.readAsText(file);
  };

  const runImport = async () => {
    if (!pending) return;
    setImporting(true);
    try {
      const res = await api.post<DataImportResult>("/admin/test-data/import", pending.bundle);
      setResult(res);
      onImported(res);
      toast("Imported " + res.created.providers + " providers from " + pending.fileName);
      setPending(null);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="card card-pad mb-4">
      <h3 className="font-semibold text-sm text-ink mb-2 flex items-center gap-2">
        <Icon name="Database" size={14} style={{ color: "var(--info)" }} />
        JSON Data Management
      </h3>
      <p className="text-xs text-ink-light mb-3">
        Export your organization as a JSON file for backup or sharing. Import a previously-exported file to load it as test data. Or download a pre-built sample dataset for testing.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button onClick={downloadSample} className="btn btn-secondary">
          <Icon name="FileText" size={13} /> Sample JSON
        </button>
        <button onClick={exportJson} className="btn btn-primary" disabled={exporting}>
          {exporting ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Download" size={13} />} Export JSON
        </button>
        <button onClick={() => fileRef.current?.click()} className="btn btn-secondary" disabled={importing}>
          <Icon name="Upload" size={13} /> Import JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {result && (
        <div className="mt-3 p-3 rounded-lg text-xs" style={{ background: "var(--success-soft)" }}>
          <div className="font-semibold mb-1" style={{ color: "#059669" }}>
            <Icon name="Check" size={12} className="inline mr-1" /> Import complete
          </div>
          <div className="text-ink">
            Created {result.created.practices} practices, {result.created.locations} locations, {result.created.providers} providers,{" "}
            {result.created.enrollments} enrollments, {result.created.tasks} tasks.
          </div>
          {result.skipped.length > 0 && (
            <details className="mt-1 text-ink-light">
              <summary className="cursor-pointer">{result.skipped.length} row(s) skipped</summary>
              <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                {result.skipped.map((s, i) => (
                  <li key={i}>· {s}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <div className="mt-3 p-2 rounded text-[10px] text-ink-light" style={{ background: "var(--bg-soft)" }}>
        <Icon name="Info" size={10} className="inline mr-1" />
        Export includes: practices, locations, providers (with document statuses), enrollments and tasks. User logins, passwords, payer credentials and uploaded files are
        never exported. Imported records are marked as test data, so &quot;Delete All Test Data&quot; removes them.
      </div>

      {pending && (
        <ConfirmDialog
          title="Import JSON"
          message={
            <>
              Import <strong>{pending.fileName}</strong> ({pending.bundle.data.providers.length} providers)? This <strong>replaces your current test data</strong>; real data is not
              touched.
            </>
          }
          confirmLabel="Import"
          danger={false}
          busy={importing}
          onConfirm={runImport}
          onClose={() => !importing && setPending(null)}
        />
      )}
    </div>
  );
}
