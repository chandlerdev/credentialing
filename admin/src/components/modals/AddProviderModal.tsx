"use client";

import { useState } from "react";
import { Loading } from "@/components/AsyncState";
import { AlertBox } from "@/components/AlertBox";
import { ProviderForm } from "@/components/providers/ProviderForm";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { OrgAssignmentFields, EMPTY_ASSIGNMENT, placementAssignment, type OrgAssignment } from "@/components/OrgAssignmentFields";
import { Pill } from "@/components/Pill";
import { useShell } from "@/stores/shell";
import { api, errorMessage } from "@/lib/api";
import { useToast } from "@/stores/toast";
import { SendLinkModal } from "./SendLinkModal";
import { useOrgStructure, ValField } from "@/components/providers/shared";
import { useAsync } from "@/lib/hooks";
import { fmtDate } from "@/lib/utils";
import type { CaqhImportResponse, CaqhLookupConfig, CaqhProfile } from "@/types/caqh";
import type { ProviderDetail } from "@/types/providers";

type Step = "choose" | "caqh" | "link" | "manual";

/**
 * Prototype AddProviderModal (L1492) — three ways to add a provider.
 * `onCreated(id)` navigates to the new provider; `onCreated()` just refreshes the list.
 * `placement` (Organization screen): every path puts the provider under that client / practice / location.
 */
export function AddProviderModal({ onClose, onCreated, placement }: { onClose: () => void; onCreated: (id?: number) => void; placement?: ProviderPlacement }) {
  const [step, setStep] = useState<Step>("choose");
  const toast = useToast();
  const { publish } = useShell();

  if (step === "caqh")
    return (
      <CaqhImportModal
        placement={placement}
        onClose={onClose}
        onBack={() => setStep("choose")}
        onImported={(res) => {
          toast("Imported " + res.providerName + " + " + res.documentsImported + " documents from CAQH");
          publish("providers");
          publish("notifications");
          onCreated(res.providerId);
        }}
      />
    );
  if (step === "link")
    return (
      <SendLinkModal
        placement={placement}
        onClose={onClose}
        onBack={() => setStep("choose")}
        onSent={() => {
          // the "Mail sent" alert already told the user
          publish("providers");
          onCreated();
        }}
      />
    );
  if (step === "manual")
    return (
      <ManualAddModal
        placement={placement}
        onClose={onClose}
        onBack={() => setStep("choose")}
        onSaved={(p) => {
          toast("Provider added");
          publish("providers");
          onCreated(p.id);
        }}
      />
    );

  return (
    <Modal title="How would you like to add a provider?" onClose={onClose} maxWidth={820}>
      {placement && <PlacementNote placement={placement} />}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
        <AddProviderOption
          icon="DownloadCloud"
          color="#f97316"
          title="Import from CAQH"
          description="Automatically import provider data, credentials, and documents from CAQH ProView."
          onClick={() => setStep("caqh")}
        />
        <AddProviderOption
          icon="Pencil"
          color="#3b82f6"
          title="Enter Manually"
          description="Fill in all provider details yourself and upload documents on their behalf."
          onClick={() => setStep("manual")}
        />
        <AddProviderOption
          icon="Send"
          color="#10b981"
          title="Send Link to Provider"
          description="Provider completes their own profile via a secure link. Just need their name and email."
          onClick={() => setStep("link")}
        />
      </div>
    </Modal>
  );
}

function AddProviderOption({ icon, color, title, description, onClick }: { icon: string; color: string; title: string; description: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card card-hover p-5 text-left transition-all hover:shadow-md">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-4" style={{ background: color + "20", color }}>
        <Icon name={icon} size={20} />
      </div>
      <div className="font-display font-semibold text-ink mb-1">{title}</div>
      <div className="text-xs text-ink-light leading-relaxed">{description}</div>
    </button>
  );
}

