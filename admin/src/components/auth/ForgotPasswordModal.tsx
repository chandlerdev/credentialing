"use client";

import { useEffect, useState } from "react";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { PasswordInput } from "@/components/PasswordInput";
import { api, errorMessage } from "@/lib/api";

type Step = "email" | "code" | "password" | "done";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The password rule (same as the server's PasswordResetService.passwordProblem). */
export const PASSWORD_RULES: { test: (p: string) => boolean; label: string }[] = [
  { test: (p) => p.length >= 8, label: "At least 8 characters" },
  { test: (p) => /[A-Z]/.test(p), label: "An uppercase letter" },
  { test: (p) => /[a-z]/.test(p), label: "A lowercase letter" },
  { test: (p) => /[0-9]/.test(p), label: "A number" },
  { test: (p) => /[^A-Za-z0-9]/.test(p) && !/\s/.test(p), label: "A special character (e.g. @ # $ !)" },
];

export function passwordProblem(p: string): string | null {
  if (!p || !p.trim()) return "Enter a new password";
  if (/\s/.test(p)) return "The password cannot contain spaces";
  const failed = PASSWORD_RULES.find((r) => !r.test(p));
  return failed ? "Password needs: " + failed.label.toLowerCase() : null;
}

/**
 * Sign-in → Forgot password: email → 6-digit code sent to that email → new password + confirm.
 * Closes only with ✕ or Cancel.
 */
export function ForgotPasswordModal({ onClose, onDone }: { onClose: () => void; onDone: (email: string) => void }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const emailProblem = (v: string) => {
    if (!v || !v.trim()) return "Email is required";
    if (/\s/.test(v.trim())) return "The email cannot contain spaces";
    if (!EMAIL_RE.test(v.trim())) return "Enter a valid email address";
    return null;
  };

  const sendCode = async () => {
    const problem = emailProblem(email);
    if (problem) return setErrors({ email: problem });
    setBusy(true);
    setErrors({});
    try {
      const res = await api.post<{ message: string }>("/auth/forgot-password", { email: email.trim() });
      setInfo(res.message);
      setCode("");
      setStep("code");
      setResendIn(30);
    } catch (e) {
      setErrors({ email: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!code || !code.trim()) return setErrors({ code: "Enter the 6-digit code" });
    if (!/^[0-9]{6}$/.test(code)) return setErrors({ code: "The code is 6 digits" });
    setBusy(true);
    setErrors({});
    try {
      const res = await api.post<{ resetToken: string }>("/auth/forgot-password/verify", { email: email.trim(), code });
      setResetToken(res.resetToken);
      setStep("password");
    } catch (e) {
      setErrors({ code: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    const e: Record<string, string> = {};
    const p = passwordProblem(password);
    if (p) e.password = p;
    if (!confirm || !confirm.trim()) e.confirm = "Confirm the new password";
    else if (confirm !== password) e.confirm = "The passwords do not match";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await api.post("/auth/forgot-password/reset", { resetToken, password, confirmPassword: confirm });
      setStep("done");
    } catch (err) {
      setErrors({ password: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Step, string> = {
    email: "Forgot password",
    code: "Enter the code",
    password: "Set a new password",
    done: "Password changed",
  };
  const subtitles: Record<Step, string> = {
    email: "Enter your account's email and we'll send you a 6-digit code.",
    code: "Check your email for the 6-digit code.",
    password: "Choose a new password for your account.",
    done: "You can now sign in with your new password.",
  };

  return (
    <Modal title={titles[step]} subtitle={subtitles[step]} onClose={onClose} maxWidth={440}>
      <div className="space-y-4">
        {step === "email" && (
          <Field label="Email" required error={errors.email}>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value.replace(/\s/g, ""));
                setErrors({});
              }}
              onKeyDown={(e) => e.key === "Enter" && sendCode()}
              className="input"
              placeholder="Enter Email"
              autoFocus
              autoComplete="email"
            />
          </Field>
        )}

        {step === "code" && (
          <>
            {info && (
              <div className="p-3 rounded-lg text-xs flex items-start gap-2" style={{ background: "var(--info-soft)", color: "#1e40af" }}>
                <Icon name="Mail" size={13} className="mt-0.5 flex-shrink-0" /> {info}
              </div>
            )}
            <Field label="6-digit code" required error={errors.code}>
              <input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6));
                  setErrors({});
                }}
                onKeyDown={(e) => e.key === "Enter" && verify()}
                className="input font-mono text-center tracking-[0.5em] text-lg"
                inputMode="numeric"
                placeholder="Enter 6-digit code"
                autoFocus
                autoComplete="one-time-code"
              />
            </Field>
            <div className="flex items-center justify-between text-xs">
              <button className="text-ink-light hover:underline" onClick={() => setStep("email")} disabled={busy}>
                <Icon name="ChevronLeft" size={11} /> Change email
              </button>
              <button className="text-accent hover:underline disabled:text-ink-faint disabled:no-underline" onClick={sendCode} disabled={busy || resendIn > 0}>
                {resendIn > 0 ? "Resend code in " + resendIn + "s" : "Resend code"}
              </button>
            </div>
          </>
        )}

        {step === "password" && (
          <>
            <Field label="New Password" required error={errors.password}>
              <PasswordInput
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrors((er) => ({ ...er, password: "" }));
                }}
                className="input"
                autoComplete="new-password"
                autoFocus
                maxLength={100}
              />
            </Field>
            <ul className="text-[11px] space-y-0.5 -mt-2">
              {PASSWORD_RULES.map((r) => {
                const ok = r.test(password);
                return (
                  <li key={r.label} className="flex items-center gap-1.5" style={{ color: ok ? "var(--success)" : "var(--ink-faint)" }}>
                    <Icon name={ok ? "CheckCircle2" : "Circle"} size={11} /> {r.label}
                  </li>
                );
              })}
              <li className="flex items-center gap-1.5" style={{ color: password && !/\s/.test(password) ? "var(--success)" : "var(--ink-faint)" }}>
                <Icon name={password && !/\s/.test(password) ? "CheckCircle2" : "Circle"} size={11} /> No spaces
              </li>
            </ul>
            <Field label="Confirm Password" required error={errors.confirm}>
              <PasswordInput
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setErrors((er) => ({ ...er, confirm: "" }));
                }}
                onKeyDown={(e) => e.key === "Enter" && reset()}
                className="input"
                autoComplete="new-password"
                maxLength={100}
              />
            </Field>
          </>
        )}

        {step === "done" && (
          <div className="p-4 rounded-lg flex items-center gap-3" style={{ background: "var(--success-soft)", color: "var(--success)" }}>
            <Icon name="CheckCircle2" size={22} />
            <div className="text-sm text-ink">Your password has been changed.</div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          {step === "done" ? (
            <button onClick={() => onDone(email.trim())} className="btn btn-primary">
              Back to Sign In <Icon name="ArrowRight" size={13} />
            </button>
          ) : (
            <>
              <button onClick={onClose} className="btn btn-secondary" disabled={busy}>
                Cancel
              </button>
              <button onClick={step === "email" ? sendCode : step === "code" ? verify : reset} className="btn btn-primary" disabled={busy}>
                {busy && <span className="loader" />} {step === "email" ? "Send Code" : step === "code" ? "Verify Code" : "Change Password"}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
