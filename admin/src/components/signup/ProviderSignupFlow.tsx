"use client";

import { Select } from "@/components/Select";

import { RequiredMark } from "@/components/Field";
import { useMasterList, withCurrent } from "@/lib/masterLists";
import { Fragment, useEffect, useState } from "react";
import { PhoneInput } from "@/components/PhoneInput";
import { PHONE_RE } from "@/lib/validation";
import { PasswordInput } from "@/components/PasswordInput";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DeferredNotice } from "@/components/AlertBox";
import { Icon } from "@/components/Icon";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { useDebounced } from "@/lib/hooks";
import { useToast } from "@/stores/toast";
import type { AuthResponse } from "@/types";
import { EMAIL_RE } from "@/types/signup";
import { StateSelect } from "@/components/AddressFields";


interface ProviderSignupData {
  firstName: string; lastName: string; suffix: string; email: string; phone: string;
  npi: string; specialty: string; licenseState: string;
  password: string; confirmPassword: string;
  organizationCode: string;
}
type Errors = Partial<Record<keyof ProviderSignupData | "form", string>>;
const STEP_OF: Partial<Record<keyof ProviderSignupData, number>> = {
  firstName: 1, lastName: 1, suffix: 1, email: 1, phone: 1, password: 1, confirmPassword: 1,
  npi: 2, specialty: 2, licenseState: 2, organizationCode: 3,
};

type CodeCheck = { status: "idle" | "checking" | "ok" | "invalid" | "error"; orgName?: string; message?: string; code?: string };

const Err = ({ msg }: { msg?: string }) => (msg ? <div className="field-error">{msg}</div> : null);

