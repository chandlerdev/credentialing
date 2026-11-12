"use client";

import { Select } from "@/components/Select";
import { CitySelect, StateSelect } from "@/components/AddressFields";

import { RequiredMark } from "@/components/Field";
import { Fragment, useEffect, useState } from "react";
import { PhoneInput } from "@/components/PhoneInput";
import { useEmailCheck } from "@/lib/useEmailCheck";
import { cardExpProblem, PHONE_RE } from "@/lib/validation";
import { PasswordInput } from "@/components/PasswordInput";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DeferredNotice } from "@/components/AlertBox";
import { ErrorState, Loading } from "@/components/AsyncState";
import { Icon } from "@/components/Icon";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { useAsync, useDebounced } from "@/lib/hooks";
import { useToast } from "@/stores/toast";
import type { AuthResponse } from "@/types";
import { useMasterList, withCurrent } from "@/lib/masterLists";
import { calcSubscriptionTotal, detectCardBrand, EMAIL_RE, isUnlimited, loadPackages, overCap, type Package } from "@/types/signup";

interface OrgSignupData {
  orgName: string; orgType: string; taxId: string; website: string; address: string; city: string; state: string; zip: string;
  firstName: string; lastName: string; email: string; phone: string; password: string; confirmPassword: string;
  packageId: string; estimatedProviders: number;
  cardNumber: string; cardExp: string; cardCvc: string; cardName: string; cardZip: string;
}
type Errors = Partial<Record<keyof OrgSignupData | "form", string>>;

// Server field-error keys (request field names) → form keys.
const SERVER_KEYS: Record<string, keyof OrgSignupData> = {
  "org.name": "orgName", "org.type": "orgType", "org.taxId": "taxId", "org.website": "website", "org.address": "address",
  "org.city": "city", "org.state": "state", "org.zip": "zip",
  "admin.firstName": "firstName", "admin.lastName": "lastName", "admin.email": "email", "admin.phone": "phone", "admin.password": "password",
  "plan.packageId": "packageId", "plan.estimatedProviders": "estimatedProviders",
  "paymentMethod.brand": "cardNumber", "paymentMethod.last4": "cardNumber", "paymentMethod.exp": "cardExp",
  "paymentMethod.billingName": "cardName", "paymentMethod.billingZip": "cardZip",
};
const STEP_OF: Partial<Record<keyof OrgSignupData, number>> = {
  orgName: 1, orgType: 1, taxId: 1, website: 1, address: 1, city: 1, state: 1, zip: 1,
  firstName: 2, lastName: 2, email: 2, phone: 2, password: 2, confirmPassword: 2,
  packageId: 3, estimatedProviders: 3,
  cardNumber: 4, cardExp: 4, cardCvc: 4, cardName: 4, cardZip: 4,
};

const Err = ({ msg }: { msg?: string }) => (msg ? <div className="field-error">{msg}</div> : null);

/** Super admin → Create Admin: the same steps, saved through /platform/admins (nobody is signed in). */
export interface EmbeddedSignup {
  onCreated: (admin: { userId: number; name: string; email: string; orgName: string }) => void;
  onCancel: () => void;
  /** a button at the left end of the step row (e.g. "Back to admins") */
  back?: { label: string; onClick: () => void };
}

