"use client";

import { Select } from "@/components/Select";
import { StateSelect } from "@/components/AddressFields";

import { Fragment, useRef, useState } from "react";
import { PhoneInput } from "@/components/PhoneInput";
import { PasswordInput } from "@/components/PasswordInput";
import { Loading } from "@/components/AsyncState";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/Pill";
import { ApiError, api, errorMessage } from "@/lib/api";
import { fmtDate, fmtTs, todayISO } from "@/lib/utils";
import { ALLOWED_EXT, fileExt, MAX_FILE_BYTES, NPI_RE, PROVIDER_STATUS_OPTIONS } from "@/components/providers/shared";
import {
  BillingSection,
  FormSection,
  GroupRow,
  HomeAddressBlock,
  IdsRow,
  OTHER,
  PecosPasswordField,
  PersonalRow,
  PracticeSection,
  SpecialtyField,
  SuffixSelect,
  extraFieldErrors,
  extraFromView,
  extraPayload,
  extraProblems,
  specialtyValue,
  type ExtraForm,
} from "@/components/providers/ProviderExtraFields";
import { useAsync } from "@/lib/hooks";
import { PHONE_RE, phoneDigits } from "@/lib/validation";
import type { PublicInviteInfo, PublicLinkStatus, PublicMissingDoc, PublicUploadResult } from "@/types/providers";

type Step = "profile" | "docs" | "review" | "done";
const PROFILE_STEPS: Step[] = ["profile", "docs", "review", "done"];
/** Request Documents links: only the requested documents, then submit */
const DOCUMENT_STEPS: Step[] = ["docs", "done"];

interface Profile {
  firstName: string;
  lastName: string;
  npi: string;
  caqhId: string;
  suffix: string;
  specialty: string;
  /** the typed specialty when "Other" is chosen */
  specialtyOther: string;
  phone: string;
  dateOfBirth: string;
  licenseNumber: string;
  licenseState: string;
  licenseExpires: string;
  deaNumber: string;
  deaExpires: string;
  caqhUsername: string;
  caqhPassword: string;
  pecosAccess: string;
  pecosUsername: string;
  /** sign-in password, asked while the provider has no login */
  password: string;
  confirmPassword: string;
}

interface Uploaded {
  fileName: string;
  size: number;
  /** the expiration date sent with the file (expiring documents) */
  expiresAt?: string;
}

/**
 * Prototype v2 SecureLinkPortal — the provider-facing page behind a secure link (/admin/upload/{token}):
 * PIN → profile → documents → review & submit. A document request (Request Documents) skips to the requested documents.
 */
