"use client";

import { Select } from "@/components/Select";

import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { useAsync } from "@/lib/hooks";
import { useShell, useTopic } from "@/stores/shell";
import { providerName, useProvidersLite } from "@/components/enrollments/shared";
import { PayerLogo } from "@/components/payers/PayerLogo";
import { ProviderPayerLoginModal } from "@/components/modals/ProviderPayerLoginModal";
import type { PayerCredential } from "@/types/payers";
import type { PayerCard, WorkflowMeta } from "@/types/payerWorkflow";
import { CallModal, EmailModal, WorkflowDrawer, loadWorkflowMeta } from "./PayerWorkflow";

/**
 * Payer Submission Center: choose a provider, then the payers assigned to them (Admin → Payers) are listed as cards.
 * Each card runs that payer's credentialing workflow (commercial / Medicare / Medicaid), calls and e-mails the payer
 * (logged on the workflow), opens the payer's portal and keeps the provider's portal login.
 */
export function PayerSubmissionCenter() {
  const { can } = useAuth();
  const { publish } = useShell();
  const canWork = can("update", "enrollment");
  const canLogins = can("list", "credential_vault");
  const [providerId, setProviderId] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [calling, setCalling] = useState<PayerCard | null>(null);
  const [emailing, setEmailing] = useState<PayerCard | null>(null);
  const [login, setLogin] = useState<PayerCard | null>(null);

  const providers = useProvidersLite();
  const provider = providers.data?.find((p) => p.id === providerId);
  const meta = useAsync<WorkflowMeta>(loadWorkflowMeta, []);
  const cards = useAsync<PayerCard[]>(providerId ? () => api.get("/payer-workflows", { providerId }) : null, [providerId]);
  const logins = useAsync<PayerCredential[]>(providerId && canLogins ? () => api.get("/providers/" + providerId + "/payer-credentials") : null, [providerId, canLogins]);
  useTopic("enrollments", cards.reload);
  const changed = () => {
    cards.reload();
    publish("enrollments");
  };

  return (
    <div>
      <PageHeader title="Payer Submission Center" subtitle="Track commercial (NCQA-aligned), Medicare (PECOS) and Medicaid enrollment for each provider." />

      <div className="card card-pad mb-4">
        <label className="label" htmlFor="ps-provider">
          Provider
        </label>
        <Select id="ps-provider" value={providerId ?? ""} onChange={(e) => setProviderId(e.target.value ? Number(e.target.value) : null)} className="input w-full" disabled={providers.loading}>
          <option value="">{providers.loading ? "Loading providers…" : "— Choose a provider —"}</option>
          {(providers.data || []).map((p) => (
            <option key={p.id} value={p.id}>
              {providerName(p)} — NPI {p.npi || "—"}
            </option>
          ))}
        </Select>
        {providers.error && <div className="text-xs mt-2" style={{ color: "var(--danger)" }}>{providers.error}</div>}
      </div>

      {!providerId ? (
        <div className="card">
          <EmptyState icon="UserRound" title="Choose a provider" description="The payers assigned to the provider (Payers → choose the provider → Assign) are listed here with their credentialing workflow." />
        </div>
      ) : cards.error ? (
        <ErrorState message={cards.error} onRetry={cards.reload} />
      ) : !cards.data || !meta.data ? (
        meta.error ? <ErrorState message={meta.error} onRetry={meta.reload} /> : <Loading />
      ) : cards.data.length === 0 ? (
        <div className="card">
          <EmptyState icon="CreditCard" title="No payers assigned" description={"Assign payers to " + (provider ? providerName(provider) : "this provider") + " in the Payers module first."} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {cards.data.map((c) => (
            <PayerCardView
              key={c.enrollmentId}
              c={c}
              canWork={canWork}
              canLogin={canLogins}
              hasLogin={(logins.data || []).some((l) => l.payerId === c.payerId)}
              onWorkflow={() => setOpen(c.enrollmentId)}
              onCall={() => setCalling(c)}
              onEmail={() => setEmailing(c)}
              onLogin={() => setLogin(c)}
            />
          ))}
        </div>
      )}

      {open != null && meta.data && <WorkflowDrawer enrollmentId={open} meta={meta.data} onClose={() => setOpen(null)} onChanged={changed} />}
      {calling && <CallModal card={calling} onClose={() => setCalling(null)} onLogged={changed} />}
      {emailing && meta.data && <EmailModal card={emailing} meta={meta.data} onClose={() => setEmailing(null)} onLogged={changed} />}
      {login && provider && (
        <ProviderPayerLoginModal
          providerId={provider.id}
          providerName={providerName(provider)}
          payer={{ id: login.payerId, name: login.name, fullName: login.fullName, category: login.category, color: login.color || "#64748b" }}
          hasExisting={(logins.data || []).some((l) => l.payerId === login.payerId)}
          onSaved={() => {
            setLogin(null);
            logins.reload();
          }}
          onClose={() => setLogin(null)}
        />
      )}
    </div>
  );
}

