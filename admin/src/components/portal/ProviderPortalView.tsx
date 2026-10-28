"use client";

import Link from "next/link";
import { useState } from "react";
import { DocStatusBadge, StatusPill } from "@/components/Pill";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { fmtDate } from "@/lib/utils";
import { useAsync } from "@/lib/hooks";
import { DocumentUploadView } from "@/components/providers/DocumentUploadView";
import { ProviderForm } from "@/components/providers/ProviderForm";
import { DownloadButton, MandatoryMark, ViewFileButton } from "@/components/providers/ProviderOverview";
import { DocTableCols } from "@/components/providers/AdditionalDocuments";
import type { MyEnrollment, ProviderDetail } from "@/types/providers";

/** Loads GET /me/provider; a 404 means no provider profile is linked to this account. */
function useMyProvider() {
  return useAsync<ProviderDetail | null>(async () => {
    try {
      return await api.get<ProviderDetail>("/me/provider");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }, []);
}

function useMyEnrollments() {
  return useAsync<MyEnrollment[]>(() => api.get<MyEnrollment[]>("/me/enrollments"), []);
}

/** Banner for providers who signed up without an invite code (no organization yet). */
function NoOrganizationBanner() {
  return (
    <div className="card card-pad mb-6" style={{ background: "var(--info-soft)", borderColor: "var(--info)" }}>
      <div className="flex items-start gap-3">
        <Icon name="Building2" size={20} className="flex-shrink-0 mt-0.5" style={{ color: "var(--info)" }} />
        <div className="flex-1">
          <h3 className="font-display font-semibold text-ink">You&apos;re not linked to an organization yet</h3>
          <p className="text-sm text-ink-light mt-1">
            Your account was created without an organization invite code. An administrator of the credentialing organization you work with must link your account before your documents and
            enrollments appear here. Ask them to add you, or to send you an invite code.
          </p>
        </div>
      </div>
    </div>
  );
}

function PortalGate({ title, children }: { title: string; children: (p: ProviderDetail) => React.ReactNode }) {
  const { user } = useAuth();
  const me = useMyProvider();
  const noOrg = !user?.orgId;
  if (me.error) return <ErrorState message={me.error} onRetry={me.reload} />;
  if (me.loading && me.data === undefined) return <Loading />;
  if (!me.data)
    return (
      <div>
        <PageHeader title={title} />
        {noOrg && <NoOrganizationBanner />}
        <div className="card">
          <EmptyState
            icon="UserX"
            title="No provider profile linked"
            description={noOrg ? "Your profile will appear here once an organization admin links your account." : "Ask your organization admin to link your user account to your provider profile."}
          />
        </div>
      </div>
    );
  return (
    <>
      {noOrg && <NoOrganizationBanner />}
      {children(me.data)}
    </>
  );
}

const nonNa = (p: ProviderDetail) => p.documents.filter((d) => d.status !== "na");

/** Prototype ProviderPortalView "My Portal" (L3781). */
export function MyPortalView() {
  return <PortalGate title="My Portal">{(p) => <MyPortal provider={p} />}</PortalGate>;
}

function MyPortal({ provider }: { provider: ProviderDetail }) {
  const enrollments = useMyEnrollments();
  const docs = nonNa(provider);
  const approved = docs.filter((d) => d.status === "approved").length;
  const total = docs.length;
  const missing = docs.filter((d) => d.status === "missing" || d.status === "expired").length;
  const enr = enrollments.data || [];

  return (
    <div>
      <PageHeader title={"Welcome back, " + provider.firstName} subtitle="Here's the status of your credentialing." />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <StatCard label="Document Requirements" value={approved + "/" + total} sub={missing + " missing"} icon="FileText" color={missing > 0 ? "var(--warn)" : "var(--success)"} />
        <StatCard
          label="Active Enrollments"
          value={enrollments.loading && !enrollments.data ? "…" : enr.filter((e) => e.status === "approved").length}
          sub={enrollments.error ? "Could not load" : enr.length + " total"}
          icon="ClipboardCheck"
          color="var(--success)"
        />
        <StatCard label="Pending Action" value={missing} sub={missing > 0 ? "Action needed" : "All good"} icon="AlertCircle" color={missing > 0 ? "var(--accent)" : "var(--success)"} emphasize={missing > 0} />
      </div>

      {missing > 0 && (
        <div className="card card-pad mb-6" style={{ background: "var(--accent-soft)", borderColor: "var(--accent)" }}>
          <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap">
            <Icon name="AlertTriangle" size={20} className="text-accent flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-display font-semibold text-ink">Action Required</h3>
              <p className="text-sm text-ink-light mt-1">You have {missing} document(s) that need to be uploaded or updated. This may delay your credentialing.</p>
            </div>
            <Link href="/my-documents" className="btn btn-primary">
              Go to My Documents <Icon name="ArrowRight" size={14} />
            </Link>
          </div>
        </div>
      )}

      <div className="card card-pad">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-semibold text-ink">My Documents</h3>
          <Link href="/my-documents" className="text-xs text-accent hover:underline">View all</Link>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Status</th>
                <th>Mandatory</th>
                <th>Expires</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {provider.documents.slice(0, 8).map((doc) => {
                if (doc.status === "na") return null;
                return (
                  <tr key={doc.id}>
                    <td className="font-medium">
                      {doc.label}
                      {doc.fileName && <div className="text-[10px] text-ink-faint font-normal truncate" style={{ maxWidth: 320 }}>{doc.fileName}</div>}
                    </td>
                    <td>
                      <DocStatusBadge status={doc.status} />
                    </td>
                    <td className="text-xs">
                      <MandatoryMark yes={doc.critical} />
                    </td>
                    <td className="text-ink-light text-xs">{doc.expiresAt ? fmtDate(doc.expiresAt) : "—"}</td>
                    <td className="text-ink-light text-xs">{doc.uploadedAt ? fmtDate(doc.uploadedAt) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Prototype ProviderPortalView "my_documents" (L3719). */
/** Provider → Manage Profile: the rest of their details (email, NPI, status and organization are fixed). */
export function ManageProfileView() {
  return <PortalGate title="Manage Profile">{(p) => <ManageProfile provider={p} />}</PortalGate>;
}

function ManageProfile({ provider }: { provider: ProviderDetail }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const [current, setCurrent] = useState(provider);
  return (
    <div>
      <PageHeader title="Manage Profile" subtitle="Complete or correct your details. Fields marked as set by your credentialing team can't be changed here." />
      <div className="card card-pad">
        <ProviderForm
          key={version}
          org={{ clients: [], practices: [], locations: [] }}
          initial={current}
          hasStoredPassword={!!current.hasCaqhPassword}
          providerId={current.id}
          selfService
          submitLabel="Update Profile"
          submitIcon="Save"
          cancelLabel="Discard Changes"
          onCancel={() => setVersion((v) => v + 1)}
          onSubmit={async ({ newPassword: _np, password: _pw, ...body }) => {
            void _np;
            void _pw;
            const saved = await api.put<ProviderDetail>("/me/provider/profile", body);
            setCurrent(saved);
            setVersion((v) => v + 1);
            toast("Profile updated");
          }}
        />
      </div>
    </div>
  );
}

export function MyDocumentsView() {
  return <PortalGate title="My Documents">{(p) => <MyDocuments provider={p} />}</PortalGate>;
}

function MyDocuments({ provider }: { provider: ProviderDetail }) {
  const docs = nonNa(provider);
  const approved = docs.filter((d) => d.status === "approved").length;
  return (
    <div>
      <PageHeader
        title="My Documents"
        subtitle={approved + " of " + docs.length + " requirements met"}
      />
      <div className="-mt-2 mb-4 text-xs rounded-md px-3 py-2 flex items-start gap-2" style={{ background: "var(--info-soft)", color: "#1d4ed8" }}>
        <Icon name="Info" size={13} className="mt-0.5 shrink-0" />
        <span>Word documents can&apos;t be viewed here — you can review them only by downloading them.</span>
      </div>
      <div className="card overflow-hidden">
        <div className="table-scroll">
          <table>
            <DocTableCols />
            <thead>
              <tr>
                <th>Document</th>
                <th>Status</th>
                <th>Mandatory</th>
                <th>Expires</th>
                <th>Last Updated</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td className="font-medium">
                    {doc.label}
                    {doc.fileName && <div className="text-[10px] text-ink-faint font-normal truncate" style={{ maxWidth: 320 }}>{doc.fileName}</div>}
                  </td>
                  <td>
                    <DocStatusBadge status={doc.status} />
                  </td>
                  <td className="text-xs">
                    <MandatoryMark yes={doc.critical} />
                  </td>
                  <td className="text-ink-light text-xs">{doc.expiresAt ? fmtDate(doc.expiresAt) : "—"}</td>
                  <td className="text-ink-light text-xs">{doc.uploadedAt ? fmtDate(doc.uploadedAt) : "—"}</td>
                  <td className="text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      {doc.hasFile && <ViewFileButton doc={doc} eye />}
                      {doc.hasFile && <DownloadButton doc={doc} />}
                      <Link
                        href={"/my-documents/upload?docType=" + encodeURIComponent(doc.docType)}
                        className={"btn ml-1 " + (doc.hasFile ? "btn-primary" : "btn-secondary")}
                        style={{ fontSize: 11, padding: "5px 10px" }}
                        aria-label={(doc.hasFile ? "Replace " : "Upload ") + doc.label}
                      >
                        <Icon name={doc.hasFile ? "RefreshCw" : "Upload"} size={11} /> {doc.hasFile ? "Replace" : "Upload"}
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Prototype ProviderPortalView "my_enrollments" (L3748). */
export function MyEnrollmentsView() {
  const { user } = useAuth();
  const enrollments = useMyEnrollments();
  const list = enrollments.data || [];
  const active = list.filter((e) => e.status === "approved").length;
  return (
    <div>
      <PageHeader title="My Enrollments" subtitle={enrollments.data ? active + " active enrollment(s) · " + list.length + " total" : undefined} />
      {!user?.orgId && <NoOrganizationBanner />}
      {enrollments.error ? (
        <ErrorState message={enrollments.error} onRetry={enrollments.reload} />
      ) : (
        <div className="card overflow-hidden">
          {enrollments.loading && !enrollments.data ? (
            <Loading />
          ) : list.length === 0 ? (
            <EmptyState icon="ClipboardList" title="No enrollments yet" description="Your organization hasn't started any payer enrollments for you yet." />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Payer</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th>Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: e.payerColor || "var(--ink-faint)" }}></div>
                          <span className="font-medium">{e.payerName || "—"}</span>
                        </div>
                      </td>
                      <td>
                        <StatusPill status={e.status} />
                      </td>
                      <td className="text-ink-light text-xs">{fmtDate(e.submittedDate)}</td>
                      <td className="text-ink-light text-xs">{fmtDate(e.effectiveDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** /my-documents/upload — reuses the staff DocumentUploadView with the provider's own record. */
export function MyDocumentsUploadView({ docType }: { docType?: string | null }) {
  return <PortalGate title="Document Upload">{(p) => <DocumentUploadView providerId={p.id} portal lockedDocType={docType || null} />}</PortalGate>;
}
