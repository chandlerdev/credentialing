"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/hooks";

/** idle → connecting → ringing → in-call → ended (Twilio browser call). */
export type CallPhase = "idle" | "connecting" | "ringing" | "in-call" | "ended";

/** How the payer answered (Twilio DialCallStatus) and how long they were connected. */
export interface CallResult {
  dialStatus: string | null;
  seconds: number | null;
  answered: boolean;
}

interface TokenView {
  enabled: boolean;
  token: string | null;
  identity: string | null;
  callerId: string | null;
}

// the Twilio Voice SDK types, loaded on demand (browser only)
type TwilioCall = {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  disconnect: () => void;
  mute: (m: boolean) => void;
  sendDigits: (d: string) => void;
  parameters: Record<string, string>;
};
type TwilioDevice = { connect: (o: { params: Record<string, string> }) => Promise<TwilioCall>; destroy: () => void; disconnectAll: () => void };

/** "+1 8005550100" → "+18005550100" */
export const e164 = (v: string) => {
  let d = v.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? "+1" + d : null;
};

/**
 * A browser call to the payer through the organization's Twilio account (admin → Calling). The server only dials the
 * payer's Support Phone for that enrollment. After hang-up the payer's answer (completed / busy / no-answer …) is read
 * back so the call outcome can be filled in.
 */
export function useBrowserCall(enrollmentId: number, onError: (message: string) => void, onResult?: (r: CallResult) => void) {
  const status = useAsync<TokenView>(() => api.get("/calling/token"), []);
  const device = useRef<TwilioDevice | null>(null);
  const call = useRef<TwilioCall | null>(null);
  const acceptedAt = useRef<number | null>(null);
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [result, setResult] = useState<CallResult | null>(null);

  // the in-call timer
  useEffect(() => {
    if (phase !== "in-call") return;
    const t = setInterval(() => setSeconds(acceptedAt.current ? Math.floor((Date.now() - acceptedAt.current) / 1000) : 0), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // hang up and release the microphone when the dialog closes
  useEffect(
    () => () => {
      try {
        call.current?.disconnect();
        device.current?.destroy();
      } catch {
        /* already gone */
      }
    },
    []
  );

  const finish = useCallback(async (c: TwilioCall | null) => {
    setPhase("ended");
    const answered = acceptedAt.current != null;
    const local = answered ? Math.round((Date.now() - acceptedAt.current!) / 1000) : null;
    const sid = c?.parameters?.CallSid;
    let dialStatus: string | null = null;
    let dialSeconds: number | null = null;
    // Twilio posts the payer's answer to the server right after the call: read it back (a few tries)
    for (let i = 0; sid && i < 8 && !dialStatus; i++) {
      await new Promise((r) => setTimeout(r, 800));
      try {
        const s = await api.get<{ dialStatus: string | null; dialDuration: number | null }>("/calling/sessions/" + sid);
        dialStatus = s.dialStatus;
        dialSeconds = s.dialDuration;
      } catch {
        /* not reported yet */
      }
    }
    const r = { dialStatus: dialStatus || (answered ? "completed" : null), seconds: dialSeconds ?? local, answered };
    setResult(r);
    onResult?.(r);
    try {
      device.current?.destroy();
    } catch {
      /* ignore */
    }
    device.current = null;
    call.current = null;
  }, [onResult]);

  const start = useCallback(
    async (phone: string) => {
      const to = e164(phone);
      if (!to) return onError("The payer's support phone isn't a valid US number");
      setPhase("connecting");
      setResult(null);
      setSeconds(0);
      setMuted(false);
      acceptedAt.current = null;
      try {
        const t = await api.get<TokenView>("/calling/token", { issue: true });
        if (!t.enabled || !t.token) throw new Error("Calling is off — ask your admin to set it up in Calling");
        const { Device } = await import("@twilio/voice-sdk");
        const d = new Device(t.token, { logLevel: "error", closeProtection: true }) as unknown as TwilioDevice;
        device.current = d;
        const c = await d.connect({ params: { To: to, EnrollmentId: String(enrollmentId) } });
        call.current = c;
        c.on("ringing", () => setPhase("ringing"));
        c.on("accept", () => {
          acceptedAt.current = Date.now();
          setPhase("in-call");
        });
        c.on("disconnect", () => finish(c));
        c.on("cancel", () => finish(c));
        c.on("reject", () => finish(c));
        c.on("error", (e) => {
          onError((e as { message?: string })?.message || "The call failed");
          finish(c);
        });
      } catch (e) {
        onError(e instanceof Error ? e.message : errorMessage(e));
        setPhase("idle");
        try {
          device.current?.destroy();
        } catch {
          /* ignore */
        }
        device.current = null;
      }
    },
    [enrollmentId, finish, onError]
  );

  const hangUp = useCallback(() => {
    if (call.current) call.current.disconnect();
    else device.current?.disconnectAll();
  }, []);
  const toggleMute = useCallback(() => {
    if (!call.current) return;
    call.current.mute(!muted);
    setMuted(!muted);
  }, [muted]);
  const sendDigit = useCallback((d: string) => call.current?.sendDigits(d), []);

  return {
    enabled: !!status.data?.enabled,
    checking: status.loading && !status.data,
    callerId: status.data?.callerId || null,
    phase,
    seconds,
    muted,
    result,
    start,
    hangUp,
    toggleMute,
    sendDigit,
    active: phase === "connecting" || phase === "ringing" || phase === "in-call",
  };
}

/** The call outcome for the payer's answer. */
export function outcomeFor(r: CallResult): string | null {
  switch (r.dialStatus) {
    case "completed":
      return "Call attended";
    case "busy":
      return "Line busy";
    case "no-answer":
      return "Missed call / no answer";
    case "failed":
    case "canceled":
      return "Call dropped";
    default:
      return r.answered ? "Call attended" : null;
  }
}

export const mmss = (s: number) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