export function OrgSignupFlow({ embedded }: { embedded?: EmbeddedSignup } = {}) {
  const orgTypes = useMasterList("org_type", { isPublic: true });
  const router = useRouter();
  const { completeAuth } = useAuth();
  const toast = useToast();
  const packages = useAsync<Package[]>(loadPackages, []);

  const [step, setStep] = useState(1);
  const [data, setData] = useState<OrgSignupData>({
    // Step 1: Org info
    orgName: "", orgType: "physician_group", taxId: "", website: "",
    address: "", city: "", state: "TX", zip: "",
    // Step 2: Admin user
    firstName: "", lastName: "", email: "", phone: "", password: "", confirmPassword: "",
    // Step 3: Plan
    packageId: "professional", estimatedProviders: 5,
    // Step 4: Payment
    cardNumber: "", cardExp: "", cardCvc: "", cardName: "", cardZip: "",
  });
  // Create Admin (super admin signed in): warn about an email that already belongs to someone
  const emailTaken = useEmailCheck(data.email, { kind: "organization" }, !!embedded);
  // Create Admin: warn while typing when another organization already has this name (the save checks again)
  const nameTaken = useOrgNameCheck(data.orgName, !!embedded);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof OrgSignupData>(k: K, v: OrgSignupData[K]) => setData((d) => ({ ...d, [k]: v }));

  const pkgList = packages.data || [];
  const selectedPkg = pkgList.find((p) => p.id === data.packageId);
  const total = calcSubscriptionTotal(selectedPkg, data.estimatedProviders);

  // Default to the recommended plan when "professional" is not offered.
  if (pkgList.length && !pkgList.some((p) => p.id === data.packageId)) {
    set("packageId", (pkgList.find((p) => p.recommended) || pkgList[0]).id);
  }

  // Prototype bug fix: raising the slider above the selected plan's cap switches to the first plan that fits.
  const setProviders = (n: number) => {
    setData((d) => {
      const cur = pkgList.find((p) => p.id === d.packageId);
      let packageId = d.packageId;
      if (cur && overCap(cur, n)) {
        const fit = pkgList.find((p) => !overCap(p, n));
        if (fit) packageId = fit.id;
      }
      return { ...d, estimatedProviders: n, packageId };
    });
  };

  const validateStep = (s: number) => {
    const e: Errors = {};
    if (s === 1) {
      if (!data.orgName.trim()) e.orgName = "Organization name is required";
      else if (nameTaken) e.orgName = nameTaken;
      if (!data.taxId || !/^\d{9}$/.test(data.taxId.replace(/\D/g, ""))) e.taxId = data.taxId ? "Tax ID must be 9 digits" : "Tax ID is required";
      if (!data.city.trim()) e.city = "City is required";
      if (!data.zip || !/^\d{5}$/.test(data.zip)) e.zip = data.zip ? "ZIP must be 5 digits" : "ZIP is required";
    } else if (s === 2) {
      if (!data.firstName.trim()) e.firstName = "First name is required";
      if (!data.lastName.trim()) e.lastName = "Last name is required";
      if (!data.email) e.email = "Email is required";
      else if (!EMAIL_RE.test(data.email)) e.email = "Enter a valid email address";
      else if (emailTaken) e.email = emailTaken;
      if (!data.phone) e.phone = "Ph.No is required";
      else if (!PHONE_RE.test(data.phone)) e.phone = "Ph.No must be 10 digits";
      if (!data.password) e.password = "Password is required";
      else if (data.password.length < 8) e.password = "Password must be at least 8 characters";
      if (!data.confirmPassword) e.confirmPassword = "Confirm the password";
      else if (data.password !== data.confirmPassword) e.confirmPassword = "Passwords don't match";
    } else if (s === 3) {
      if (!selectedPkg) e.packageId = "Choose a plan";
      else if (overCap(selectedPkg, data.estimatedProviders)) e.packageId = selectedPkg.name + " supports up to " + selectedPkg.providerCap + " providers";
    } else if (s === 4) {
      const cleaned = data.cardNumber.replace(/\s/g, "");
      if (!cleaned) e.cardNumber = "Card number is required";
      else if (cleaned.length < 13) e.cardNumber = "Enter a valid card number";
      const expProblem = cardExpProblem(data.cardExp);
      if (expProblem) e.cardExp = expProblem;
      if (!data.cardCvc) e.cardCvc = "CVC is required";
      else if (data.cardCvc.length < 3) e.cardCvc = "CVC must be 3-4 digits";
      if (!data.cardName.trim()) e.cardName = "Name on card is required";
      if (!data.cardZip) e.cardZip = "Billing ZIP is required";
      else if (!/^\d{5}$/.test(data.cardZip)) e.cardZip = "Billing ZIP must be 5 digits";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (validateStep(step)) setStep(step + 1);
  };

  const submit = async () => {
    if (!validateStep(4)) return;
    const digits = data.cardNumber.replace(/\D/g, "");
    setSubmitting(true);
    try {
      // The card number and CVC never leave the browser: only brand, last 4, expiry and billing details are sent.
      const body = {
        org: { name: data.orgName.trim(), type: data.orgType, taxId: data.taxId, website: data.website.trim(), address: data.address.trim(), city: data.city.trim(), state: data.state, zip: data.zip },
        admin: { firstName: data.firstName.trim(), lastName: data.lastName.trim(), email: data.email.trim(), phone: data.phone, password: data.password },
        plan: { packageId: data.packageId, estimatedProviders: data.estimatedProviders },
        paymentMethod: { brand: detectCardBrand(digits), last4: digits.slice(-4), exp: data.cardExp, billingName: data.cardName.trim(), billingZip: data.cardZip },
      };
      if (embedded) {
        const admin = await api.post<{ userId: number; name: string; email: string; orgName: string }>("/platform/admins", body);
        toast("Admin created · " + admin.name + " (" + admin.orgName + ")");
        embedded.onCreated(admin);
        return;
      }
      const res = await api.post<AuthResponse>("/auth/signup/organization", body);
      completeAuth(res);
      toast("Account created · Welcome to ZmartCredential!");
      router.replace("/dashboard");
    } catch (err) {
      const e: Errors = {};
      if (err instanceof ApiError) {
        Object.entries(err.fieldErrors).forEach(([k, v]) => {
          const key = SERVER_KEYS[k] || (k.split(".").pop() as keyof OrgSignupData);
          if (key in data) e[key] = v;
        });
      }
      const firstStep = Math.min(...Object.keys(e).map((k) => STEP_OF[k as keyof OrgSignupData] || 4), 4);
      e.form = errorMessage(err);
      setErrors(e);
      setStep(firstStep);
    } finally {
      setSubmitting(false);
    }
  };

  const steps = [
    { n: 1, label: "Organization" },
    { n: 2, label: "Admin Account" },
    { n: 3, label: "Plan" },
    { n: 4, label: "Payment" },
  ];

  return (
    <div className={embedded ? "" : "min-h-screen flex items-center justify-center p-4"} style={embedded ? undefined : { background: "linear-gradient(135deg, #fff7ed 0%, #ffffff 100%)" }}>
      <div className={embedded ? "w-full" : "w-full max-w-2xl"}>
        {!embedded && (
          <div className="text-center mb-6">
            <div className="atano-logo text-2xl mb-2"><span className="a-mark">▲</span>ZmartCredential</div>
            <h1 className="font-display text-3xl font-bold text-ink">Create your organization account</h1>
          </div>
        )}

        {/* Step indicator (embedded: with the back button at its left end) */}
        <div className={embedded?.back ? "grid items-center gap-3 mb-6" : "flex items-center mb-6"} style={embedded?.back ? { gridTemplateColumns: "1fr auto 1fr" } : undefined}>
        {embedded?.back && (
          <button onClick={embedded.back.onClick} className="btn btn-secondary justify-self-start" disabled={submitting}>
            <Icon name="ArrowLeft" size={14} /> {embedded.back.label}
          </button>
        )}
        <div className="flex items-center justify-center gap-2 flex-wrap flex-1 min-w-0">
          {steps.map((s, i, arr) => (
            <Fragment key={s.n}>
              <div
                className={"flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium " + (step === s.n ? "bg-accent text-white" : step > s.n ? "cursor-pointer hover:opacity-80" : "text-ink-faint")}
                style={step > s.n ? { background: "var(--success-soft)", color: "var(--success)" } : {}}
                // a completed step can be opened again
                onClick={() => step > s.n && !submitting && setStep(s.n)}
                role={step > s.n ? "button" : undefined}
                title={step > s.n ? "Back to " + s.label : undefined}
              >
                <div
                  className={"w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold " + (step === s.n ? "bg-paper text-accent" : step > s.n ? "" : "bg-soft-2")}
                  style={step > s.n ? { background: "var(--success)", color: "white" } : {}}
                >
                  {step > s.n ? <Icon name="Check" size={10} /> : s.n}
                </div>
                <span>{s.label}</span>
              </div>
              {i < arr.length - 1 && <Icon name="ChevronRight" size={11} className="text-ink-faint" />}
            </Fragment>
          ))}
        </div>
        </div>

        <div className={"card card-pad" + (embedded ? " max-w-3xl mx-auto" : "")}>
          {errors.form && (
            <div className="mb-4 px-3 py-2 rounded-lg flex items-center gap-2" style={{ background: "var(--danger-soft)", color: "#991b1b", fontSize: 13 }}>
              <Icon name="AlertCircle" size={14} /> {errors.form}
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="font-display text-xl font-semibold text-ink mb-1">Organization Information</h2>
              <p className="text-xs text-ink-light mb-4">Tell us about your organization</p>
              <div className="space-y-3">
                <div>
                  <label className="label">Organization Name<RequiredMark /></label>
                  <input value={data.orgName} onChange={(e) => { set("orgName", e.target.value); setErrors((er) => ({ ...er, orgName: undefined })); }} className={"input" + (errors.orgName || nameTaken ? " input-error" : "")} placeholder="Enter Organization Name" maxLength={200} />
                  <Err msg={errors.orgName || nameTaken} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Organization Type</label>
                    <Select value={data.orgType} onChange={(e) => set("orgType", e.target.value)} className="input">
                      {withCurrent(orgTypes, data.orgType).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                    <Err msg={errors.orgType} />
                  </div>
                  <div>
                    <label className="label">Tax ID (EIN)<RequiredMark /></label>
                    <input value={data.taxId} onChange={(e) => set("taxId", e.target.value.replace(/\D/g, "").slice(0, 9))} className={"input font-mono" + (errors.taxId ? " input-error" : "")} placeholder="Enter Tax ID (EIN)" />
                    <Err msg={errors.taxId} />
                  </div>
                </div>
                <div>
                  <label className="label">Website</label>
                  <input value={data.website} onChange={(e) => set("website", e.target.value)} className="input" placeholder="Enter Website" />
                  <Err msg={errors.website} />
                </div>
                <div>
                  <label className="label">Address</label>
                  <input value={data.address} onChange={(e) => set("address", e.target.value)} className="input" placeholder="Enter Address" />
                  <Err msg={errors.address} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">State</label>
                    <StateSelect
                      value={data.state}
                      onChange={(v) => {
                        if (v !== data.state) set("city", "");
                        set("state", v);
                      }}
                      isPublic
                    />
                    <Err msg={errors.state} />
                  </div>
                  <div>
                    <label className="label">City<RequiredMark /></label>
                    <CitySelect state={data.state} value={data.city} onChange={(v) => set("city", v)} isPublic invalid={!!errors.city} />
                    <Err msg={errors.city} />
                  </div>
                  <div>
                    <label className="label">ZIP<RequiredMark /></label>
                    <input value={data.zip} onChange={(e) => set("zip", e.target.value.replace(/\D/g, "").slice(0, 5))} className={"input font-mono" + (errors.zip ? " input-error" : "")} />
                    <Err msg={errors.zip} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="font-display text-xl font-semibold text-ink mb-1">Admin Account</h2>
              <p className="text-xs text-ink-light mb-4">You&apos;ll be the primary administrator. Invite more team members later.</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
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
                  <div className="text-[10px] text-ink-faint mt-1">This will be your username</div>
                  <Err msg={errors.email || emailTaken} />
                </div>
                <div>
                  <label className="label">Ph.No<RequiredMark /></label>
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
                    <label className="label">Confirm Password<RequiredMark /></label>
                    <PasswordInput value={data.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)} className={"input" + (errors.confirmPassword ? " input-error" : "")} autoComplete="new-password" />
                    <Err msg={errors.confirmPassword} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="font-display text-xl font-semibold text-ink mb-1">Choose Your Plan</h2>
              <p className="text-xs text-ink-light mb-4">You can change or cancel anytime</p>
              <div>
                <label className="label">Estimated number of providers</label>
                <div className="flex items-center gap-2 mb-4">
                  <input type="range" min="1" max="100" value={data.estimatedProviders} onChange={(e) => setProviders(Number(e.target.value))} className="flex-1" />
                  <div className="font-display text-2xl font-bold text-accent w-12 text-center">{data.estimatedProviders}</div>
                </div>
              </div>
              {packages.error ? (
                <ErrorState message={packages.error} onRetry={packages.reload} />
              ) : packages.loading && !packages.data ? (
                <Loading label="Loading plans…" />
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {pkgList.map((pkg) => {
                      const pkgTotal = calcSubscriptionTotal(pkg, data.estimatedProviders);
                      const isSelected = pkg.id === data.packageId;
                      const capped = overCap(pkg, data.estimatedProviders);
                      return (
                        <button
                          key={pkg.id}
                          onClick={() => !capped && set("packageId", pkg.id)}
                          disabled={capped}
                          className={"card text-left p-4 transition-all relative " + (isSelected ? "border-accent" : capped ? "opacity-50 cursor-not-allowed" : "card-hover")}
                          style={isSelected ? { borderColor: "var(--accent)", borderWidth: 2 } : {}}
                        >
                          {pkg.recommended && !capped && (
                            <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider" style={{ background: "var(--accent)", color: "white" }}>Popular</div>
                          )}
                          {capped && (
                            <div className="absolute top-2 right-2 text-[9px] px-1.5 py-0.5 rounded" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>Cap exceeded</div>
                          )}
                          <div className="font-display font-semibold text-ink">{pkg.name}</div>
                          <div className="font-display text-2xl font-bold mt-2">
                            ${pkgTotal.toLocaleString()}
                            <span className="text-xs font-normal text-ink-light">/mo</span>
                          </div>
                          <div className="text-xs text-ink-light mt-1">
                            ${pkg.basePrice} + ${pkg.perProvider}/provider
                          </div>
                          <div className="text-[10px] text-ink-faint mt-2">{isUnlimited(pkg.providerCap) ? "Unlimited" : "Up to " + pkg.providerCap} providers</div>
                        </button>
                      );
                    })}
                  </div>
                  <Err msg={errors.packageId || errors.estimatedProviders} />
                  <div className="mt-4 p-3 rounded text-xs" style={{ background: "var(--info-soft)" }}>
                    <Icon name="Info" size={11} className="inline mr-1" style={{ color: "var(--info)" }} />
                    Your subscription will be ${total.toLocaleString()} per month, billed on the same day each month once online payments launch. Per-service credentialing fees are billed monthly based on activity.
                  </div>
                </>
              )}
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 className="font-display text-xl font-semibold text-ink mb-1">Payment Information</h2>
              <p className="text-xs text-ink-light mb-4">
                Your subscription: <span className="font-semibold text-ink">${total.toLocaleString()}</span>/mo{selectedPkg ? " · " + selectedPkg.name : ""}
              </p>
              <DeferredNotice className="mb-4">
                <strong>Your card is not charged yet.</strong> Online payments launch in a later phase. We only save the card brand, last 4 digits, expiry and billing ZIP — the full card number and CVC never leave your browser.
              </DeferredNotice>
              <div className="space-y-3">
                <div>
                  <label className="label">Card Number<RequiredMark /></label>
                  <input
                    value={data.cardNumber}
                    onChange={(e) => set("cardNumber", e.target.value.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})/g, "$1 ").trim())}
                    className={"input font-mono" + (errors.cardNumber ? " input-error" : "")}
                    placeholder="Enter Card Number"
                    autoComplete="cc-number"
                    inputMode="numeric"
                  />
                  {data.cardNumber.replace(/\D/g, "").length >= 2 && !errors.cardNumber && (
                    <div className="text-[10px] text-ink-faint mt-1">{detectCardBrand(data.cardNumber)}</div>
                  )}
                  <Err msg={errors.cardNumber} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Exp (MM/YY)<RequiredMark /></label>
                    <input
                      value={data.cardExp}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                        set("cardExp", v.length <= 2 ? v : v.slice(0, 2) + "/" + v.slice(2));
                      }}
                      className={"input font-mono" + (errors.cardExp ? " input-error" : "")}
                      placeholder="Enter Exp (MM/YY)"
                      autoComplete="cc-exp"
                      inputMode="numeric"
                    />
                    <Err msg={errors.cardExp} />
                  </div>
                  <div>
                    <label className="label">CVC<RequiredMark /></label>
                    <input value={data.cardCvc} onChange={(e) => set("cardCvc", e.target.value.replace(/\D/g, "").slice(0, 4))} className={"input font-mono" + (errors.cardCvc ? " input-error" : "")} placeholder="Enter CVC" autoComplete="cc-csc" inputMode="numeric" />
                    <Err msg={errors.cardCvc} />
                  </div>
                </div>
                <div>
                  <label className="label">Cardholder Name<RequiredMark /></label>
                  <input value={data.cardName} onChange={(e) => set("cardName", e.target.value)} className={"input" + (errors.cardName ? " input-error" : "")} autoComplete="cc-name" />
                  <Err msg={errors.cardName} />
                </div>
                <div>
                  <label className="label">Billing ZIP<RequiredMark /></label>
                  <input value={data.cardZip} onChange={(e) => set("cardZip", e.target.value.replace(/\D/g, "").slice(0, 5))} className={"input font-mono" + (errors.cardZip ? " input-error" : "")} style={{ maxWidth: 120 }} autoComplete="postal-code" inputMode="numeric" />
                  <Err msg={errors.cardZip} />
                </div>
              </div>
              <div className="mt-4 text-[10px] text-ink-faint flex items-center gap-1">
                <Icon name="Lock" size={10} /> When online payments launch, card details will be tokenized via Stripe Elements before submission.
              </div>
            </div>
          )}

          <div className="flex justify-between items-center pt-4 mt-4 border-t border-line">
            <button onClick={() => (step > 1 ? setStep(step - 1) : embedded ? embedded.onCancel() : router.push("/signin"))} className="btn btn-ghost" disabled={submitting}>
              <Icon name="ChevronLeft" size={13} /> {step === 1 && embedded ? "Cancel" : "Back"}
            </button>
            {step < 4 ? (
              <button onClick={next} className="btn btn-primary" disabled={step === 3 && !packages.data}>
                Continue <Icon name="ArrowRight" size={13} />
              </button>
            ) : (
              <button onClick={submit} className="btn btn-primary" disabled={submitting}>
                {submitting ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name={embedded ? "UserPlus" : "Lock"} size={13} />} {embedded ? "Create Admin" : "Create Account"} · ${total.toLocaleString()}/mo
              </button>
            )}
          </div>
        </div>

        {!embedded && (
          <div className="text-center mt-4">
            <Link href="/signin" className="text-xs text-ink-light hover:text-ink">Already have an account? Sign in</Link>
          </div>
        )}
      </div>
    </div>
  );
}

/** "" when the organization name is free (or not checked yet), otherwise the message to show. */
function useOrgNameCheck(name: string, enabled: boolean): string {
  const value = name.trim().replace(/\s+/g, " ");
  const debounced = useDebounced(value, 400);
  const [result, setResult] = useState<{ name: string; message: string }>({ name: "", message: "" });
  useEffect(() => {
    if (!enabled || !debounced) return;
    let cancelled = false;
    api
      .get<{ available: boolean; message: string | null }>("/email-check/org-name", { name: debounced })
      .then((r) => {
        if (!cancelled) setResult({ name: debounced, message: r.available ? "" : r.message || "This organization name is already in use" });
      })
      .catch(() => {
        /* the save reports it */
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, enabled]);
  return enabled && value && result.name === value ? result.message : "";
}