export function ProviderSignupFlow() {
  // Master Data lists (public); "Other" opens a text box
  const suffixOptions = useMasterList("suffix", { isPublic: true });
  const specialtyOptions = useMasterList("specialty", { isPublic: true });
  const [otherSpecialty, setOtherSpecialty] = useState("");
  const router = useRouter();
  const { completeAuth } = useAuth();
  const toast = useToast();

  const [step, setStep] = useState(1);
  const [data, setData] = useState<ProviderSignupData>({
    firstName: "", lastName: "", suffix: "MD", email: "", phone: "",
    npi: "", specialty: "", licenseState: "TX",
    password: "", confirmPassword: "",
    organizationCode: "", // optional invite code from an org
  });
  const [errors, setErrors] = useState<Errors>({});
  const [npiNotice, setNpiNotice] = useState(false);
  const [codeCheck, setCodeCheck] = useState<CodeCheck>({ status: "idle" });
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof ProviderSignupData>(k: K, v: ProviderSignupData[K]) => setData((d) => ({ ...d, [k]: v }));

  // NPI registry lookup (NPPES) is deferred to a later phase: keep the button, explain instead of simulating a result.
  const lookupNpi = () => {
    if (!/^\d{10}$/.test(data.npi)) return;
    setNpiNotice(true);
  };

  const checkCode = async (raw: string): Promise<CodeCheck> => {
    const code = raw.trim();
    if (!code) return { status: "idle" };
    try {
      const res = await api.get<{ orgName: string }>("/public/organizations/by-invite-code/" + encodeURIComponent(code));
      return { status: "ok", orgName: res.orgName, code };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return { status: "invalid", code, message: "Invalid organization code" };
      return { status: "error", code, message: errorMessage(e) };
    }
  };

  // Validate the invite code as the user types (debounced).
  const debouncedCode = useDebounced(data.organizationCode.trim(), 500);
  useEffect(() => {
    let cancelled = false;
    if (!debouncedCode) return;
    checkCode(debouncedCode).then((r) => !cancelled && setCodeCheck(r));
    return () => {
      cancelled = true;
    };
  }, [debouncedCode]);

  // The shown status only applies to the code currently typed; anything else is still being checked.
  const typedCode = data.organizationCode.trim();
  const codeState: CodeCheck = !typedCode ? { status: "idle" } : codeCheck.code === typedCode ? codeCheck : { status: "checking" };

  const validateStep = (s: number) => {
    const e: Errors = {};
    if (s === 1) {
      if (!data.firstName.trim()) e.firstName = "First name is required";
      if (!data.lastName.trim()) e.lastName = "Last name is required";
      if (!data.email) e.email = "Email is required";
      else if (!EMAIL_RE.test(data.email)) e.email = "Enter a valid email address";
      if (data.phone && !PHONE_RE.test(data.phone)) e.phone = "Ph.No must be 10 digits";
      if (!data.password) e.password = "Password is required";
      else if (data.password.length < 8) e.password = "Password must be at least 8 characters";
      if (data.password !== data.confirmPassword) e.confirmPassword = "Passwords don't match";
    } else if (s === 2) {
      if (!data.npi) e.npi = "NPI is required";
      else if (data.npi.length !== 10) e.npi = "NPI must be 10 digits";
      if (!data.specialty) e.specialty = "Specialty is required";
      else if (data.specialty === "__other__" && !otherSpecialty.trim()) e.specialty = "Type the specialty";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (validateStep(step)) setStep(step + 1);
  };

  const submit = async () => {
    const code = data.organizationCode.trim();
    setSubmitting(true);
    try {
      if (code) {
        const result = codeCheck.status === "ok" && codeCheck.code === code ? codeCheck : await checkCode(code);
        setCodeCheck(result);
        if (result.status !== "ok") {
          setErrors({ organizationCode: result.message || "Invalid organization code" });
          return;
        }
      }
      const res = await api.post<AuthResponse>("/auth/signup/provider", {
        suffix: data.suffix,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        email: data.email.trim(),
        phone: data.phone || undefined,
        password: data.password,
        npi: data.npi,
        specialty: data.specialty === "__other__" ? otherSpecialty.trim() : data.specialty,
        licenseState: data.licenseState,
        ...(code ? { organizationCode: code } : {}),
      });
      completeAuth(res);
      toast("Account created · Welcome!");
      router.replace("/my-portal");
    } catch (err) {
      const e: Errors = {};
      if (err instanceof ApiError) {
        Object.entries(err.fieldErrors).forEach(([k, v]) => {
          if (k in data) e[k as keyof ProviderSignupData] = v;
        });
      }
      const firstStep = Math.min(...Object.keys(e).map((k) => STEP_OF[k as keyof ProviderSignupData] || 3), 3);
      e.form = errorMessage(err);
      setErrors(e);
      setStep(firstStep);
    } finally {
      setSubmitting(false);
    }
  };

  const blue = "#1d4ed8";

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "linear-gradient(135deg, #dbeafe 0%, #ffffff 100%)" }}>
      <div className="w-full max-w-xl">
        <div className="text-center mb-6">
          <div className="atano-logo text-2xl mb-2"><span className="a-mark">▲</span>ZmartCredential</div>
          <h1 className="font-display text-3xl font-bold text-ink">Create your provider account</h1>
          <p className="text-sm text-ink-light mt-1">Free for individual providers</p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-6 flex-wrap">
          {[
            { n: 1, label: "Your Account" },
            { n: 2, label: "Professional" },
            { n: 3, label: "Link Org" },
          ].map((s, i, arr) => (
            <Fragment key={s.n}>
              <div
                className={"flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium " + (step === s.n ? "text-white" : step > s.n ? "" : "text-ink-faint")}
                style={step === s.n ? { background: blue, color: "white" } : step > s.n ? { background: "var(--success-soft)", color: "var(--success)" } : {}}
              >
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={step === s.n ? { background: "white", color: blue } : step > s.n ? { background: "var(--success)", color: "white" } : { background: "var(--bg-soft-2)" }}
                >
                  {step > s.n ? <Icon name="Check" size={10} /> : s.n}
                </div>
                <span>{s.label}</span>
              </div>
              {i < arr.length - 1 && <Icon name="ChevronRight" size={11} className="text-ink-faint" />}
            </Fragment>
          ))}
        </div>

        <div className="card card-pad">
          {errors.form && (
            <div className="mb-4 px-3 py-2 rounded-lg flex items-center gap-2" style={{ background: "var(--danger-soft)", color: "#991b1b", fontSize: 13 }}>
              <Icon name="AlertCircle" size={14} /> {errors.form}
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="font-display text-xl font-semibold text-ink mb-1">Your Account</h2>
              <p className="text-xs text-ink-light mb-4">Basic info to create your provider portal account</p>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1">
                    <label className="label">Title</label>
                    <Select value={data.suffix} onChange={(e) => set("suffix", e.target.value)} className="input">
                      {withCurrent(suffixOptions, data.suffix).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </Select>
                    <Err msg={errors.suffix} />
                  </div>
                  <div>
                    <label className="label">First Name<RequiredMark /></label>
                    <input value={data.firstName} onChange={(e) => set("firstName", e.target.value)} className={"input" + (errors.firstName ? " input-error" : "")} autoComplete="given-name" />
                    <Err msg={errors.firstName} />
                  </div>
                  <div>
                    <label className="label">Last Name<RequiredMark /></label>
                    <input value={data.lastName} onChange={(e) => set("lastName", e.target.value)} className={"input" + (errors.lastName ? " input-error" : "")} autoComplete="family-name" />
                    <Err msg={errors.lastName} />
                  </div>
                </div>
                <div>
                  <label className="label">Email<RequiredMark /></label>
                  <input type="email" value={data.email} onChange={(e) => set("email", e.target.value)} className={"input" + (errors.email ? " input-error" : "")} placeholder="Enter Email" autoComplete="email" />
                  <Err msg={errors.email} />
                </div>
                <div>
                  <label className="label">Ph.No</label>
                  <PhoneInput value={data.phone} onChange={(v) => set("phone", v)} invalid={!!errors.phone} />
                  <Err msg={errors.phone} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Password<RequiredMark /></label>
                    <PasswordInput value={data.password} onChange={(e) => set("password", e.target.value)} className={"input" + (errors.password ? " input-error" : "")} placeholder="Enter Password" autoComplete="new-password" />
                    <Err msg={errors.password} />
                  </div>
                  <div>
                    <label className="label">Confirm<RequiredMark /></label>
                    <PasswordInput value={data.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)} className={"input" + (errors.confirmPassword ? " input-error" : "")} autoComplete="new-password" />
                    <Err msg={errors.confirmPassword} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="font-display text-xl font-semibold text-ink mb-1">Professional Information</h2>
              <p className="text-xs text-ink-light mb-4">We&apos;ll verify your NPI against the CMS registry</p>
              <div className="space-y-3">
                <div>
                  <label className="label">NPI Number<RequiredMark /></label>
                  <div className="flex gap-2">
                    <input
                      value={data.npi}
                      onChange={(e) => {
                        set("npi", e.target.value.replace(/\D/g, "").slice(0, 10));
                        setNpiNotice(false);
                      }}
                      className={"input font-mono" + (errors.npi ? " input-error" : "")}
                      placeholder="Enter NPI Number"
                      inputMode="numeric"
                    />
                    <button onClick={lookupNpi} disabled={data.npi.length !== 10} className="btn btn-secondary">
                      <Icon name="Search" size={13} /> Verify
                    </button>
                  </div>
                  <Err msg={errors.npi} />
                  {npiNotice && <DeferredNotice className="mt-2">Automatic NPI verification will be available in a later phase. Your NPI will be checked by your credentialing team.</DeferredNotice>}
                </div>
                <div>
                  <label className="label">Primary Specialty<RequiredMark /></label>
                  <Select value={data.specialty} onChange={(e) => set("specialty", e.target.value)} className={"input" + (errors.specialty ? " input-error" : "")}>
                    <option value="">— Select —</option>
                    {specialtyOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    <option value="__other__">Other</option>
                  </Select>
                  {data.specialty === "__other__" && (
                    <input value={otherSpecialty} onChange={(e) => setOtherSpecialty(e.target.value)} className="input mt-2" maxLength={120} placeholder="Enter Other Specialty" aria-label="Other Specialty" />
                  )}
                  <Err msg={errors.specialty} />
                </div>
                <div>
                  <label className="label">Primary License State</label>
                  <StateSelect value={data.licenseState} onChange={(v) => set("licenseState", v)} isPublic ariaLabel="Primary License State" />
                  <Err msg={errors.licenseState} />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="font-display text-xl font-semibold text-ink mb-1">Link to an Organization</h2>
              <p className="text-xs text-ink-light mb-4">If your group practice or credentialing service invited you, enter their code. Otherwise, skip this — you can connect later.</p>
              <div>
                <label className="label">Organization Invite Code (optional)</label>
                <input
                  value={data.organizationCode}
                  onChange={(e) => {
                    set("organizationCode", e.target.value.toUpperCase());
                    setErrors((er) => ({ ...er, organizationCode: undefined }));
                  }}
                  className={"input font-mono" + (errors.organizationCode || codeState.status === "invalid" ? " input-error" : "")}
                  placeholder="Enter Organization Invite Code"
                />
                <div className="text-[10px] text-ink-faint mt-1">Ask your organization&apos;s admin for this code, or skip and let them add you later</div>
                {errors.organizationCode ? (
                  <Err msg={errors.organizationCode} />
                ) : codeState.status === "checking" ? (
                  <div className="text-xs text-ink-light mt-2 flex items-center gap-2"><span className="loader" /> Checking code…</div>
                ) : codeState.status === "invalid" || codeState.status === "error" ? (
                  <Err msg={codeState.message} />
                ) : null}
                {codeState.status === "ok" && !errors.organizationCode && (
                  <div className="mt-2 p-2 rounded text-xs flex items-center gap-2" style={{ background: "var(--success-soft)", color: "#059669" }}>
                    <Icon name="CheckCircle2" size={12} /> You&apos;ll be linked to <strong>{codeState.orgName}</strong>
                  </div>
                )}
              </div>
              <div className="mt-4 p-3 rounded text-xs" style={{ background: "var(--info-soft)" }}>
                <Icon name="Info" size={11} className="inline mr-1" style={{ color: "var(--info)" }} />
                Whether or not you link to an org, your provider portal gives you a place to upload documents, track payer enrollments, and see expiration alerts.
              </div>
            </div>
          )}

          <div className="flex justify-between items-center pt-4 mt-4 border-t border-line">
            <button onClick={() => (step > 1 ? setStep(step - 1) : router.push("/signup"))} className="btn btn-ghost" disabled={submitting}>
              <Icon name="ChevronLeft" size={13} /> Back
            </button>
            {step < 3 ? (
              <button onClick={next} className="btn btn-primary" style={{ background: blue, borderColor: blue }}>
                Continue <Icon name="ArrowRight" size={13} />
              </button>
            ) : (
              <button onClick={submit} className="btn btn-primary" style={{ background: blue, borderColor: blue }} disabled={submitting || codeState.status === "checking"}>
                {submitting ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Check" size={13} />} Create My Account
              </button>
            )}
          </div>
        </div>

        <div className="text-center mt-4">
          <Link href="/signin" className="text-xs text-ink-light hover:text-ink">Already have an account? Sign in</Link>
        </div>
      </div>
    </div>
  );
}