export function SecureLinkPortal({ token }: { token: string }) {
  const base = "/public/invites/" + encodeURIComponent(token);
  const statusQuery = useAsync<PublicLinkStatus>(() => api.get<PublicLinkStatus>(base), [base]);
  const status = statusQuery.data;
  const invalid = statusQuery.error;
  const [info, setInfo] = useState<PublicInviteInfo | null>(null);
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step>("profile");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<ExtraForm>(() => extraFromView(null));
  const [docs, setDocs] = useState<PublicMissingDoc[]>([]);
  const [uploaded, setUploaded] = useState<Record<string, Uploaded>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const authenticate = async () => {
    if (pin.length !== 6) {
      setAuthError("Enter the 6-digit PIN from your email");
      return;
    }
    setBusy(true);
    setAuthError("");
    try {
      const res = await api.post<PublicInviteInfo>(base + "/verify", { pin });
      const p = res.profile;
      setInfo(res);
      setDocs(res.missingDocuments);
      setProfile({
        firstName: res.firstName || "",
        lastName: res.lastName || "",
        npi: p.npi || "",
        caqhId: p.caqhId || "",
        suffix: p.suffix || "",
        specialty: p.specialty === "Other" ? OTHER : p.specialty || "",
        specialtyOther: "",
        phone: phoneDigits(p.phone),
        dateOfBirth: p.dateOfBirth || "",
        licenseNumber: p.licenseNumber || "",
        licenseState: p.licenseState || "",
        licenseExpires: p.licenseExpires || "",
        deaNumber: p.deaNumber || "",
        deaExpires: p.deaExpires || "",
        caqhUsername: "",
        caqhPassword: "",
        pecosAccess: "",
        pecosUsername: "",
        password: "",
        confirmPassword: "",
      });
      setExtra(extraFromView(p.extra));
      setStep(res.purpose === "documents" ? "docs" : "profile");
    } catch (err) {
      setAuthError(errorMessage(err));
      setPin("");
      statusQuery.reload();
    } finally {
      setBusy(false);
    }
  };

  const submitProfile = async () => {
    if (!profile) return;
    setBusy(true);
    setSubmitError(null);
    const orNull = (v: string) => (v.trim() ? v.trim() : null);
    try {
      const res = await api.post<PublicLinkStatus>(base + "/profile", {
        pin,
        firstName: profile.firstName.trim(),
        lastName: profile.lastName.trim(),
        npi: profile.npi,
        caqhId: orNull(profile.caqhId),
        suffix: orNull(profile.suffix),
        specialty: orNull(specialtyValue(profile.specialty, profile.specialtyOther)),
        phone: orNull(profile.phone),
        dateOfBirth: orNull(profile.dateOfBirth),
        licenseNumber: profile.licenseNumber.trim(),
        licenseState: orNull(profile.licenseState),
        licenseExpires: orNull(profile.licenseExpires),
        deaNumber: orNull(profile.deaNumber),
        deaExpires: orNull(profile.deaExpires),
        caqhUsername: profile.caqhUsername.trim() || null,
        caqhPassword: profile.caqhPassword || null,
        pecosAccessGranted: profile.pecosAccess === "yes",
        pecosUsername: profile.pecosAccess === "yes" ? profile.pecosUsername.trim() : undefined,
        password: needsLogin ? profile.password : undefined,
        extra: extraPayload(extra),
      });
      statusQuery.setData(res);
      setStep("done");
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) {
        setProfileErrors(extraFieldErrors(err.fieldErrors));
        setStep("profile");
      }
      setSubmitError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const firstName = info?.firstName || status?.firstName || "";
  // Same requirements as adding a provider in the admin app (staff already gave the name, email, practice and location).
  const needsLogin = !!info && !info.profile.hasLogin;
  /** Every problem on the profile step, by field (shown under the fields when Continue is clicked). */
  const profileProblems = (p: Profile): Record<string, string> => {
    const e: Record<string, string> = {};
    const today = todayISO();
    // only the name and the sign-in password are required; the rest is checked when it is filled in
    if (p.npi && !NPI_RE.test(p.npi)) e.npi = "NPI must be 10 digits";
    if (p.caqhId && !/^[0-9]{6,10}$/.test(p.caqhId)) e.caqhId = "CAQH ID must be 6–10 digits (or leave it empty)";
    if (p.phone && !PHONE_RE.test(p.phone)) e.phone = "Ph.No must be 10 digits";
    if (!p.firstName.trim()) e.firstName = "Required";
    if (!p.lastName.trim()) e.lastName = "Required";
    if (p.licenseExpires && p.licenseExpires < today) e.licenseExpires = "The license has expired — enter the current expiration date";
    if (p.deaExpires && p.deaExpires < today) e.deaExpires = "The DEA registration has expired — enter the current date or leave it empty";
    // CAQH username / password and PECOS are optional
    if (needsLogin) {
      if (p.password.length < 8) e.password = p.password ? "At least 8 characters" : "Required";
      if (!p.confirmPassword) e.confirmPassword = "Required";
      else if (p.confirmPassword !== p.password) e.confirmPassword = "Passwords do not match";
    }
    Object.assign(e, extraProblems(extra));
    return e;
  };
  const continueToDocs = () => {
    if (!profile) return;
    const problems = profileProblems(profile);
    if (Object.keys(problems).length) {
      setProfileErrors(problems);
      // bring the first field to fix into view
      setTimeout(() => document.querySelector(".field-error")?.closest(".field, label, div")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return;
    }
    setProfileErrors({});
    setStep("docs");
  };
  const authenticated = !!info;
  const blocked = status && !authenticated && status.state !== "active";
  const docRequest = (info?.purpose || status?.purpose) === "documents";
  const STEPS = docRequest ? DOCUMENT_STEPS : PROFILE_STEPS;
  const uploadedCount = docs.filter((d) => uploaded[d.docType]).length;
  const finishDocuments = async () => {
    setBusy(true);
    setSubmitError(null);
    try {
      const res = await api.post<PublicLinkStatus>(base + "/finish", { pin });
      statusQuery.setData(res);
      setStep("done");
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)" }}>
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 font-display font-bold text-lg text-accent">
            <span style={{ fontSize: 20 }}>▲</span> ZmartCredential
          </div>
          <h1 className="font-display text-3xl font-bold text-ink mt-3">{docRequest ? "Document Request" : "Provider Onboarding"}</h1>
          {firstName && (
            <p className="text-sm text-ink-light mt-1">
              Hello {firstName}, {docRequest ? "please upload the documents requested below." : "please complete your credentialing profile."}
            </p>
          )}
          {status?.organizationName && <p className="text-xs text-ink-faint mt-1">Requested by {status.organizationName}</p>}
        </div>

        {authenticated && (
          <div className="flex items-center gap-2 mb-6 justify-center flex-wrap">
            {STEPS.map((s, i) => {
              const idx = STEPS.indexOf(step);
              const isActive = s === step;
              const isPast = i < idx;
              return (
                <Fragment key={s}>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{ background: isActive || isPast ? "var(--accent)" : "var(--bg-soft-2)", color: isActive || isPast ? "white" : "var(--ink-light)" }}
                    >
                      {isPast ? <Icon name="Check" size={14} /> : i + 1}
                    </div>
                    <span className={"text-xs capitalize " + (isActive ? "font-semibold text-accent" : "text-ink-light")}>{s === "done" ? "Submitted" : s}</span>
                  </div>
                  {i < STEPS.length - 1 && <div style={{ height: 1, width: 20, background: isPast ? "var(--accent)" : "var(--border)" }} />}
                </Fragment>
              );
            })}
          </div>
        )}

        {invalid && (
          <div className="card card-pad text-center">
            <Icon name="AlertCircle" size={32} className="mx-auto mb-3" style={{ color: "var(--danger)" }} />
            <h2 className="font-display text-xl font-bold text-ink">Invalid or expired link</h2>
            <p className="text-sm text-ink-light mt-2">This secure link does not exist or has been removed. Contact the organization that sent you this link.</p>
          </div>
        )}

        {!invalid && !status && <Loading />}

        {blocked && status.state === "submitted" && (
          <div className="card card-pad text-center">
            <Icon name="CheckCircle2" size={40} className="mx-auto mb-3" style={{ color: "var(--success)" }} />
            <h2 className="font-display text-xl font-bold text-ink">{docRequest ? "Documents already submitted" : "Profile already submitted"}</h2>
            <p className="text-sm text-ink-light mt-2">
              Thank you! Your {docRequest ? "documents were" : "profile was"} submitted{status.submittedAt ? " on " + fmtTs(status.submittedAt) : ""}. The credentialing team will reach out if any additional
              information is needed.
            </p>
          </div>
        )}

        {blocked && status.state !== "submitted" && (
          <div className="card card-pad text-center">
            <Icon name={status.state === "locked" ? "Lock" : "Clock"} size={32} className="mx-auto mb-3" style={{ color: "var(--danger)" }} />
            <h2 className="font-display text-xl font-bold text-ink">
              {status.state === "locked" ? "Link locked due to too many attempts" : status.state === "replaced" ? "This link has been replaced" : "This link has expired"}
            </h2>
            <p className="text-sm text-ink-light mt-2">
              {status.state === "locked"
                ? "For security, this link has been locked after too many failed PIN attempts. Contact the organization to request a new link."
                : status.state === "replaced"
                  ? "A newer link was sent to you. Please use the most recent email from your credentialing team."
                  : "Links expire 7 days after being sent. Please contact your credentialing team to request a new one."}
            </p>
          </div>
        )}

        {status?.state === "active" && !authenticated && (
          <div className="card card-pad">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ background: "var(--accent-soft)" }}>
                <Icon name="Shield" size={22} className="text-accent" />
              </div>
              <div>
                <h2 className="font-display text-xl font-bold text-ink">Enter your PIN</h2>
                <p className="text-sm text-ink-light">Check your email for the 6-digit PIN</p>
              </div>
            </div>
            <div className="mb-3">
              <label className="label" htmlFor="pin">6-digit PIN</label>
              <input
                id="pin"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setAuthError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") authenticate();
                }}
                className="input font-mono text-center tracking-widest"
                style={{ fontSize: 22, letterSpacing: 8 }}
                placeholder="000000"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
              />
              {authError && (
                <div className="text-xs mt-2 flex items-center gap-1" style={{ color: "var(--danger)" }}>
                  <Icon name="AlertCircle" size={11} /> {authError}
                </div>
              )}
            </div>
            <button onClick={authenticate} disabled={pin.length !== 6 || busy} className="btn btn-primary w-full">
              {busy ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="LogIn" size={13} />} Continue
            </button>
            <div className="text-xs text-ink-faint mt-4 text-center">Attempts remaining: {status.attemptsRemaining}</div>
          </div>
        )}

        {authenticated && profile && step === "profile" && (
          <div className="card card-pad">
            <h2 className="font-display text-xl font-bold text-ink mb-1">Your Information</h2>
            <p className="text-sm text-ink-light mb-4">Confirm or update your professional details below.</p>
            <ProfileForm
              profile={profile}
              extra={extra}
              onExtra={(k, v) => {
                setExtra((x) => ({ ...x, [k]: v }));
                setProfileErrors((er) => (er[k] ? { ...er, [k]: "" } : er));
              }}
              token={token}
              errors={profileErrors}
              loginEmail={needsLogin ? info?.profile.loginEmail || info?.email || "" : null}
              fixed={{
                email: info?.profile.loginEmail || info?.email || "",
                status: info?.profile.status || null,
              }}
              onChange={(p) => {
                // a field's message goes away once that field is changed
                setProfileErrors((er) => {
                  const next = { ...er };
                  (Object.keys(p) as (keyof Profile)[]).forEach((k) => p[k] !== profile[k] && delete next[k]);
                  if (p.pecosAccess !== profile.pecosAccess) delete next.pecosAccessGranted;
                  return next;
                });
                setProfile(p);
              }}
            />
            {Object.keys(profileErrors).length > 0 && (
              <div className="field-error mt-3">Please fix the highlighted fields above.</div>
            )}
            <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-line">
              <button onClick={continueToDocs} className="btn btn-primary">
                Continue to Documents <Icon name="ArrowRight" size={13} />
              </button>
            </div>
          </div>
        )}

        {authenticated && step === "docs" && (
          <div className="card card-pad">
            <h2 className="font-display text-xl font-bold text-ink mb-1">Upload Documents</h2>
            <p className="text-sm text-ink-light mb-4">
              {docs.length === 0
                ? docRequest
                  ? "The requested documents are already with your credentialing team."
                  : "Your credentialing team already has every required document on file."
                : docRequest
                  ? "Upload the documents you have — each one is optional. " + uploadedCount + " of " + docs.length + " uploaded."
                  : "Upload the documents you have — you can also send them later. " + uploadedCount + " of " + docs.length + " uploaded."}
            </p>
            <div className="space-y-2">
              {docs.map((doc) => (
                <DocUploadRow
                  key={doc.docType}
                  doc={doc}
                  uploaded={uploaded[doc.docType]}
                  base={base}
                  pin={pin}
                  onUploaded={(u) => setUploaded((m) => ({ ...m, [doc.docType]: u }))}
                  onRemoved={() =>
                    setUploaded((m) => {
                      const n = { ...m };
                      delete n[doc.docType];
                      return n;
                    })
                  }
                />
              ))}
            </div>
            {docRequest ? (
              <>
                {submitError && <div className="field-error mt-3">{submitError}</div>}
                <div className="flex justify-end gap-2 pt-4 border-t border-line mt-4">
                  <button onClick={finishDocuments} disabled={busy || uploadedCount === 0} className="btn btn-primary" title={uploadedCount === 0 ? "Upload at least one document first" : undefined}>
                    {busy ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Send" size={13} />} Submit Documents
                  </button>
                </div>
              </>
            ) : (
              <div className="flex justify-between gap-2 pt-4 border-t border-line mt-4">
                <button onClick={() => setStep("profile")} className="btn btn-secondary">
                  <Icon name="ArrowLeft" size={13} /> Back
                </button>
                <button onClick={() => setStep("review")} className="btn btn-primary">
                  Review Submission <Icon name="ArrowRight" size={13} />
                </button>
              </div>
            )}
          </div>
        )}

        {authenticated && profile && info && step === "review" && (
          <div className="card card-pad">
            <h2 className="font-display text-xl font-bold text-ink mb-1">Review &amp; Submit</h2>
            <p className="text-sm text-ink-light mb-4">Please verify your information before submitting.</p>
            <div className="space-y-3">
              <div className="p-3 rounded-lg" style={{ background: "var(--bg-soft)" }}>
                <div className="text-xs font-semibold text-ink mb-2">Personal Information</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div><span className="text-ink-faint">Name:</span> {profile.firstName} {profile.lastName}{profile.suffix ? ", " + profile.suffix : ""}</div>
                  <div><span className="text-ink-faint">NPI:</span> <span className="font-mono">{profile.npi}</span></div>
                  <div><span className="text-ink-faint">Specialty:</span> {specialtyValue(profile.specialty, profile.specialtyOther) || "—"}</div>
                  <div><span className="text-ink-faint">Ph.No:</span> {profile.phone || "—"}</div>
                  <div><span className="text-ink-faint">License:</span> <span className="font-mono">{profile.licenseNumber}{profile.licenseState ? " (" + profile.licenseState + ")" : ""}</span></div>
                  <div><span className="text-ink-faint">DEA:</span> <span className="font-mono">{profile.deaNumber || "—"}</span></div>
                </div>
              </div>
              <div className="p-3 rounded-lg" style={{ background: "var(--bg-soft)" }}>
                <div className="text-xs font-semibold text-ink mb-2">Documents ({Object.keys(uploaded).length} uploaded)</div>
                <div className="space-y-1 text-xs">
                  {Object.entries(uploaded).map(([docType, u]) => (
                    <div key={docType} className="flex items-center gap-2">
                      <Icon name="CheckCircle2" size={11} style={{ color: "var(--success)" }} />
                      <span className="font-medium">{docs.find((d) => d.docType === docType)?.label || docType}:</span>
                      <span className="text-ink-light font-mono truncate">{u.fileName}</span>
                      {u.expiresAt && <span className="text-ink-faint">· expires {fmtDate(u.expiresAt)}</span>}
                    </div>
                  ))}
                  {Object.keys(uploaded).length === 0 && <div className="text-ink-faint">No new documents uploaded.</div>}
                </div>
              </div>
              <div className="p-3 rounded text-xs" style={{ background: "var(--info-soft)", color: "#1e40af" }}>
                <Icon name="Info" size={11} className="inline mr-1" />
                By submitting, you certify that the information provided is true and accurate. The credentialing team will review within 2-3 business days.
              </div>
              {submitError && (
                <div className="px-3 py-2 rounded-lg flex items-center gap-2 text-sm" style={{ background: "var(--danger-soft)", color: "#991b1b" }}>
                  <Icon name="AlertCircle" size={14} /> {submitError}
                </div>
              )}
              <div className="flex justify-between gap-2 pt-4 border-t border-line">
                <button onClick={() => setStep("docs")} className="btn btn-secondary" disabled={busy}>
                  <Icon name="ArrowLeft" size={13} /> Back
                </button>
                <button onClick={submitProfile} className="btn btn-primary" disabled={busy}>
                  {busy ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Send" size={13} />} Submit Profile
                </button>
              </div>
            </div>
          </div>
        )}

        {authenticated && step === "done" && (
          <div className="card card-pad text-center">
            <Icon name="CheckCircle2" size={48} className="mx-auto mb-3" style={{ color: "var(--success)" }} />
            <h2 className="font-display text-2xl font-bold text-ink">Thank you!</h2>
            <p className="text-sm text-ink-light mt-2">
              {docRequest ? "Your documents have been submitted successfully." : "Your profile has been submitted successfully."} The credentialing team at {status?.organizationName || "this organization"} will contact you if any additional
              information is needed.
            </p>
          </div>
        )}

        {status && (
          <div className="mt-8 text-center text-[10px] text-ink-faint">Secure portal · Expires: {fmtDate(status.expiresAt)}</div>
        )}
      </div>
    </div>
  );
}

