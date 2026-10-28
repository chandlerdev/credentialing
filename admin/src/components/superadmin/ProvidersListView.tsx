"use client";

import { Select } from "@/components/Select";

import { useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AsyncBoundary } from "@/components/AsyncState";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { Pagination } from "@/components/Pagination";
import { ProviderStatusPill } from "@/components/Pill";
import { ProgressBar } from "@/components/ProgressBar";
import { api, errorMessage } from "@/lib/api";
import { ProviderEditModal } from "@/components/modals/ProviderEditModal";
import { useToast } from "@/stores/toast";
import { useAsync, useDebounced } from "@/lib/hooks";
import { useFitRows } from "@/lib/useFitRows";
import { cleanSearch } from "@/lib/utils";
import type { PageResponse } from "@/types";
import type { Client } from "@/types/organization";
import type { ProviderDetail, ProviderListItem } from "@/types/providers";
import { adminLabel } from "./OrganizationsView";
import type { AdminSummary } from "./types";

const ROW_H = 49;

/**
 * Super admin → Providers: choose the org admin, then one of their organizations (clients); that organization's
 * providers are listed below. A row opens the provider; the pencil edits every detail of it (as Add Provider),
 * passwords included.
 */
export function ProvidersListView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const adminId = params.get("admin") || "";
  const clientId = params.get("client") || "";

  const admins = useAsync<AdminSummary[]>(() => api.get<AdminSummary[]>("/platform/admins"), []);
  const adminList = [...(admins.data || [])].sort((a, b) => a.name.localeCompare(b.name));
  const admin = adminList.find((a) => String(a.userId) === adminId);
  const orgId = admin?.orgId ?? null;
  const clients = useAsync<Client[]>(orgId ? () => api.get<Client[]>("/clients", undefined, { orgId }) : null, [orgId]);
  const clientList = [...(clients.data || [])].sort((a, b) => a.name.localeCompare(b.name));
  const client = clientList.find((c) => String(c.id) === clientId);

  const setQuery = (admin: string, client: string) => {
    const qs = new URLSearchParams();
    if (admin) qs.set("admin", admin);
    if (client) qs.set("client", client);
    router.replace(pathname + (qs.toString() ? "?" + qs : ""), { scroll: false });
  };

  return (
    <div>
      <PageHeader title="Providers" subtitle="Choose an org admin and one of their organizations to see its providers." />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div>
          <label className="label" htmlFor="sa-p-admin">Org Admin</label>
          <Select id="sa-p-admin" value={adminId} onChange={(e) => setQuery(e.target.value, "")} className="input" disabled={admins.loading}>
            <option value="">{admins.loading ? "Loading admins…" : "— Select an org admin —"}</option>
            {adminList.map((a) => (
              <option key={a.userId} value={a.userId}>{adminLabel(a)}</option>
            ))}
          </Select>
          {admins.error && <div className="field-error">{admins.error}</div>}
        </div>
        <div>
          <label className="label" htmlFor="sa-p-client">Organization</label>
          <Select id="sa-p-client" value={clientId} onChange={(e) => setQuery(adminId, e.target.value)} className="input" disabled={!admin || clients.loading}>
            <option value="">{!admin ? "Choose an org admin first" : clients.loading ? "Loading organizations…" : clientList.length ? "— Select an organization —" : "No organizations under this admin"}</option>
            {clientList.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          {clients.error && <div className="field-error">{clients.error}</div>}
        </div>
      </div>
      {admin && client ? (
        <ProviderTable key={orgId + ":" + client.id} orgId={admin.orgId} clientId={client.id} adminId={adminId} />
      ) : (
        <div className="card card-pad text-center text-sm text-ink-light py-10">
          {admin ? "Select an organization to see its providers." : "Select an org admin, then an organization, to see the providers."}
        </div>
      )}
    </div>
  );
}

function ProviderTable({ orgId, clientId, adminId }: { orgId: number; clientId: number; adminId: string }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [page, setPage] = useState(0);
  const tableRef = useRef<HTMLDivElement>(null);
  const size = useFitRows(tableRef, ROW_H);
  const list = useAsync<PageResponse<ProviderListItem>>(
    () => api.get<PageResponse<ProviderListItem>>("/providers", { q, clientId, page, size, sort: "lastName,asc" }, { orgId }),
    [orgId, clientId, q, page, size]
  );
  const data = list.data;
  const rows = data?.content || [];
  const toast = useToast();
  const [editing, setEditing] = useState<ProviderDetail | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const openEdit = async (id: number) => {
    setOpening(id);
    try {
      setEditing(await api.get<ProviderDetail>("/providers/" + id, undefined, { orgId }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setOpening(null);
    }
  };

  return (
    <div>
      <div className="relative mb-3">
        <Icon name="Search" size={14} className="absolute" style={{ left: 10, top: 10, color: "var(--ink-faint)" }} />
        <input
          value={search}
          onChange={(e) => {
            setSearch(cleanSearch(e.target.value));
            setPage(0);
          }}
          placeholder="Search name, NPI, specialty, email..."
          className="input"
          style={{ paddingLeft: 32 }}
          aria-label="Search providers"
        />
      </div>
      <div className="card overflow-hidden" ref={tableRef} style={{ opacity: list.loading && data ? 0.6 : 1 }}>
        <AsyncBoundary loading={list.loading && !data} error={list.error} onRetry={list.reload}>
          <table className="table-fit" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "21%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "5%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Specialty</th>
                <th>Status</th>
                <th>Documents</th>
                <th>Email</th>
                <th>NPI</th>
                <th className="text-right">Edit</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-sm text-ink-light" style={{ height: ROW_H }}>
                    {q ? "No providers match “" + q + "”" : "No providers in this organization"}
                  </td>
                </tr>
              )}
              {rows.map((p) => {
                const name = p.firstName + " " + p.lastName + (p.suffix ? ", " + p.suffix : "");
                return (
                  <tr
                    key={p.id}
                    className="cursor-pointer hover:bg-soft"
                    style={{ height: ROW_H }}
                    onClick={() => router.push("/all-providers/" + p.id + "?org=" + orgId + "&admin=" + adminId + "&client=" + clientId)}
                  >
                    <td className="truncate font-medium text-accent" title={name}>{name}</td>
                    <td className="truncate text-ink-light" title={p.specialty || ""}>{p.specialty || "—"}</td>
                    <td className="truncate"><ProviderStatusPill status={p.status} /></td>
                    <td><ProgressBar filled={p.documents.approved} total={p.documents.required} /></td>
                    <td className="truncate text-xs text-ink-light" title={p.email || ""}>{p.email || "—"}</td>
                    <td className="truncate font-mono text-xs text-ink-light">{p.npi || "—"}</td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-ghost p-1" title={"Edit " + name} aria-label={"Edit " + name} disabled={opening === p.id} onClick={() => openEdit(p.id)}>
                        {opening === p.id ? <span className="loader" style={{ width: 12, height: 12 }} /> : <Icon name="Pencil" size={14} style={{ color: "var(--accent)" }} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data && <Pagination page={data.page} totalPages={data.totalPages} totalElements={data.totalElements} size={data.size} onChange={setPage} />}
        </AsyncBoundary>
      </div>
      {editing && (
        <ProviderEditModal
          provider={editing}
          orgId={orgId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast("Provider updated");
            list.reload();
          }}
        />
      )}
    </div>
  );
}
