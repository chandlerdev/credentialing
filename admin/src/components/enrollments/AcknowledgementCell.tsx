"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { api, errorMessage } from "@/lib/api";
import { useToast } from "@/stores/toast";
import { MAX_FILE_BYTES } from "@/components/providers/shared";
import { isWordFile } from "@/components/providers/ProviderOverview";
import type { Enrollment } from "@/types/enrollments";

/** as provider documents: PDF, Word, JPG or PNG */
const ACK_EXT = ["pdf", "doc", "docx", "jpg", "jpeg", "png"];

/**
 * Acknowledgement column: the payer's acknowledgement / approval certificate of an approved enrollment.
 * Approved without a file → Upload; with a file → view (eye) and replace.
 */
export function AcknowledgementCell({ enrollment: e, canUpload, onUploaded }: { enrollment: Enrollment; canUpload: boolean; onUploaded: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState(false);

  if (e.status !== "approved") {
    return (
      <span className="text-xs text-ink-faint" title="The acknowledgement can be uploaded once the enrollment is approved">
        —
      </span>
    );
  }

  const pick = async (file: File | null) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
    if (!ACK_EXT.includes(ext)) return toast("Only PDF, Word, JPG or PNG files can be uploaded", "error");
    if (file.size > MAX_FILE_BYTES) return toast("The file is larger than 25 MB", "error");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("fileType", "acknowledgement");
    setUploading(true);
    try {
      await api.upload("/enrollments/" + e.id + "/files", fd);
      toast("Acknowledgement uploaded");
      onUploaded();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setUploading(false);
    }
  };

  // Word files can't be shown in the browser: they are downloaded instead
  const word = isWordFile(e.acknowledgementFileName, e.acknowledgementMimeType);
  const view = async () => {
    if (!e.acknowledgementFileId) return;
    setViewing(true);
    try {
      const path = "/enrollment-files/" + e.acknowledgementFileId + "/download";
      if (word) await api.download(path, { inline: false }, e.acknowledgementFileName || "acknowledgement");
      else await api.openInNewTab(path, { inline: true });
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setViewing(false);
    }
  };

  const fileInput = <input ref={input} type="file" className="hidden" accept={ACK_EXT.map((x) => "." + x).join(",")} onChange={(ev) => pick(ev.target.files?.[0] || null)} aria-label="Acknowledgement file" />;

  if (e.acknowledgementFileId) {
    return (
      <div className="inline-flex items-center gap-1" onClick={(ev) => ev.stopPropagation()}>
        <button className="btn-ghost p-1" onClick={view} disabled={viewing} title={(word ? "Download " : "View ") + (e.acknowledgementFileName || "acknowledgement") + (word ? " (Word files can't be viewed in the browser)" : "")} aria-label={word ? "Download acknowledgement" : "View acknowledgement"}>
          {viewing ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name={word ? "Download" : "Eye"} size={14} style={{ color: "var(--accent)" }} />}
        </button>
        {canUpload && (
          <button className="btn-ghost p-1" onClick={() => input.current?.click()} disabled={uploading} title="Replace the acknowledgement" aria-label="Replace acknowledgement">
            {uploading ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name="RefreshCw" size={12} />}
          </button>
        )}
        {fileInput}
      </div>
    );
  }

  if (!canUpload) return <span className="text-xs text-ink-faint">Not uploaded</span>;
  return (
    <div onClick={(ev) => ev.stopPropagation()}>
      <button className="btn btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }} onClick={() => input.current?.click()} disabled={uploading} aria-label={"Upload acknowledgement for " + e.providerName}>
        {uploading ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name="Upload" size={11} />} Upload
      </button>
      {fileInput}
    </div>
  );
}