interface FixedInfo {
  email: string;
  status: string | null;
}

/** A value set by the staff member who sent the link: shown in a field, not editable. */
function Fixed({ label, value }: { label: string; value: string | null }) {
  return (
    <Field label={label}>
      <input value={value || "—"} readOnly disabled className="input" title="Set by your credentialing team" />
    </Field>
  );
}

/** The same sections, fields and order as Add Provider Manually (email and status are set by the staff). */
function ProfileForm({
  profile,
  extra,
  onExtra,
  token,
  errors,
  loginEmail,
  fixed,
  onChange,
}: {
  profile: Profile;
  extra: ExtraForm;
  onExtra: (k: keyof ExtraForm, v: string) => void;
  token: string;
  errors: Record<string, string>;
  loginEmail: string | null;
  fixed: FixedInfo;
  onChange: (p: Profile) => void;
}) {
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => onChange({ ...profile, [k]: v });
  const statusLabel = PROVIDER_STATUS_OPTIONS.find((o) => o.id === fixed.status)?.label || fixed.status;
  const xp = { f: extra, set: onExtra, errors, publicToken: token };
  return (
    <div className="space-y-3">
      <FormSection icon="User" title="Provider Details">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="First Name" required error={errors.firstName}>
            <input value={profile.firstName} onChange={(e) => set("firstName", e.target.value)} className="input" maxLength={80} />
          </Field>
          <Field label="Last Name" required error={errors.lastName}>
            <input value={profile.lastName} onChange={(e) => set("lastName", e.target.value)} className="input" maxLength={80} />
          </Field>
          <Field label="Suffix" error={errors.suffix}>
            <SuffixSelect value={profile.suffix} onChange={(v) => set("suffix", v)} publicToken={token} withEmpty />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="NPI" error={errors.npi}>
            <input value={profile.npi} onChange={(e) => set("npi", e.target.value.replace(/\D/g, "").slice(0, 10))} className="input font-mono" placeholder="10 digits" inputMode="numeric" />
          </Field>
          <SpecialtyField
            choice={profile.specialty}
            other={profile.specialtyOther}
            onChange={(c, o) => onChange({ ...profile, specialty: c, specialtyOther: o })}
            error={errors.specialty}
            otherError={errors.specialtyOther}
            publicToken={token}
            required={false}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Fixed label="Email" value={fixed.email} />
          <Field label="Ph.No" error={errors.phone || (profile.phone && !PHONE_RE.test(profile.phone) ? "Ph.No must be 10 digits" : undefined)}>
            <PhoneInput value={profile.phone} onChange={(v) => set("phone", v)} invalid={!!errors.phone} />
          </Field>
          <Field label="Date of Birth" error={errors.dateOfBirth}>
            <input type="date" max={todayISO()} value={profile.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} className="input" />
          </Field>
        </div>
        <GroupRow {...xp} />
        <PersonalRow {...xp} />
      </FormSection>
      <FormSection icon="Home" title="Home Address">
        <HomeAddressBlock {...xp} />
      </FormSection>
      <FormSection icon="Award" title="License & IDs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="License Number" error={errors.licenseNumber}>
            <input value={profile.licenseNumber} onChange={(e) => set("licenseNumber", e.target.value)} className="input font-mono" maxLength={40} />
          </Field>
          <Field label="License State" error={errors.licenseState}>
            <StateSelect value={profile.licenseState} onChange={(v) => set("licenseState", v)} publicToken={token} ariaLabel="License State" invalid={!!errors.licenseState} />
          </Field>
          <Field label="License Expiration" error={errors.licenseExpires}>
            <input type="date" min={todayISO()} value={profile.licenseExpires} onChange={(e) => set("licenseExpires", e.target.value)} className="input" />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="DEA Number" error={errors.deaNumber}>
            <input value={profile.deaNumber} onChange={(e) => set("deaNumber", e.target.value.toUpperCase())} className="input font-mono" maxLength={20} placeholder="(optional for mid-levels)" />
          </Field>
          <Field label="DEA Expiration" error={errors.deaExpires}>
            <input type="date" min={todayISO()} value={profile.deaExpires} onChange={(e) => set("deaExpires", e.target.value)} className="input" />
          </Field>
        </div>
        <IdsRow {...xp} />
      </FormSection>
      <FormSection icon="Database" title="CAQH">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="CAQH Number" error={errors.caqhId}>
            <input value={profile.caqhId} onChange={(e) => set("caqhId", e.target.value.replace(/\D/g, "").slice(0, 10))} className="input font-mono" placeholder="8 digits" inputMode="numeric" />
          </Field>
          <Field label="CAQH User ID" error={errors.caqhUsername}>
            <input value={profile.caqhUsername} onChange={(e) => set("caqhUsername", e.target.value.replace(/\s/g, ""))} className="input font-mono" maxLength={100} autoComplete="off" />
          </Field>
          <Field label="CAQH Password" error={errors.caqhPassword}>
            <PasswordInput value={profile.caqhPassword} onChange={(e) => set("caqhPassword", e.target.value)} className="input font-mono" maxLength={200} autoComplete="new-password" />
          </Field>
        </div>
      </FormSection>
      <FormSection icon="ShieldCheck" title="PECOS">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="PECOS Access Granted" error={errors.pecosAccess || errors.pecosAccessGranted}>
            <Select
              value={profile.pecosAccess}
              onChange={(e) => {
                // No (or nothing): the PECOS user name and password are emptied
                onChange({ ...profile, pecosAccess: e.target.value, ...(e.target.value !== "yes" ? { pecosUsername: "" } : {}) });
                if (e.target.value !== "yes") onExtra("pecosPassword", "");
              }}
              className="input"
              aria-label="PECOS Access Granted"
            >
              <option value="">— Select —</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </Field>
          <Field label="PECOS User Name" error={errors.pecosUsername}>
            <input value={profile.pecosUsername} onChange={(e) => set("pecosUsername", e.target.value.replace(/\s/g, ""))} className="input font-mono" maxLength={100} disabled={profile.pecosAccess !== "yes"} autoComplete="off" />
          </Field>
          <PecosPasswordField {...xp} disabled={profile.pecosAccess !== "yes"} />
        </div>
      </FormSection>
      <PracticeSection {...xp} />
      <BillingSection {...xp} />
      <FormSection icon="KeyRound" title="Status & Sign-in">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Fixed label="Status" value={statusLabel} />
          {loginEmail != null && (
            <>
              <Field label="Password" required error={errors.password || (profile.password && profile.password.length < 8 ? "At least 8 characters" : undefined)} hint={"Sign-in: " + loginEmail + " + this password"}>
                <PasswordInput value={profile.password} onChange={(e) => set("password", e.target.value)} className="input" maxLength={100} autoComplete="new-password" placeholder="At least 8 characters" />
              </Field>
              <Field label="Confirm Password" required error={errors.confirmPassword || (profile.confirmPassword && profile.confirmPassword !== profile.password ? "Passwords do not match" : undefined)}>
                <PasswordInput value={profile.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)} className="input" maxLength={100} autoComplete="new-password" />
              </Field>
            </>
          )}
        </div>
      </FormSection>
    </div>
  );
}

