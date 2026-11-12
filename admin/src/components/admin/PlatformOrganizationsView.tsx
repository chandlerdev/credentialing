"use client";

import { Select } from "@/components/Select";
import { CitySelect, StateSelect } from "@/components/AddressFields";

import { useState } from "react";
import { PHONE_RE } from "@/lib/validation";
import { PhoneInput } from "@/components/PhoneInput";
import { matchesSearch } from "@/lib/search";
import { AccessDenied } from "@/components/AlertBox";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { Pill } from "@/components/Pill";
import { StatCard } from "@/components/StatCard";
import { api, ApiError, errorMessage, getSelectedOrgId, setSelectedOrgId } from "@/lib/api";
import { useUser } from "@/stores/auth";
import { useAsync } from "@/lib/hooks";
import { useToast } from "@/stores/toast";
import { fmtDate, cleanSearch } from "@/lib/utils";
import { ROLE_LABEL } from "@/lib/constants";
import { loadPackages, type Package } from "@/types/signup";
import { orgTypeLabel, type AdminOrg, type AdminOrgCreate } from "@/types/admin";
import { useMasterList, withCurrent } from "@/lib/masterLists";

export function PlatformOrganizationsView() {
  const orgTypes = useMasterList("org_type");
  const typeLabel = (id: string | null) => orgTypes.find((t) => t.value === id)?.label || orgTypeLabel(id);
  const user = useUser();
  const toast = useToast();
  const allowed = user.role === "platform_admin";
  const orgs = useAsync<AdminOrg[]>(allowed ? () => api.get<AdminOrg[]>("/admin/organizations") : null, [allowed]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "suspended">("all");
  const [showNew, setShowNew] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<AdminOrg | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedOrgId = getSelectedOrgId();

  if (!allowed) return <AccessDenied action="manage" entity="organizations" role={ROLE_LABEL[user.role] || user.role} />;

  const list = orgs.data || [];
  const filtered = list.filter(
    (o) => (statusFilter === "all" || o.status === statusFilter) && matchesSearch(search, o.name, o.city, o.state, o.email, o.inviteCode, o.status)
  );

  const changeStatus = async () => {
    if (!pendingStatus) return;
    const next = pendingStatus.status === "active" ? "suspended" : "active";
    setBusy(true);
    try {
      const updated = await api.patch<AdminOrg>("/admin/organizations/" + pendingStatus.id + "/status", { status: next });
      orgs.setData((prev) => (prev || []).map((o) => (o.id === updated.id ? updated : o)));
      toast(next === "suspended" ? "Organization suspended" : "Organization activated");
      setPendingStatus(null);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (o: AdminOrg) => {
    setSelectedOrgId(o.id);
    // Full reload so every page and the sidebar switcher pick up the new tenant (same as the OrgSwitcher).
    window.location.reload();
  };

  return (
    <div>
      <PageHeader
        title="Organizations"
        subtitle="All tenant organizations on ZmartCredential"
        actions={
          <button onClick={() => setShowNew(true)} className="btn btn-primary">
            <Icon name="Plus" size={13} /> New Organization
          </button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Organizations" value={orgs.data ? list.length : "—"} sub={list.filter((o) => o.selfSignup).length + " self sign-up"} icon="Building" color="var(--accent)" />
        <StatCard label="Active" value={orgs.data ? list.filter((o) => o.status === "active").length : "—"} sub="Can sign in" icon="CheckCircle2" color="var(--success)" />
        <StatCard label="Suspended" value={orgs.data ? list.filter((o) => o.status === "suspended").length : "—"} sub="Sign-in blocked" icon="PauseCircle" color="var(--danger)" />
        <StatCard label="Providers" value={orgs.data ? list.reduce((s, o) => s + o.providerCount, 0) : "—"} sub={list.reduce((s, o) => s + o.userCount, 0) + " users"} icon="Users" color="var(--info)" />
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-xs" style={{ minWidth: 200 }}>
          <Icon name="Search" size={14} className="absolute" style={{ left: 10, top: 10, color: "var(--ink-faint)" }} />
          <input value={search} onChange={(e) => setSearch(cleanSearch(e.target.value))} placeholder="Search name, city, email, invite code..." className="input" style={{ paddingLeft: 32 }} />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "suspended")} className="input" style={{ width: 180 }}>
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
      </div>

      {orgs.error ? (
        <ErrorState message={orgs.error} onRetry={orgs.reload} />
      ) : (
        <div className="card overflow-hidden">
          {orgs.loading && !orgs.data ? (
            <Loading />
          ) : filtered.length === 0 ? (
            <EmptyState icon="Building" title={list.length === 0 ? "No organizations yet" : "No organizations match"} description={list.length === 0 ? "Create the first tenant organization." : undefined} />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Plan</th>
                    <th className="text-right">Users</th>
                    <th className="text-right">Providers</th>
                    <th>Invite Code</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o) => {
                    const current = selectedOrgId === String(o.id);
                    return (
                      <tr key={o.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                              <Icon name="Building2" size={15} />
                            </div>
                            <div>
                              <div className="text-sm font-medium text-ink flex items-center gap-1.5">
                                {o.name}
                                {current && <Pill type="accent">Current</Pill>}
                              </div>
                              <div className="text-[10px] text-ink-light">
                                {typeLabel(o.orgType)}
                                {o.city || o.state ? " · " + [o.city, o.state].filter(Boolean).join(", ") : ""}
                                {o.selfSignup ? " · Self sign-up" : ""}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          {o.packageName ? (
                            <div>
                              <div className="text-xs font-medium">{o.packageName}</div>
                              {o.subscriptionStatus && <div className="text-[10px] text-ink-light capitalize">{o.subscriptionStatus.replace(/_/g, " ")}</div>}
                            </div>
                          ) : (
                            <span className="text-xs text-ink-faint">—</span>
                          )}
                        </td>
                        <td className="text-right text-sm">{o.userCount}</td>
                        <td className="text-right text-sm">{o.providerCount}</td>
                        <td className="font-mono text-xs">{o.inviteCode || "—"}</td>
                        <td>
                          <Pill type={o.status === "active" ? "success" : "danger"}>{o.status === "active" ? "Active" : "Suspended"}</Pill>
                        </td>
                        <td className="text-xs text-ink-light">{fmtDate(o.createdAt)}</td>
                        <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                          {!current && o.status === "active" && (
                            <button onClick={() => switchTo(o)} className="btn btn-ghost text-xs" title="Work in this organization">
                              <Icon name="ArrowRightLeft" size={11} /> Switch
                            </button>
                          )}
                          <button onClick={() => setPendingStatus(o)} className={"btn btn-ghost text-xs " + (o.status === "active" ? "hover:text-danger" : "")}>
                            <Icon name={o.status === "active" ? "PauseCircle" : "PlayCircle"} size={11} /> {o.status === "active" ? "Suspend" : "Activate"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showNew && (
        <NewOrganizationModal
          onClose={() => setShowNew(false)}
          onCreated={(o) => {
            setShowNew(false);
            toast("Organization created · " + o.name);
            orgs.reload();
          }}
        />
      )}
      {pendingStatus && (
        <ConfirmDialog
          title={pendingStatus.status === "active" ? "Suspend organization" : "Activate organization"}
          message={
            pendingStatus.status === "active"
              ? "Suspend \"" + pendingStatus.name + "\"? All of its users are signed out immediately and cannot sign in until the organization is activated again."
              : "Activate \"" + pendingStatus.name + "\"? Its users will be able to sign in again."
          }
          confirmLabel={pendingStatus.status === "active" ? "Suspend" : "Activate"}
          danger={pendingStatus.status === "active"}
          busy={busy}
          onConfirm={changeStatus}
          onClose={() => !busy && setPendingStatus(null)}
        />
      )}
    </div>
  );
}

interface NewOrgForm {
  name: string;
  orgType: string;
  taxId: string;
  website: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  packageCode: string;
  estimatedProviders: string;
  withAdmin: boolean;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  adminPassword: string;
  adminTitle: string;
  adminPhone: string;
}

// Maps server field-error keys (request field names) to form keys.
const serverKey = (k: string) => (k.startsWith("admin.") ? "admin" + k.charAt(6).toUpperCase() + k.slice(7) : k);

function NewOrganizationModal({ onClose, onCreated }: { onClose: () => void; onCreated: (o: AdminOrg) => void }) {
  const orgTypes = useMasterList("org_type");
  const packages = useAsync<Package[]>(loadPackages, []);
  const [form, setForm] = useState<NewOrgForm>({
    name: "", orgType: "physician_group", taxId: "", website: "", address: "", city: "", state: "", zip: "", phone: "", email: "",
    packageCode: "", estimatedProviders: "5",
    withAdmin: true, adminFirstName: "", adminLastName: "", adminEmail: "", adminPassword: "", adminTitle: "", adminPhone: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof NewOrgForm>(k: K, v: NewOrgForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Required";
    if (form.taxId && !/^\d{9}$/.test(form.taxId)) e.taxId = "9 digits required";
    if (form.zip && !/^\d{5}$/.test(form.zip)) e.zip = "5 digits required";
    if (form.email && !/^[^@]+@[^@]+\.[^@]+$/.test(form.email)) e.email = "Valid email required";
    if (form.phone && !PHONE_RE.test(form.phone)) e.phone = "Ph.No must be 10 digits";
    if (form.packageCode) {
      const n = Number(form.estimatedProviders);
      if (!Number.isInteger(n) || n < 1) e.estimatedProviders = "Whole number, at least 1";
    }
    if (form.withAdmin) {
      if (!form.adminFirstName.trim()) e.adminFirstName = "Required";
      if (!form.adminLastName.trim()) e.adminLastName = "Required";
      if (!/^[^@]+@[^@]+\.[^@]+$/.test(form.adminEmail)) e.adminEmail = "Valid email required";
      if (form.adminPassword.length < 8) e.adminPassword = "At least 8 characters";
      if (form.adminPhone && !PHONE_RE.test(form.adminPhone)) e.adminPhone = "Ph.No must be 10 digits";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setBusy(true);
    setFormError("");
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    const body: AdminOrgCreate = {
      name: form.name.trim(),
      orgType: form.orgType,
      taxId: opt(form.taxId),
      website: opt(form.website),
      address: opt(form.address),
      city: opt(form.city),
      state: opt(form.state),
      zip: opt(form.zip),
      phone: opt(form.phone),
      email: opt(form.email),
      packageCode: opt(form.packageCode),
      estimatedProviders: form.packageCode ? Number(form.estimatedProviders) : undefined,
      admin: form.withAdmin
        ? { firstName: form.adminFirstName.trim(), lastName: form.adminLastName.trim(), email: form.adminEmail.trim(), password: form.adminPassword, title: opt(form.adminTitle), phone: opt(form.adminPhone) }
        : undefined,
    };
    try {
      const created = await api.post<AdminOrg>("/admin/organizations", body);
      onCreated(created);
    } catch (e) {
      if (e instanceof ApiError) {
        const mapped: Record<string, string> = {};
        Object.entries(e.fieldErrors).forEach(([k, v]) => (mapped[serverKey(k)] = v));
        setErrors(mapped);
      }
      setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New Organization" subtitle="Create a tenant organization, optionally with a plan and its first admin" onClose={onClose} maxWidth={640}>
      <div className="space-y-3">
        <Field label="Organization Name *" error={errors.name}>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} className="input" placeholder="Enter Organization Name" autoFocus />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Organization Type" error={errors.orgType}>
            <Select value={form.orgType} onChange={(e) => set("orgType", e.target.value)} className="input">
              {withCurrent(orgTypes, form.orgType).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Tax ID (EIN)" error={errors.taxId}>
            <input value={form.taxId} onChange={(e) => set("taxId", e.target.value.replace(/\D/g, "").slice(0, 9))} className="input font-mono" placeholder="Enter Tax ID (EIN)" />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Email" error={errors.email}>
            <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="input" />
          </Field>
          <Field label="Ph.No" error={errors.phone}>
            <PhoneInput value={form.phone} onChange={(v) => set("phone", v)} invalid={!!errors.phone} />
          </Field>
        </div>
        <Field label="Website" error={errors.website}>
          <input value={form.website} onChange={(e) => set("website", e.target.value)} className="input" placeholder="Enter Website" />
        </Field>
        <Field label="Address" error={errors.address}>
          <input value={form.address} onChange={(e) => set("address", e.target.value)} className="input" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="State" error={errors.state}>
            <StateSelect
              value={form.state || ""}
              onChange={(v) => {
                if (v !== form.state) set("city", "");
                set("state", v);
              }}
            />
          </Field>
          <Field label="City" error={errors.city}>
            <CitySelect state={form.state || ""} value={form.city || ""} onChange={(v) => set("city", v)} />
          </Field>
          <Field label="ZIP" error={errors.zip}>
            <input value={form.zip} onChange={(e) => set("zip", e.target.value.replace(/\D/g, "").slice(0, 5))} className="input font-mono" />
          </Field>
        </div>

        <div className="pt-3 border-t border-line">
          <div className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider mb-2">Subscription</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Plan" error={errors.packageCode}>
              <Select value={form.packageCode} onChange={(e) => set("packageCode", e.target.value)} className="input" disabled={packages.loading}>
                <option value="">{packages.loading ? "Loading plans…" : "No subscription"}</option>
                {(packages.data || []).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </Select>
              {packages.error && <div className="field-error">{packages.error}</div>}
            </Field>
            {form.packageCode && (
              <Field label="Estimated Providers" error={errors.estimatedProviders}>
                <input type="number" min={1} value={form.estimatedProviders} onChange={(e) => set("estimatedProviders", e.target.value)} className="input" />
              </Field>
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-line">
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="checkbox" checked={form.withAdmin} onChange={(e) => set("withAdmin", e.target.checked)} />
            Create the first Org Admin account
          </label>
          {form.withAdmin && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="First Name *" error={errors.adminFirstName}>
                  <input value={form.adminFirstName} onChange={(e) => set("adminFirstName", e.target.value)} className="input" />
                </Field>
                <Field label="Last Name *" error={errors.adminLastName}>
                  <input value={form.adminLastName} onChange={(e) => set("adminLastName", e.target.value)} className="input" />
                </Field>
              </div>
              <Field label="Email *" error={errors.adminEmail} hint="This will be the admin's username">
                <input type="email" value={form.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} className="input" autoComplete="off" />
              </Field>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Password *" error={errors.adminPassword}>
                  <input type="password" value={form.adminPassword} onChange={(e) => set("adminPassword", e.target.value)} className="input" placeholder="Enter Password" autoComplete="new-password" />
                </Field>
                <Field label="Title" error={errors.adminTitle}>
                  <input value={form.adminTitle} onChange={(e) => set("adminTitle", e.target.value)} className="input" />
                </Field>
                <Field label="Ph.No" error={errors.adminPhone}>
                  <PhoneInput value={form.adminPhone} onChange={(v) => set("adminPhone", v)} invalid={!!errors.adminPhone} />
                </Field>
              </div>
            </div>
          )}
        </div>

        {formError && (
          <div className="px-3 py-2 rounded-lg flex items-center gap-2" style={{ background: "var(--danger-soft)", color: "#991b1b", fontSize: 13 }}>
            <Icon name="AlertCircle" size={14} /> {formError}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={submit} className="btn btn-primary" disabled={busy}>
            {busy ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Plus" size={13} />} Create Organization
          </button>
        </div>
      </div>
    </Modal>
  );
}
