"use client";

import { AlertBox } from "@/components/AlertBox";
import { Icon } from "@/components/Icon";
import { Loading } from "@/components/AsyncState";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/api";
import { useOrgStructure } from "@/components/providers/shared";
import { ProviderForm } from "@/components/providers/ProviderForm";
import type { ProviderDetail } from "@/types/providers";

/**
 * Prototype ProviderEditModal (L14614) → PUT /providers/{id}. Uses the same form (fields and required rules)
 * as Add Provider, so adding and editing always ask for the same details.
 */
export function ProviderEditModal({
  provider,
  orgId,
  onSaved,
  onClose,
}: {
  provider: ProviderDetail;
  /** super admin: the provider's organization (every request goes to it) */
  orgId?: number;
  onSaved: (p: ProviderDetail) => void;
  onClose: () => void;
}) {
  const org = useOrgStructure(true, orgId ?? null);
  const opts = orgId != null ? { orgId } : undefined;
  return (
    <Modal title={"Edit " + (provider.firstName || "") + " " + (provider.lastName || "")} subtitle={"NPI " + (provider.npi || "")} onClose={onClose} maxWidth={880}>
      {org.error ? (
        <div className="space-y-3">
          <AlertBox type="danger">{org.error}</AlertBox>
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={org.reload}><Icon name="RefreshCw" size={13} /> Retry</button>
          </div>
        </div>
      ) : !org.data ? (
        <Loading compact />
      ) : (
        <ProviderForm
          org={org.data}
          initial={provider}
          hasStoredPassword={!!provider.hasCaqhPassword}
          changePassword={{ hasLogin: !!provider.hasLogin }}
          providerId={provider.id}
          submitLabel="Update"
          onCancel={onClose}
          onSubmit={async ({ newPassword, ...body }) => {
            let p = await api.put<ProviderDetail>("/providers/" + provider.id, body, opts);
            if (newPassword) {
              // the provider's sign-in password (creates the sign-in when the provider has none yet)
              await api.put("/providers/" + provider.id + "/login-password", { password: newPassword }, opts);
              p = await api.get<ProviderDetail>("/providers/" + provider.id, undefined, opts);
            }
            onSaved(p);
          }}
        />
      )}
    </Modal>
  );
}
