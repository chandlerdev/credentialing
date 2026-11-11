"use client";

import { Icon } from "@/components/Icon";
import { Pill } from "@/components/Pill";
import { fmtDate } from "@/lib/utils";
import type { AdminSummary } from "./types";

/** The admins (one per organization account) created by the super admin; onEdit adds an Edit button per row. */
export function AdminsTable({ admins, emptyText, onEdit }: { admins: AdminSummary[]; emptyText?: string; onEdit?: (a: AdminSummary) => void }) {
  const cols = onEdit ? 9 : 8;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Admin</th>
            <th>Email</th>
            <th>Organization</th>
            <th>Plan</th>
            <th className="text-right">Users</th>
            <th className="text-right">Providers</th>
            <th>Status</th>
            <th>Created</th>
            {onEdit && <th className="text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {admins.length === 0 && emptyText && (
            <tr>
              <td colSpan={cols} className="text-center text-sm text-ink-light py-8">{emptyText}</td>
            </tr>
          )}
          {admins.map((a) => (
            <tr key={a.userId} data-admin-row={a.userId}>
              <td className="font-medium text-ink">{a.name}</td>
              <td className="text-xs text-ink-light">{a.email}</td>
              <td className="text-sm">{a.orgName || "—"}</td>
              <td className="text-xs">{a.planName || "—"}</td>
              <td className="text-right font-mono text-xs">{a.userCount}</td>
              <td className="text-right font-mono text-xs">{a.providerCount}</td>
              <td>
                {a.disabled ? <Pill type="neutral">Disabled</Pill> : a.orgStatus === "suspended" ? <Pill type="danger">Suspended</Pill> : <Pill type="success">Active</Pill>}
              </td>
              <td className="text-xs text-ink-light">{fmtDate(a.createdAt)}</td>
              {onEdit && (
                <td className="text-right">
                  <button className="btn btn-ghost text-xs" onClick={() => onEdit(a)} aria-label={"Edit " + a.name} data-edit-admin={a.userId}>
                    <Icon name="Pencil" size={12} /> Edit
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
