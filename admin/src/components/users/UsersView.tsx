"use client";

import { Select } from "@/components/Select";

import { useState } from "react";
import { PhoneInput } from "@/components/PhoneInput";
import { PasswordInput } from "@/components/PasswordInput";
import { PHONE_RE, phoneDigits } from "@/lib/validation";
import { useEmailCheck } from "@/lib/useEmailCheck";
import { cleanSearch } from "@/lib/utils";
import { AccessDenied } from "@/components/AlertBox";
import { Avatar } from "@/components/Avatar";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { Pill } from "@/components/Pill";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth, useUser } from "@/stores/auth";
import { useAsync, useDebounced } from "@/lib/hooks";
import { useToast } from "@/stores/toast";
import { ROLE_LABEL } from "@/lib/constants";
import type { Role } from "@/types";
import { ROLES } from "@/types/permissions";
import type { ProviderLite, User, UserCreate, UserUpdate } from "@/types/users";
import { ProviderForm } from "@/components/providers/ProviderForm";
import { useOrgStructure } from "@/components/providers/shared";

export function UsersView() {
  const authUser = useUser();
  const { can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [editing, setEditing] = useState<User | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const q = useDebounced(search.trim());

  const canList = can("list", "user");
  const usersQ = useAsync<User[]>(canList ? () => api.get<User[]>("/users", { q }) : null, [q, canList]);
  // the "All Roles" filter lists the super admin's User Roles
  const roleList = useAsync<{ id: number; name: string; accessLevel: string }[]>(canList ? () => api.get<{ id: number; name: string; accessLevel: string }[]>("/user-roles") : null, [canList]);
  const filterRole = (roleList.data || []).find((r) => String(r.id) === roleFilter);
  const matchesRole = (u: User) =>
    u.userRoleId != null
      ? String(u.userRoleId) === roleFilter
      : !!filterRole && (filterRole.accessLevel === u.role || ((u.role as string) === "admin" && filterRole.accessLevel === "org_admin"));
  const users = { ...usersQ, data: usersQ.data ? (roleFilter === "all" ? usersQ.data : usersQ.data.filter(matchesRole)) : usersQ.data };
  // Unfiltered list for the header counts.
  const all = useAsync<User[]>(canList ? () => api.get<User[]>("/users") : null, [canList]);

  if (!canList) return <AccessDenied action="list" entity="users" role={ROLE_LABEL[authUser.role] || authUser.role} />;

  const reload = () => {
    users.reload();
    all.reload();
  };

  const doDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.delete("/users/" + pendingDelete.id);
      toast("User deleted");
      setPendingDelete(null);
      reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setDeleting(false);
    }
  };

  const allUsers = all.data || [];
  const filtered = users.data || [];

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={
          all.data
            ? allUsers.length + " total · " + allUsers.filter((u) => u.role === "provider").length + " providers · " + allUsers.filter((u) => u.role !== "provider").length + " staff"
            : "Loading…"
        }
        actions={
          can("create", "user") && (
            <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn btn-primary">
              <Icon name="UserPlus" size={13} /> Add User
            </button>
          )
        }
      />

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-xs" style={{ minWidth: 200 }}>
          <Icon name="Search" size={14} className="absolute" style={{ left: 10, top: 10, color: "var(--ink-faint)" }} />
          <input value={search} onChange={(e) => setSearch(cleanSearch(e.target.value))} placeholder="Search name, email, username..." className="input" style={{ paddingLeft: 32 }} />
        </div>
        <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="input" style={{ width: 200 }}>
          <option value="all">All Roles</option>
          {(roleList.data || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      </div>

      {users.error ? (
        <ErrorState message={users.error} onRetry={users.reload} />
      ) : (
        <div className="card overflow-hidden">
          {users.loading && !users.data ? (
            <Loading />
          ) : filtered.length === 0 ? (
            <EmptyState icon="Users" title="No users match" />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Name</th><th>Username</th><th>Role</th><th>Email</th><th>Status</th><th className="text-right">Actions</th></tr>
                </thead>
                <tbody>
                  {filtered.map((u) => {
                    const roleObj = ROLES.find((r) => r.id === u.role) || ROLES.find((r) => r.id === "org_admin")!;
                    return (
                      <tr key={u.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            <Avatar name={u.displayName || u.username} size={28} />
                            <div>
                              <div className="text-sm font-medium">{u.displayName || u.username}</div>
                              {u.title && <div className="text-[10px] text-ink-light">{u.title}</div>}
                              {u.role === "provider" && u.providerName && <div className="text-[10px] text-ink-faint">Linked: {u.providerName}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="font-mono text-xs">{u.username}</td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ background: roleObj.color }}></div>
                            <span className="text-xs">{u.userRoleName || roleObj.label}</span>
                          </div>
                          {u.userRoleName && <div className="text-[10px] text-ink-faint ml-3.5">{roleObj.label}</div>}
                        </td>
                        <td className="text-xs text-ink-light">{u.email || "—"}</td>
                        <td>
                          <Pill type={u.disabled ? "danger" : "success"}>{u.disabled ? "Disabled" : "Active"}</Pill>
                        </td>
                        <td className="text-right" style={{ whiteSpace: "nowrap" }}>
                          <div className="inline-flex items-center justify-end gap-1">
                            {can("update", "user") && (
                              <button onClick={() => { setEditing(u); setShowForm(true); }} className="btn btn-ghost text-xs">
                                <Icon name="Edit" size={11} /> Edit
                              </button>
                            )}
                            {can("delete", "user") &&
                              (u.id !== authUser.id ? (
                                <button onClick={() => setPendingDelete(u)} className="btn-ghost p-1 hover:text-danger" title="Delete user" aria-label={"Delete " + u.displayName} style={{ width: 22 }}>
                                  <Icon name="Trash2" size={11} />
                                </button>
                              ) : (
                                // keeps Edit lined up with the other rows (you can't delete yourself)
                                <span aria-hidden style={{ width: 22, display: "inline-block" }} />
                              ))}
                          </div>
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

      {showForm && (
        <UserFormModal
          user={editing}
          isSelf={!!editing && editing.id === authUser.id}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            reload();
          }}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="Delete user"
          message={"Delete user " + pendingDelete.displayName + "? This cannot be undone."}
          busy={deleting}
          onConfirm={doDelete}
          onClose={() => !deleting && setPendingDelete(null)}
        />
      )}
    </div>
  );
}

interface UserForm {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: Role;
  userRoleId: string;
  title: string;
  phone: string;
  providerId: string;
  disabled: boolean;
}


export function UserFormModal({ user, isSelf, onSaved, onClose }: { user: User | null; isSelf: boolean; onSaved: () => void; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<UserForm>(
    user
      ? {
          firstName: user.firstName || (user.displayName || "").split(" ")[0] || "",
          lastName: user.lastName || (user.displayName || "").split(" ").slice(1).join(" "),
          email: user.email || "",
          password: "",
          role: user.role,
          userRoleId: user.userRoleId ? String(user.userRoleId) : "",
          title: user.title || "",
          phone: phoneDigits(user.phone),
          providerId: user.providerId ? String(user.providerId) : "",
          disabled: user.disabled,
        }
      : { firstName: "", lastName: "", email: "", password: "", role: "clerk", userRoleId: "", title: "", phone: "", providerId: "", disabled: false }
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  // role names managed by the super admin (User Roles)
  const userRoles = useAsync<{ id: number; name: string; accessLevel: Role; active: boolean; builtIn: boolean }[]>(() => api.get<{ id: number; name: string; accessLevel: Role; active: boolean; builtIn: boolean }[]>("/user-roles"), []);
  // the chosen role decides the access level (set per role by the super admin)
  const chosenRole = (userRoles.data || []).find((r) => String(r.id) === form.userRoleId);
  const access: Role | undefined = chosenRole?.accessLevel;
  const providers = useAsync<ProviderLite[]>(access === "provider" ? () => api.get<ProviderLite[]>("/providers/all-lite") : null, [access === "provider"]);
  // Add User with a provider role: the provider is added with every Add Provider Manually field + their sign-in
  const newProvider = !user && access === "provider";
  const org = useOrgStructure(newProvider);

  const emailTaken = useEmailCheck(
    form.email,
    { kind: "user", id: user?.id, providerId: access === "provider" && form.providerId ? Number(form.providerId) : undefined, orgAdmin: access === "org_admin" },
    !newProvider
  );

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = "Required";
    if (!form.lastName.trim()) e.lastName = "Required";
    if (!form.email) e.email = "Email is required";
    else if (!/^[^@]+@[^@]+\.[^@]+$/.test(form.email)) e.email = "Enter a valid email address";
    else if (emailTaken) e.email = emailTaken;
    if (!form.phone) e.phone = "Required";
    else if (!PHONE_RE.test(form.phone)) e.phone = "Ph.No must be 10 digits";
    if (!user && !form.password) e.password = "Password is required";
    else if (form.password && form.password.length < 8) e.password = "Password must be at least 8 characters";
    if (!form.role) e.role = "Required";
    if (!form.userRoleId) e.userRoleId = "Choose a role";
    if (access === "provider" && !form.providerId) e.providerId = "Select the provider this login belongs to";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setBusy(true);
    setFormError("");
    const common = {
      displayName: (form.firstName.trim() + " " + form.lastName.trim()).trim(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      role: access || form.role,
      userRoleId: Number(form.userRoleId),
      title: form.title.trim() || undefined,
      phone: form.phone.trim() || undefined,
      providerId: access === "provider" && form.providerId ? Number(form.providerId) : null,
      disabled: form.disabled,
    };
    try {
      if (user) {
        const body: UserUpdate = { ...common, password: form.password || null };
        await api.put("/users/" + user.id, body);
        toast("User updated");
      } else {
        // the email is the username
        const body: UserCreate = { ...common, password: form.password };
        await api.post("/users", body);
        toast("User created");
      }
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) {
        const fe = { ...e.fieldErrors };
        if (fe.displayName && !fe.firstName) fe.firstName = fe.displayName;
        if (fe.username && !fe.email) fe.email = fe.username;
        setErrors(fe);
        if (!Object.keys(fe).length) setFormError(errorMessage(e));
      } else setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Every role the super admin created is offered except the built-in Administrator role (admins are created by
  // the super admin) and Provider role (providers are added in the Providers module).
  const roleSelect = (
    <Select value={form.userRoleId} onChange={(e) => { setForm({ ...form, userRoleId: e.target.value }); setErrors((er) => ({ ...er, userRoleId: "" })); }} className="input" disabled={userRoles.loading || isSelf} title={isSelf ? "You cannot change your own role" : undefined}>
      <option value="">{userRoles.loading ? "Loading roles…" : "— Select role —"}</option>
      {(userRoles.data || [])
        .filter((r) => r.id === user?.userRoleId || (r.active !== false && !r.builtIn))
        .map((r) => <option key={r.id} value={r.id}>{r.name}{r.active === false ? " (disabled)" : ""}</option>)}
    </Select>
  );
  if (newProvider) {
    return (
      <Modal title="Add User" onClose={onClose} maxWidth={880}>
        {org.error ? (
          <div className="field-error">{org.error}</div>
        ) : !org.data ? (
          <Loading compact />
        ) : (
          <ProviderForm
            org={org.data}
            initial={{ email: form.email }}
            withLogin
            submitLabel="Create User"
            onCancel={onClose}
            top={
              <div className="pb-3 mb-1 border-b border-line">
                <Field label="Role *" error={errors.userRoleId}>{roleSelect}</Field>
              </div>
            }
            onSubmit={async ({ password, ...provider }) => {
              await api.post("/users/with-provider", { password, userRoleId: Number(form.userRoleId), provider });
              toast("Provider and sign-in created");
              onSaved();
            }}
          />
        )}
      </Modal>
    );
  }

  return (
    <Modal title={user ? "Edit User" : "Add User"} onClose={onClose} maxWidth={640}>
      <div className="space-y-3">
        <Field label="Role *" error={errors.userRoleId} hint={!user && !form.userRoleId ? "Choose the role first — the form shows the fields for that role." : undefined}>
          {roleSelect}
          {userRoles.error && <div className="field-error">{userRoles.error}</div>}
        </Field>
        {!user && !form.userRoleId ? (
          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          </div>
        ) : (
        <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="First Name *" error={errors.firstName}>
            <input value={form.firstName} onChange={(e) => { setForm({ ...form, firstName: e.target.value }); setErrors((er) => ({ ...er, firstName: "" })); }} className="input" maxLength={100} />
          </Field>
          <Field label="Last Name *" error={errors.lastName}>
            <input value={form.lastName} onChange={(e) => { setForm({ ...form, lastName: e.target.value }); setErrors((er) => ({ ...er, lastName: "" })); }} className="input" maxLength={100} />
          </Field>
        </div>
        <Field label="Title" error={errors.title}>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input" placeholder="Enter Title" maxLength={120} />
        </Field>
        {access === "provider" && (
          <Field label="Linked Provider *" error={errors.providerId}>
            <Select value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })} className="input" disabled={providers.loading}>
              <option value="">{providers.loading ? "Loading providers…" : "— Select provider —"}</option>
              {(providers.data || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.npi ? " · NPI " + p.npi : ""}
                </option>
              ))}
            </Select>
            {providers.error && <div className="field-error">{providers.error}</div>}
          </Field>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Email *" error={errors.email || emailTaken} hint="Used to sign in">
            <input type="email" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); setErrors((er) => ({ ...er, email: "" })); }} className="input" autoComplete="off" />
          </Field>
          <Field label="Ph.No *" error={errors.phone}>
            <PhoneInput value={form.phone} onChange={(v) => { setForm({ ...form, phone: v }); setErrors((er) => ({ ...er, phone: "" })); }} invalid={!!errors.phone} />
          </Field>
          <Field label={user ? "New Password" : "Password *"} error={errors.password} hint={user ? "Blank = keep the current one" : undefined}>
            <PasswordInput value={form.password} onChange={(e) => { setForm({ ...form, password: e.target.value }); setErrors((er) => ({ ...er, password: "" })); }} className="input" placeholder="Enter Password" autoComplete="new-password" />
          </Field>
        </div>
        {user && user.username !== user.email && (
          <div className="text-[11px] text-ink-faint">Username: <span className="font-mono">{user.username}</span> (this user can also sign in with it)</div>
        )}
        {user && access !== "provider" && (
          <label className="flex items-center gap-2 text-sm" style={isSelf ? { opacity: 0.6 } : undefined}>
            <input type="checkbox" checked={form.disabled} disabled={isSelf} onChange={(e) => setForm({ ...form, disabled: e.target.checked })} />
            Disabled (user cannot sign in)
          </label>
          )}
        {formError && (
          <div className="px-3 py-2 rounded-lg flex items-center gap-2" style={{ background: "var(--danger-soft)", color: "#991b1b", fontSize: 13 }}>
            <Icon name="AlertCircle" size={14} /> {formError}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={submit} className="btn btn-primary" disabled={busy}>
            {busy ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Save" size={13} />} {user ? "Update" : "Create User"}
          </button>
        </div>
        </>
        )}
      </div>
    </Modal>
  );
}
