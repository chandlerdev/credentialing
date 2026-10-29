"use client";

import { Select } from "@/components/Select";

import { useMemo, useState } from "react";
import { PayerLogo } from "./PayerLogo";
import { matchesSearch } from "@/lib/search";
import { cleanSearch } from "@/lib/utils";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { Pill } from "@/components/Pill";
import { api, errorMessage } from "@/lib/api";
import { useToast } from "@/stores/toast";
import { useShell } from "@/stores/shell";
import { useAuth } from "@/stores/auth";
import { useAsync } from "@/lib/hooks";
import { providerName, useProvidersLite } from "@/components/enrollments/shared";
import type { ProviderLite } from "@/types/enrollments";
import { PayerFormModal } from "@/components/payers/PayerFormModal";
import { PayerChecklist } from "@/components/payers/PayerChecklist";
import type { Payer, PayerOverviewItem } from "@/types/payers";

/** A payer assigned to a provider (its enrollment and how far its workflow is). */
interface Assignment {
  payerId: number;
  enrollmentId: number;
  step: number;
  status: string;
}

interface PayerRow {
  payer: Payer;
  avgTatDays: number | null;
}

/** Loads GET /payers/overview, falling back to GET /payers when the overview is unavailable. */
async function loadPayerRows(): Promise<PayerRow[]> {
  try {
    const items = await api.get<PayerOverviewItem[]>("/payers/overview", { activeOnly: true });
    return items.map((i) => ({ payer: i.payer, avgTatDays: i.avgTatDays ?? i.payer.avgTatDays }));
  } catch {
    const payers = await api.get<Payer[]>("/payers", { activeOnly: true });
    return payers.map((p) => ({ payer: p, avgTatDays: p.avgTatDays }));
  }
}

/**
 * Admin → Payers: the payers the organization works with (the checklist on the left switches them on). Choose a
 * provider to assign payers to them — an assigned payer gets an enrollment and appears in Payer Submission, where its
 * credentialing workflow, calls, e-mails and portal login are handled.
 */