// ---------- CAQH import (prototype v2: mock database or real CAQH API, see CAQH Config) ----------

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function CaqhImportModal({
  onClose,
  onBack,
  onImported,
  placement,
}: {
  onClose: () => void;
  onBack: () => void;
  onImported: (res: CaqhImportResponse) => void;
  placement?: ProviderPlacement;
}) {
  const config = useAsync<CaqhLookupConfig>(() => api.get<CaqhLookupConfig>("/caqh/lookup-config"), []);
  const mock = config.data?.mode === "mock";
  const [caqhId, setCaqhId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [assignment, setAssignment] = useState<OrgAssignment>(placement ? placementAssignment(placement) : EMPTY_ASSIGNMENT);
  const [importing, setImporting] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<CaqhProfile | null>(null);
  const [completing, setCompleting] = useState(false);
  const org = useOrgStructure();

  const handleImport = async () => {
    if (!/^\d{6,10}$/.test(caqhId.trim())) {
      setError("Enter a CAQH Provider ID of 6–10 digits");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      setStage("Authenticating with CAQH ProView...");
      await wait(400);
      setStage("Looking up provider by CAQH ID...");
      const data = await api.get<CaqhProfile>("/caqh/lookup/" + encodeURIComponent(caqhId.trim()));
      setStage("Pulling " + data.documents.length + " documents...");
      await wait(600);
      setStage("Verifying credentials...");
      await wait(400);
      setProfile(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStage("");
      setImporting(false);
    }
  };


  // After the lookup: complete the provider form (same fields and rules as Add Provider Manually), then import.
  if (profile && completing) {
    const p = profile;
    return (
      <Modal title="Complete Provider Details" subtitle="Imported from CAQH — check the details and fill in anything CAQH did not provide. First name, last name, email and password are required." onClose={onClose} showBack onBack={() => setCompleting(false)} maxWidth={880}>
        {!org.data ? (
          <Loading compact />
        ) : (
          <ProviderForm
            org={org.data}
            initial={{
              firstName: p.firstName,
              lastName: p.lastName,
              suffix: p.suffix,
              npi: p.npi,
              specialty: p.specialty,
              email: p.email,
              phone: p.phone,
              licenseNumber: p.license,
              licenseState: p.licenseState,
              licenseExpires: p.licenseExpires,
              caqhId: caqhId.trim(),
              caqhUsername: username.trim(),
              caqhPassword: password,
              status: "active",
              clientId: assignment.clientId ? Number(assignment.clientId) : null,
              practiceId: assignment.practiceId ? Number(assignment.practiceId) : null,
              locationId: assignment.locationId ? Number(assignment.locationId) : null,
            }}
            lockCaqhId
            withLogin
            lockPlacement={!!placement}
            submitLabel="Save Provider"
            submitIcon="Check"
            cancelLabel="Back"
            onCancel={() => setCompleting(false)}
            onSubmit={async ({ password, ...body }) => {
              const res = await api.post<CaqhImportResponse>("/caqh/import", {
                caqhId: caqhId.trim(),
                clientId: body.clientId,
                practiceId: body.practiceId,
                locationId: body.locationId,
                caqhUsername: body.caqhUsername,
                caqhPassword: body.caqhPassword,
                details: body,
                password,
              });
              onImported(res);
            }}
          />
        )}
      </Modal>
    );
  }

  if (profile) {
    const p = profile;
    return (
      <Modal title="Import from CAQH ProView" subtitle="Pull provider data and documents directly from CAQH." onClose={onClose} showBack onBack={() => setProfile(null)} maxWidth={560}>
        <div className="space-y-4 mt-2">
          <div className="card-pad rounded-lg" style={{ background: "var(--success-soft)", border: "1px solid var(--success)" }}>
            <div className="flex items-start gap-2 mb-3">
              <Icon name="CheckCircle2" size={18} style={{ color: "var(--success)" }} />
              <div>
                <div className="font-semibold text-ink">Provider Found</div>
                <div className="text-xs text-ink-light">
                  Found {p.documents.length} documents and the full profile in CAQH{p.source === "mock" ? " (mock database)" : ""}.
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <ValField label="Name" val={p.firstName + " " + p.lastName + (p.suffix ? ", " + p.suffix : "")} />
              <ValField label="NPI" val={p.npi} />
              <ValField label="Specialty" val={p.specialty} />
              <ValField label="Taxonomy" val={p.taxonomy || "N/A"} />
              <ValField label="Email" val={p.email} />
              <ValField label="Ph.No" val={p.phone} />
              <ValField label="DEA #" val={p.deaNumber || "N/A"} />
              <ValField label="DEA Expires" val={p.deaExpires ? fmtDate(p.deaExpires) : "N/A"} />
              {p.boardCert && <ValField label="Board Cert" val={p.boardCert.board + " · " + p.boardCert.status} />}
              {p.malpractice && <ValField label="Malpractice" val={p.malpractice.carrier + (p.malpractice.limit ? " · " + p.malpractice.limit : "")} />}
              {p.address && <ValField label="Practice Address" val={p.address.street + ", " + p.address.city + ", " + p.address.state + " " + p.address.zip} />}
              {p.attestedAt && <ValField label="Last Attested" val={fmtDate(p.attestedAt)} />}
            </div>
            {p.documents.length > 0 && (
              <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--success)" }}>
                <div className="font-semibold text-xs mb-2 flex items-center gap-1.5" style={{ color: "var(--success)" }}>
                  <Icon name="FileCheck" size={13} />
                  Documents pulled from CAQH ({p.documents.length})
                </div>
                <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                  {p.documents.map((doc) => (
                    <div key={doc.id} className="flex items-center gap-2 p-1.5 rounded text-[10px] bg-paper">
                      <Icon name="FileText" size={10} className="flex-shrink-0" style={{ color: "var(--success)" }} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-ink truncate">{doc.label}</div>
                        <div className="font-mono text-ink-faint truncate">
                          {doc.fileName}
                          {doc.sizeKB ? " · " + doc.sizeKB + "KB" : ""}
                          {doc.expires ? " · exp " + doc.expires : ""}
                        </div>
                      </div>
                      <Pill type="success">verified</Pill>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <button onClick={() => setProfile(null)} className="btn btn-secondary">Try Different ID</button>
            <button onClick={() => setCompleting(true)} className="btn btn-primary">
              Save Provider <Icon name="Check" size={14} />
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Import from CAQH ProView" subtitle="Pull provider data and documents directly from CAQH." onClose={onClose} showBack onBack={onBack} maxWidth={560}>
      <div className="space-y-4 mt-2">
        <div>
          <label className="label">CAQH Provider ID</label>
          <input
            value={caqhId}
            onChange={(e) => {
              setCaqhId(e.target.value.replace(/\D/g, ""));
              setError(null);
            }}
            className="input font-mono"
            placeholder={mock ? "Try: 10000001" : "e.g. 15454546"}
          />
          {error && (
            <div className="text-xs mt-1 flex items-center gap-1" style={{ color: "var(--danger)" }}>
              <Icon name="AlertCircle" size={11} /> {error}
            </div>
          )}
          {mock && (
            <div className="text-[10px] text-ink-faint mt-1">
              <Icon name="Info" size={10} className="inline mr-1" />
              Mock mode active. Valid demo IDs: 10000001 (Carlson, FM MD), 10000003 (Patel, Cardiology), 10000005 (Nguyen, Peds), 10000010 (Kim, FM) + 11 more. See{" "}
              <Link href="/caqh-config" className="underline">CAQH Config</Link> to switch to the real API.
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">CAQH Username (optional)</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="input" autoComplete="off" />
          </div>
          <div>
            <label className="label">CAQH Password (optional)</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" autoComplete="new-password" />
          </div>
        </div>
        <div className="px-3 py-2 rounded-lg text-xs" style={{ background: "var(--info-soft)", color: "#1e40af" }}>
          <Icon name="Info" size={12} /> Credentials are needed only for delegated arrangements. Without them, we&apos;ll request the provider authorize your organization in CAQH.
        </div>
        <OrgAssignmentFields value={assignment} onChange={setAssignment} title="Assign imported provider to" />
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onBack} className="btn btn-secondary" disabled={importing}>Cancel</button>
          <button
            onClick={handleImport}
            disabled={!caqhId || importing}
            title={!assignment.practiceId ? "Pick a practice to continue" : !assignment.locationId ? "Pick a location to continue" : ""}
            className="btn btn-primary"
          >
            {importing ? (
              <>
                <span className="loader" /> {stage || "Importing..."}
              </>
            ) : (
              <>
                Import from CAQH <Icon name="DownloadCloud" size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Manual add ----------

export function PlacementNote({ placement }: { placement: ProviderPlacement }) {
  return (
    <div className="px-3 py-2 rounded-lg text-xs flex items-center gap-2 mb-2" style={{ background: "var(--accent-soft)" }}>
      <Icon name="Building2" size={13} className="text-accent flex-shrink-0" />
      <span className="text-ink-light">Will be added under</span>
      <span className="font-semibold text-ink">{placement.label}</span>
    </div>
  );
}

/** Where a provider added from the Organization screen goes (shown read-only at the top of the form). */
export interface ProviderPlacement {
  clientId: number | null;
  practiceId: number | null;
  locationId: number | null;
  /** e.g. "Client › Practice › Location" */
  label: string;
}

export function ManualAddModal({
  onClose,
  onBack,
  onSaved,
  placement,
}: {
  onClose: () => void;
  onBack?: () => void;
  onSaved: (p: ProviderDetail) => void;
  placement?: ProviderPlacement;
}) {
  const org = useOrgStructure();
  return (
    <Modal
      title={placement ? "Add Provider" : "Add Provider Manually"}
      onClose={onClose}
      showBack={!!onBack}
      onBack={onBack}
      maxWidth={880}
    >
      {org.error ? (
        <AlertBox type="danger">{org.error}</AlertBox>
      ) : !org.data ? (
        <Loading compact />
      ) : (
        <ProviderForm
          org={org.data}
          initial={placement ? { clientId: placement.clientId, practiceId: placement.practiceId, locationId: placement.locationId } : {}}
          lockPlacement={!!placement}
          top={placement ? <PlacementNote placement={placement} /> : undefined}
          withLogin
          submitLabel="Save Provider"
          submitIcon="Check"
          onCancel={onBack || onClose}
          onSubmit={async ({ password, ...provider }) => {
            const p = await api.post<ProviderDetail>("/providers/with-login", { password, provider });
            onSaved(p);
          }}
        />
      )}
    </Modal>
  );
}