/** One requested document: pick a file (+ expiration for expiring documents) and it is uploaded right away. */
function DocUploadRow({
  doc,
  uploaded,
  base,
  pin,
  onUploaded,
  onRemoved,
}: {
  doc: PublicMissingDoc;
  uploaded?: Uploaded;
  base: string;
  pin: string;
  onUploaded: (u: Uploaded) => void;
  onRemoved: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // the date stays with the uploaded file (also when coming back to this step)
  const [expiresAt, setExpiresAt] = useState(uploaded?.expiresAt || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const needsDate = doc.expires;
  /** Expiring documents (license, DEA, insurance, ...) need a current expiration date. */
  const dateProblem = !needsDate ? "" : !expiresAt ? "Enter the expiration date first" : expiresAt < todayISO() ? "This date is in the past" : "";
  const [dateTried, setDateTried] = useState(false);
  const pick = () => {
    setDateTried(true);
    if (dateProblem) return;
    ref.current?.click();
  };

  /** Remove: the wrong file goes away and the document is missing again; its expiration date is cleared too. */
  const remove = async () => {
    setError("");
    setBusy(true);
    try {
      await api.post(base + "/remove", { pin, docType: doc.docType });
      setExpiresAt("");
      setDateTried(false);
      onRemoved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File | undefined) => {
    setError("");
    if (!file) return;
    if (dateProblem) return setError(dateProblem);
    if (!ALLOWED_EXT.includes(fileExt(file.name))) return setError("This file type is not allowed");
    if (file.size > MAX_FILE_BYTES) return setError("File exceeds 25 MB");
    if (file.size === 0) return setError("File is empty");
    const form = new FormData();
    form.append("pin", pin);
    form.append("files", file, file.name);
    form.append("docType", doc.docType);
    form.append("expiresAt", expiresAt);
    setBusy(true);
    try {
      await api.upload<PublicUploadResult>(base + "/upload", form);
      onUploaded({ fileName: file.name, size: file.size, expiresAt: needsDate ? expiresAt : undefined });
      setDateTried(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-pad" style={{ padding: 12 }}>
      <div className="flex items-center gap-3 flex-wrap">
        <Icon
          name={uploaded ? "CheckCircle2" : doc.critical ? "FileText" : "File"}
          size={20}
          style={{ color: uploaded ? "var(--success)" : doc.critical ? "var(--warn)" : "var(--ink-faint)" }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-ink">{doc.label}</span>
            {doc.critical && <span className="text-[10px] font-semibold" style={{ color: "var(--warn)" }}>RECOMMENDED</span>}
            {doc.status === "expired" && !uploaded && <Pill type="danger">Expired</Pill>}
          </div>
          {uploaded ? (
            <div className="text-xs font-mono mt-0.5" style={{ color: "var(--success)" }}>
              {uploaded.fileName} ({Math.max(1, Math.round(uploaded.size / 1024))} KB)
              {uploaded.expiresAt && <span className="text-ink-light"> · expires {fmtDate(uploaded.expiresAt)}</span>}
            </div>
          ) : (
            <div className="text-xs text-ink-faint mt-0.5">No file uploaded</div>
          )}
        </div>
        {needsDate && (
          <div className="flex items-center gap-1">
            <label className="text-[11px] text-ink-light" htmlFor={"exp-" + doc.docType}>
              Expires <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <input
              id={"exp-" + doc.docType}
              type="date"
              min={todayISO()}
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className={"input input-sm" + (dateTried && dateProblem ? " input-error" : "")}
              style={{ width: 150 }}
              disabled={busy}
              aria-required="true"
            />
          </div>
        )}
        <button className="btn btn-secondary flex-shrink-0" onClick={pick} disabled={busy}>
          {busy ? <span className="loader" /> : <Icon name="Upload" size={11} />} {uploaded ? "Replace" : "Upload"}
        </button>
        {uploaded && (
          <button className="btn btn-ghost flex-shrink-0 hover:text-red-600" onClick={remove} disabled={busy} aria-label={"Remove " + doc.label} title="Remove this file">
            <Icon name="Trash2" size={11} /> Remove
          </button>
        )}
        <input
          ref={ref}
          type="file"
          hidden
          accept={ALLOWED_EXT.map((e) => "." + e).join(",")}
          onChange={(e) => {
            upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {uploaded && needsDate && expiresAt && uploaded.expiresAt && expiresAt !== uploaded.expiresAt && !dateProblem && (
        <div className="text-[11px] mt-1 text-ink-light">The saved date is {fmtDate(uploaded.expiresAt)} — click Replace and choose the file again to save the new date.</div>
      )}
      {(dateTried || (expiresAt && expiresAt < todayISO())) && dateProblem && (
        <div className="text-[11px] mt-1" style={{ color: "var(--danger)" }}>{dateProblem}</div>
      )}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