/** A payer card (Payer Submission): details, Call / Email / Portal, the workflow progress, Workflow and Portal Login. */
function PayerCardView({
  c,
  canWork,
  canLogin,
  hasLogin,
  onWorkflow,
  onCall,
  onEmail,
  onLogin,
}: {
  c: PayerCard;
  canWork: boolean;
  canLogin: boolean;
  hasLogin: boolean;
  onWorkflow: () => void;
  onCall: () => void;
  onEmail: () => void;
  onLogin: () => void;
}) {
  const pillBg = c.statusTone === "ok" ? "var(--success-soft)" : "var(--accent-soft)";
  const pillColor = c.statusTone === "ok" ? "#047857" : "var(--accent-strong)";
  return (
    <div className="card card-pad flex flex-col gap-3" data-payer-card={c.payerId}>
      <div className="flex items-start justify-between">
        <PayerLogo name={c.initials} color={c.color} logo={c.logo} size={44} />
        {c.category && <span className="text-[11px] rounded-full px-2 py-0.5" style={{ background: "var(--bg-soft)", color: "var(--ink-light)", border: "1px solid var(--border)" }}>{c.category}</span>}
      </div>
      <div>
        <h3 className="font-display font-semibold text-ink">{c.name}</h3>
        <p className="text-xs text-ink-light">{c.fullName || ""}</p>
      </div>
      <dl className="text-xs space-y-1">
        <div className="flex justify-between">
          <dt className="text-ink-faint">Avg TAT</dt>
          <dd className="font-mono font-semibold">{c.avgTatDays != null ? c.avgTatDays + "d" : "—"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-faint">Integration</dt>
          <dd className="font-mono uppercase">{c.integration || "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-faint">Form</dt>
          <dd className="text-right font-mono">{c.appForm || "—"}</dd>
        </div>
      </dl>
      <div className="flex gap-2">
        <button className="btn btn-secondary text-xs" style={{ padding: "5px 10px" }} onClick={onCall} disabled={!canWork} title={c.supportPhone ? "Call " + c.supportPhone : "No support phone on the payer yet"} aria-label={"Call " + c.name}>
          <Icon name="Phone" size={12} /> Call
        </button>
        <button className="btn btn-secondary text-xs" style={{ padding: "5px 10px" }} onClick={onEmail} disabled={!canWork} title={c.supportEmail ? "Email " + c.supportEmail : "Email the payer"} aria-label={"Email " + c.name}>
          <Icon name="Mail" size={12} /> Email
        </button>
        {/* only payers with a portal get the globe */}
        {c.portalUrl && (
          <button
            className="btn btn-secondary text-xs"
            style={{ padding: "5px 10px" }}
            onClick={() => window.open(c.portalUrl!, "_blank", "noopener,noreferrer")}
            title={c.portalUrl}
            aria-label={"Open the " + c.name + " portal"}
          >
            <Icon name="Globe" size={12} /> Portal
          </button>
        )}
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-ink-faint">Progress</span>
          <span className="text-[11px] font-semibold rounded-md px-2 py-0.5" style={{ background: pillBg, color: pillColor }} data-progress>
            {c.statusLabel}
          </span>
        </div>
        <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(" + c.totalSteps + ", 1fr)" }} aria-label={"Step " + (c.step + 1) + " of " + c.totalSteps}>
          {Array.from({ length: c.totalSteps }).map((_, i) => (
            <span key={i} className="h-1.5 rounded-full" style={{ background: i < c.step ? (c.approved ? "var(--success)" : "var(--accent)") : i === c.step ? "var(--accent)" : "var(--border)", opacity: i === c.step ? 1 : i < c.step ? 0.65 : 1 }} />
          ))}
        </div>
      </div>
      <div className="flex gap-2 pt-1 mt-auto">
        <button className="btn text-xs flex-1 text-white" style={{ background: "#2563eb", padding: "7px 10px" }} onClick={onWorkflow}>
          <Icon name="Workflow" size={13} /> Workflow
        </button>
        {/* like the globe: no portal, no portal login */}
        {canLogin && c.portalUrl && (
          <button className="btn text-xs flex-1" style={{ background: "var(--accent-soft)", color: "var(--accent-strong)", border: "1px solid var(--accent)", padding: "7px 10px" }} onClick={onLogin}>
            <Icon name="LogIn" size={13} /> {hasLogin ? "Update Login" : "Portal Login"}
          </button>
        )}
      </div>
    </div>
  );
}