export function PayersView() {
  const { can, user } = useAuth();
  const toast = useToast();
  const { publish } = useShell();
  // the organization admin can add payers of their own (also visible to the super admin)
  const canAdd = user?.role === "org_admin";
  const [adding, setAdding] = useState(false);
  const canAssign = can("create", "enrollment");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  const rows = useAsync(loadPayerRows, []);
  const providers = useProvidersLite();
  // tagged with its provider: while another provider's list loads, the previous one must not show (or be acted on)
  const assignments = useAsync<{ providerId: string; list: Assignment[] }>(
    selectedProviderId
      ? async () => ({ providerId: selectedProviderId, list: await api.get<Assignment[]>("/payer-workflows/assignments", { providerId: Number(selectedProviderId) }) })
      : null,
    [selectedProviderId]
  );
  const currentAssignments = assignments.data && assignments.data.providerId === selectedProviderId ? assignments.data.list : null;
  const assignmentsReady = currentAssignments !== null && !assignments.loading;

  const payers = useMemo(() => (rows.data || []).map((r) => r.payer), [rows.data]);
  const selectedProvider: ProviderLite | undefined = providers.data?.find((p) => String(p.id) === selectedProviderId);
  const assigned = useMemo(() => new Map((currentAssignments || []).map((a) => [a.payerId, a])), [currentAssignments]);

  const filteredRows = (rows.data || []).filter(
    ({ payer: p }) => matchesSearch(search, p.name, p.fullName, p.code)
  );
  const assignedCount = selectedProvider ? payers.filter((p) => assigned.has(p.id)).length : 0;

  const assign = async (p: Payer) => {
    if (!selectedProvider || !assignmentsReady) return;
    setBusy(p.id);
    try {
      await api.post("/payer-workflows/assignments", { providerId: selectedProvider.id, payerId: p.id });
      toast(p.name + " assigned to " + providerName(selectedProvider));
      assignments.reload();
      publish("enrollments");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  const unassign = async (p: Payer) => {
    if (!selectedProvider || !assignmentsReady) return;
    setBusy(p.id);
    try {
      await api.delete("/payer-workflows/assignments?providerId=" + selectedProvider.id + "&payerId=" + p.id);
      toast(p.name + " unassigned");
      assignments.reload();
      publish("enrollments");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Payers"
        subtitle="All insurance payers your organization works with. Select a provider to assign payers to them; their workflow and portal logins are handled in Payer Submission."
        actions={
          canAdd ? (
            <button onClick={() => setAdding(true)} className="btn btn-primary">
              <Icon name="Plus" size={14} /> Add Payer
            </button>
          ) : undefined
        }
      />
      {adding && (
        <PayerFormModal
          payer={null}
          mode="org"
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            rows.reload();
          }}
        />
      )}

      {/* left: every payer with a checkbox (admins); right: the enabled payers as cards */}
      <div className={canAdd ? "flex flex-col lg:flex-row gap-4 items-start" : ""}>
      {canAdd && <PayerChecklist onChanged={() => rows.reload()} />}
      <div className="flex-1 min-w-0 w-full">
      {/* Provider selector bar */}
      {canAssign && (
        <div
          className="card card-pad mb-4"
          style={{ background: selectedProvider ? "var(--accent-soft)" : "var(--info-soft)", borderColor: selectedProvider ? "var(--accent)" : "var(--info)" }}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <Icon name={selectedProvider ? "UserCheck" : "Info"} size={18} className={selectedProvider ? "text-accent" : "text-info"} />
            <div className="flex-1 min-w-0">
              {selectedProvider ? (
                <div>
                  <div className="text-sm text-ink">
                    Assigning payers to <strong>{providerName(selectedProvider)}</strong>
                    {selectedProvider.suffix ? ", " + selectedProvider.suffix : ""} ({selectedProvider.specialty || "—"})
                  </div>
                  <div className="text-xs text-ink-light mt-0.5">
                    <strong>{assignedCount}</strong> of <strong>{payers.length}</strong> payers assigned to this provider
                  </div>
                </div>
              ) : (
                <div className="text-xs text-ink">
                  <strong>Choose a provider first</strong> — then assign the payers to credential them with. Assigned payers are listed in Payer Submission for that provider.
                </div>
              )}
            </div>
            <Select value={selectedProviderId} onChange={(e) => setSelectedProviderId(e.target.value)} className="input" style={{ minWidth: 280, maxWidth: "100%" }} disabled={providers.loading}>
              <option value="">{providers.loading ? "Loading providers…" : "— Choose provider —"}</option>
              {(providers.data || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {providerName(p)} {p.suffix ? "," + p.suffix : ""} — NPI {p.npi || "—"}
                </option>
              ))}
            </Select>
          </div>
          {(providers.error || assignments.error) && <div className="text-xs mt-2" style={{ color: "var(--danger)" }}>{providers.error || assignments.error}</div>}
        </div>
      )}

      {/* Search */}
      <div className="mb-4 relative w-full">
        <Icon name="Search" size={14} className="absolute" style={{ left: 10, top: 10, color: "var(--ink-faint)" }} />
        <input value={search} onChange={(e) => setSearch(cleanSearch(e.target.value))} placeholder="Search payers..." className="input" style={{ paddingLeft: 32 }} />
      </div>

      {rows.error ? (
        <ErrorState message={rows.error} onRetry={rows.reload} />
      ) : rows.loading ? (
        <Loading />
      ) : filteredRows.length === 0 ? (
        <div className="card">
          <EmptyState icon="CreditCard" title={search ? "No payers match" : "No payers yet"} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredRows.map(({ payer: p, avgTatDays }) => {
            const a = assigned.get(p.id);

            return (
              <div key={p.id} className="card card-pad card-hover">
                <div className="flex items-start justify-between mb-3">
                  <PayerLogo name={p.name} color={p.color} logo={p.logo} />
                  <Pill type="neutral">{p.category}</Pill>
                </div>
                <h3 className="font-display font-semibold text-ink">{p.name}</h3>
                <p className="text-xs text-ink-light mb-3">{p.fullName}</p>
                <div className="space-y-1 text-xs mb-3">
                  <div className="flex justify-between">
                    <span className="text-ink-faint">Avg TAT</span>
                    <span className="font-mono font-semibold">{avgTatDays != null ? avgTatDays + "d" : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-faint">Integration</span>
                    <span className="font-mono uppercase">{p.integration}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-faint">Form</span>
                    <span className="text-right">{p.appForm || "—"}</span>
                  </div>
                </div>
                {/* assign the payer to the chosen provider (its workflow then runs in Payer Submission) */}
                {canAssign && (
                <div className="pt-3 border-t border-line flex items-center justify-between gap-2">
                  <div className="text-xs">
                    {!selectedProvider ? (
                      <span className="flex items-center gap-1 text-ink-faint">
                        <Icon name="UserRound" size={11} /> Choose a provider
                      </span>
                    ) : !assignmentsReady ? (
                      <span className="flex items-center gap-1 text-ink-faint">
                        <span className="loader" style={{ width: 11, height: 11 }} /> Loading…
                      </span>
                    ) : a ? (
                      <span className="flex items-center gap-1 text-success" data-assigned={p.id}>
                        <Icon name="CheckCircle2" size={11} /> Assigned
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-ink-faint">
                        <Icon name="Circle" size={11} /> Not assigned
                      </span>
                    )}
                  </div>
                  {selectedProvider && (
                    a ? (
                      <button
                        onClick={() => unassign(p)}
                        className="btn btn-secondary"
                        style={{ fontSize: 11, padding: "5px 10px" }}
                        disabled={busy === p.id || !assignmentsReady}
                        title={a.step > 0 || a.status !== "draft" ? "The workflow has started: it can't be unassigned" : "Unassign this payer"}
                        aria-label={"Unassign " + p.name}
                      >
                        {busy === p.id ? <span className="loader" style={{ width: 11, height: 11 }} /> : <Icon name="X" size={11} />} Unassign
                      </button>
                    ) : (
                      <button
                        onClick={() => assign(p)}
                        className="btn btn-primary"
                        style={{ fontSize: 11, padding: "5px 10px" }}
                        disabled={busy === p.id || !assignmentsReady}
                        aria-label={"Assign " + p.name}
                      >
                        {busy === p.id ? <span className="loader" style={{ width: 11, height: 11, borderTopColor: "white" }} /> : <Icon name="Plus" size={11} />} Assign
                      </button>
                    )
                  )}
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </div>
      </div>

    </div>
  );
}
