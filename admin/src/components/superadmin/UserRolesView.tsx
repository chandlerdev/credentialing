"use client";

import { Select } from "@/components/Select";

import { useState } from "react";
import { matchesSearch } from "@/lib/search";
import { cleanSearch } from "@/lib/utils";
import { AsyncBoundary } from "@/components/AsyncState";
import { EmptyState } from "@/components/EmptyState";
import { Field, RequiredMark } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useToast } from "@/stores/toast";
import type { UserRoleItem } from "./types";

const NAME_RE = /^[A-Za-z][A-Za-z0-9 &/().,'-]*$/;



/** Super admin → User Roles: add, rename and delete role names. Org admins pick one in Users → Add user. */
export function UserRolesView() {
  const toast = useToast();
  const roles = useAsync<UserRoleItem[]>(() => api.get<UserRoleItem[]>("/user-roles"), []);
  const [editing, setEditing] = useState<UserRoleItem | "new" | null>(null);
  const [deleting, setDeleting] = useState<UserRoleItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);
  const [disabling, setDisabling] = useState<UserRoleItem | null>(null);
  const list = roles.data || [];
  const [search, setSearch] = useState("");
  const shown = list.filter((r) => matchesSearch(search, r.name, r.active ? "enabled" : "disabled"));

  const toggleActive = async (r: UserRoleItem) => {
    // disabling signs the role's users out: ask first when anybody has it
    if (r.active && r.userCount > 0 && disabling?.id !== r.id) {
      setDisabling(r);
      return;
    }
    setDisabling(null);
    setToggling(r.id);
    try {
      await api.patch("/user-roles/" + r.id + "/active", { active: !r.active });
      toast(r.active ? r.name + " disabled — its users can no longer sign in" : r.name + " enabled");
      roles.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setToggling(null);
    }
  };

  const [moveTo, setMoveTo] = useState("");
  const [moveError, setMoveError] = useState("");
  const startDelete = (r: UserRoleItem) => {
    setMoveTo("");
    setMoveError("");
    setDeleting(r);
  };
  const doDelete = async () => {
    if (!deleting) return;
    if (deleting.userCount > 0 && !moveTo) {
      setMoveError("Choose the role to move the user(s) to");
      return;
    }
    setDeleteBusy(true);
    try {
      await api.delete("/user-roles/" + deleting.id + (deleting.userCount > 0 ? "?moveTo=" + moveTo : ""));
      toast(deleting.userCount > 0 ? "Role deleted — its users were moved" : "Role deleted");
      setDeleting(null);
      roles.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="User Roles"
        subtitle="Role names admins give their users (Users → Add user → Role). What each role can do is set in Permissions."
        actions={
          <button onClick={() => setEditing("new")} className="btn btn-primary">
            <Icon name="Plus" size={14} /> Add Role
          </button>
        }
      />
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Icon name="Search" size={14} className="absolute" style={{ left: 10, top: 10, color: "var(--ink-faint)" }} />
          <input value={search} onChange={(e) => setSearch(cleanSearch(e.target.value))} placeholder="Search role name..." className="input" style={{ paddingLeft: 32 }} aria-label="Search roles" />
        </div>
      </div>
      <div className="card overflow-hidden">
        <AsyncBoundary loading={roles.loading && !roles.data} error={roles.error} onRetry={roles.reload}>
          {list.length === 0 ? (
            <EmptyState icon="BadgeCheck" title="No roles yet" description="Add the first role name." />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Role Name</th>
                    <th className="text-right">Users</th>
                    <th className="text-center">Status</th>
                    <th className="text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center text-sm text-ink-light py-8">No roles match “{search.trim()}”</td>
                    </tr>
                  )}
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium text-ink">
                        {r.name}
                        {r.builtIn && (
                          <span
                            className="ml-2 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                            style={{ background: "var(--surface-muted, #f1f5f9)", color: "var(--ink-light)" }}
                            title={r.accessLevel === "provider" ? "Given to providers added in the Providers module" : "Given to admins created in Create Admin"}
                          >
                            Built-in
                          </span>
                        )}
                      </td>
                      <td className="text-right font-mono text-xs">{r.userCount}</td>
                      <td className="text-center">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={r.active}
                            aria-label={(r.active ? "Disable " : "Enable ") + r.name}
                            title={r.builtIn ? "Built-in role — always enabled" : r.active ? "Enabled — click to disable (its users cannot sign in)" : "Disabled — click to enable"}
                            onClick={() => toggleActive(r)}
                            disabled={toggling === r.id || r.builtIn}
                            style={{
                              width: 36,
                              height: 20,
                              borderRadius: 999,
                              position: "relative",
                              background: r.active ? "var(--success, #059669)" : "var(--line-strong, #cbd5e1)",
                              transition: "background .15s",
                              opacity: toggling === r.id || r.builtIn ? 0.6 : 1,
                              cursor: r.builtIn ? "not-allowed" : toggling === r.id ? "wait" : "pointer",
                            }}
                          >
                            <span
                              style={{
                                position: "absolute",
                                top: 2,
                                left: r.active ? 18 : 2,
                                width: 16,
                                height: 16,
                                borderRadius: 999,
                                background: "white",
                                boxShadow: "0 1px 2px rgba(0,0,0,.25)",
                                transition: "left .15s",
                              }}
                            />
                          </button>
                          <span className="text-xs" style={{ color: r.active ? "var(--success, #059669)" : "var(--ink-faint)", minWidth: 52, textAlign: "left" }}>
                            {r.active ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      </td>
                      <td className="text-center whitespace-nowrap">
                        <button onClick={() => setEditing(r)} className="btn btn-ghost text-xs" aria-label={"Edit " + r.name}>
                          <Icon name="Pencil" size={12} /> Edit
                        </button>
                        <button
                          onClick={() => startDelete(r)}
                          className="btn btn-ghost text-xs"
                          style={{ color: "var(--danger)", opacity: r.builtIn ? 0.4 : 1, cursor: r.builtIn ? "not-allowed" : undefined }}
                          disabled={r.builtIn}
                          title={r.builtIn ? "Built-in role — cannot be deleted" : r.userCount ? "Assigned to " + r.userCount + " user(s) — they move to another role" : "Delete"}
                          aria-label={"Delete " + r.name}
                        >
                          <Icon name="Trash2" size={12} /> Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AsyncBoundary>
      </div>

      {editing && (
        <RoleModal
          role={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            roles.reload();
          }}
        />
      )}
      {disabling && (
        <ConfirmDialog
          title="Disable role"
          message={
            <>
              <strong>{disabling.name}</strong> is assigned to {disabling.userCount} user(s). Disabled, they cannot sign in until the role is
              enabled again (their accounts are kept).
            </>
          }
          confirmLabel="Disable"
          busy={toggling === disabling.id}
          onConfirm={() => toggleActive(disabling)}
          onClose={() => setDisabling(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete role"
          message={
            deleting.userCount > 0 ? (
              <div className="space-y-3">
                <div>
                  <strong>{deleting.name}</strong> is assigned to {deleting.userCount} user(s). Choose the role they move to, then the role is deleted.
                </div>
                <div>
                  <label className="label" htmlFor="move-to">Move the user(s) to<RequiredMark /></label>
                  <Select
                    id="move-to"
                    value={moveTo}
                    onChange={(e) => {
                      setMoveTo(e.target.value);
                      setMoveError("");
                    }}
                    className={"input" + (moveError ? " input-error" : "")}
                  >
                    <option value="">— Select a role —</option>
                    {list.filter((x) => x.id !== deleting.id && !x.builtIn).map((x) => (
                      <option key={x.id} value={x.id}>{x.name}{x.active ? "" : " (disabled)"}</option>
                    ))}
                  </Select>
                  {moveError && <div className="field-error">{moveError}</div>}
                </div>
              </div>
            ) : (
              <>Delete the role <strong>{deleting.name}</strong>?</>
            )
          }
          busy={deleteBusy}
          onConfirm={doDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function RoleModal({ role, onClose, onSaved }: { role: UserRoleItem | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(role?.name || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const v = name.trim().replace(/\s+/g, " ");
    if (!v) return setError("Role name is required");
    if (v.length < 2) return setError("At least 2 characters");
    if (v.length > 80) return setError("At most 80 characters");
    if (!NAME_RE.test(v)) return setError("Start with a letter; letters, digits, spaces and & / ( ) . , ' - only");
    setBusy(true);
    try {
      if (role) await api.put("/user-roles/" + role.id, { name: v });
      else await api.post("/user-roles", { name: v });
      toast(role ? "Role updated" : "Role added");
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError && e.fieldErrors.name ? e.fieldErrors.name : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={role ? "Edit Role" : "Add Role"} onClose={onClose} maxWidth={440}>
      <div className="space-y-3">
        {role && role.userCount > 0 && (
          <div className="text-xs text-ink-light">
            {role.userCount} user(s) have this role — they keep it under the new name, with the same permissions.
          </div>
        )}
        <Field label="Role Name" required error={error}>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value.replace(/^\s+/, ""));
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="input"
            maxLength={80}
            autoFocus
            placeholder="Enter Role Name"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={save} className="btn btn-primary" disabled={busy}>
            {busy ? <span className="loader" /> : <Icon name="Save" size={13} />} {role ? "Update" : "Add Role"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
