"use client";

import { Suspense, useEffect, useState } from "react";
import { FitToScreen } from "@/components/FitToScreen";
import { PasswordInput } from "@/components/PasswordInput";
import { ForgotPasswordModal } from "@/components/auth/ForgotPasswordModal";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { BlurLoader } from "@/components/BusyOverlay";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/Pill";
import { ROLE_PILL } from "@/lib/constants";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/stores/auth";

// Demo accounts seeded by db/demo/V100__demo_data.sql (shown only when NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=true).
const DEMO_ACCOUNTS = [
  { username: "admin", password: "admin123", displayName: "Jake Zebaida", role: "org_admin" },
  { username: "clerk", password: "clerk123", displayName: "Maria Rodriguez", role: "clerk" },
  { username: "erizzo", password: "rizzo123", displayName: "Erin Rizzo", role: "provider" },
  { username: "platform.admin", password: "test123", displayName: "Pat Platform", role: "platform_admin" },
  { username: "org.admin.1", password: "test123", displayName: "Owen Admin", role: "org_admin" },
  { username: "clerk.1", password: "test123", displayName: "Carla Clerk", role: "clerk" },
  { username: "auditor", password: "test123", displayName: "Audrey Auditor", role: "auditor" },
  { username: "test.provider", password: "test123", displayName: "Dr. Test Provider", role: "provider" },
];
const SHOW_DEMO = process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS === "true";

export default function SignInPage() {
  return (
    <Suspense>
      <SignInScreen />
    </Suspense>
  );
}

function SignInScreen() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  // After sign-in always open the Dashboard (providers: their portal), whatever page was open before.
  const destination = (role: string) => (role === "provider" ? "/my-portal" : "/dashboard");

  useEffect(() => {
    if (!loading && user) router.replace(destination(user.role));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  const handleSignIn = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");
    if (!username.trim() || !password) {
      setError("Enter your username and password");
      return;
    }
    setBusy(true);
    try {
      const me = await login(username.trim(), password);
      // the loader stays until the dashboard replaces this page
      router.replace(destination(me.role));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const fillDemo = (u: (typeof DEMO_ACCOUNTS)[number]) => {
    setUsername(u.username);
    setPassword(u.password);
    setError("");
  };

  return (
    <>
      <BlurLoader show={busy || (!loading && !!user)} label="Signing in" />
    <FitToScreen style={{ background: "linear-gradient(135deg, #fff7ed 0%, #f8f9fb 50%, #eff6ff 100%)" }}>
      <div className="card" style={{ width: "min(980px, calc(100vw - 32px))" }}>
        <div className="grid grid-cols-1 md:grid-cols-5" style={{ minHeight: 560 }}>
          {/* LEFT — branding */}
          <div className="md:col-span-2 p-10 flex flex-col justify-between rounded-l-xl" style={{ background: "linear-gradient(180deg, #fff7ed 0%, #ffedd5 100%)" }}>
            <div>
              <div className="atano-logo text-3xl mb-12 text-ink">
                <span className="a-mark">▲</span>ZmartCredential
              </div>
              <h1 className="font-display text-4xl font-bold text-ink leading-tight mb-3">Provider credentialing, automated.</h1>
              <p className="text-sm text-ink-light leading-relaxed">From CAQH imports to payer submissions — manage providers, documents, and enrollments in one platform.</p>
            </div>
            <div className="space-y-3 mt-8">
              {[
                { icon: "Sparkles", title: "AI-powered document classification", desc: "Drop documents and let the system file them." },
                { icon: "Send", title: "Secure provider links", desc: "PIN-protected upload portal for providers." },
                { icon: "FileCheck2", title: "Payer form auto-fill", desc: "Pre-populate enrollment forms from provider data." },
              ].map((f) => (
                <div key={f.title} className="flex items-start gap-2">
                  <div className="text-accent mt-1">
                    <Icon name={f.icon} size={14} />
                  </div>
                  <div className="text-xs text-ink">
                    <span className="font-semibold">{f.title}</span>
                    <div className="text-ink-light">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT — form */}
          <div className="md:col-span-3 p-10">
            <div className="mb-6">
              <h2 className="font-display text-2xl font-bold text-ink">Welcome back</h2>
              <p className="text-sm text-ink-light mt-1">Sign in to your account.</p>
            </div>

            <form onSubmit={handleSignIn} className="space-y-4" noValidate>
              <div>
                <label className="label" htmlFor="username">Username</label>
                <input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" className="input" placeholder="Enter Username" />
              </div>
              <div>
                <label className="label" htmlFor="password">Password</label>
                <PasswordInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="input" placeholder="Enter Password" />
              </div>
              {error && (
                <div className="px-3 py-2 rounded-lg flex items-center gap-2" style={{ background: "var(--danger-soft)", color: "#991b1b", fontSize: 13 }}>
                  <Icon name="AlertCircle" size={14} /> {error}
                </div>
              )}
              <button type="submit" disabled={busy} className="btn btn-primary w-full" style={{ padding: "10px 14px", fontSize: 14 }}>
                {busy ? <span className="loader" style={{ borderTopColor: "white" }} /> : null} Sign In <Icon name="ArrowRight" size={14} />
              </button>
            </form>

            <div className="text-center mt-4 pb-2 border-b border-line">
              <button type="button" onClick={() => setForgotOpen(true)} className="text-sm text-accent font-medium hover:underline">
                Forgot password?
              </button>
            </div>
            {forgotOpen && (
              <ForgotPasswordModal
                onClose={() => setForgotOpen(false)}
                onDone={(email) => {
                  setForgotOpen(false);
                  setUsername(email);
                  setPassword("");
                  setError("");
                }}
              />
            )}

            {SHOW_DEMO && (
              <div className="mt-8 pt-6 border-t border-line">
                <div className="text-xs font-medium text-ink-faint uppercase tracking-wider mb-3">Demo accounts — tap to fill</div>
                <div className="p-2 rounded mb-3 text-[11px]" style={{ background: "var(--info-soft)", color: "var(--info)" }}>
                  <Icon name="Info" size={11} className="inline mr-1" />
                  Click any account below to auto-fill the form. All passwords shown.
                </div>
                <div className="text-[11px] text-ink-light mb-2">
                  Password for all accounts: <span className="font-mono bg-soft px-1.5 py-0.5 rounded">test123</span> (except admin/admin123, clerk/clerk123, erizzo/rizzo123)
                </div>
                <div className="space-y-1.5" style={{ maxHeight: 280, overflowY: "auto", paddingRight: 4 }}>
                  {DEMO_ACCOUNTS.map((u) => (
                    <button key={u.username} type="button" onClick={() => fillDemo(u)} className="w-full text-left p-2.5 rounded-lg border border-line hover:border-accent transition-colors flex items-center gap-2.5">
                      <Avatar name={u.displayName} size={28} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-xs text-ink">{u.displayName}</div>
                        <div className="text-[10px] text-ink-light font-mono">
                          {u.username} / {u.password}
                        </div>
                      </div>
                      <Pill type={ROLE_PILL[u.role] || "neutral"}>{u.role}</Pill>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </FitToScreen>
    </>
  );
}
