"use client";

import { useState } from "react";
import { cardExpProblem } from "@/lib/validation";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useToast } from "@/stores/toast";
import { brandColor } from "@/components/billing/shared";
import type { PaymentMethod } from "@/types/billing";

// Detect brand from the leading digits (prototype rules).
const detectBrand = (num: string): PaymentMethod["brand"] => {
  const cleaned = num.replace(/\s/g, "");
  if (/^4/.test(cleaned)) return "Visa";
  if (/^5[1-5]/.test(cleaned)) return "Mastercard";
  if (/^3[47]/.test(cleaned)) return "Amex";
  if (/^6/.test(cleaned)) return "Discover";
  return "Card";
};

const formatCardNumber = (v: string) => {
  const cleaned = v.replace(/\D/g, "").slice(0, 16);
  return cleaned.replace(/(\d{4})/g, "$1 ").trim();
};

const formatExp = (v: string) => {
  const cleaned = v.replace(/\D/g, "").slice(0, 4);
  if (cleaned.length <= 2) return cleaned;
  return cleaned.slice(0, 2) + "/" + cleaned.slice(2);
};

/**
 * Card form. Only metadata (brand, last4, exp, billingName, billingZip) is sent to the API —
 * the full card number and CVC never leave the browser. Stripe Elements arrives in a later phase.
 */
export function AddCardModal({ onClose, onAdded }: { onClose: () => void; onAdded: (pm: PaymentMethod) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ number: "", exp: "", cvc: "", name: "", zip: "" });
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const validate = () => {
    const cleaned = form.number.replace(/\s/g, "");
    if (cleaned.length < 13) return "Card number too short";
    if (!/^\d+$/.test(cleaned)) return "Invalid card number";
    const expProblem = cardExpProblem(form.exp);
    if (expProblem) return expProblem === "Required" ? "Expiration is required" : expProblem;
    const [mm, yy] = form.exp.split("/").map(Number);
    if (mm < 1 || mm > 12) return "Invalid expiration month";
    const now = new Date();
    const curYY = now.getFullYear() % 100;
    if (yy < curYY || (yy === curYY && mm < now.getMonth() + 1)) return "Card is expired";
    if (form.cvc.length < 3 || form.cvc.length > 4) return "Invalid CVC";
    if (!form.name.trim()) return "Cardholder name required";
    if (!/^\d{5}$/.test(form.zip)) return "Invalid ZIP";
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError("");
    setFieldErrors({});
    const cleaned = form.number.replace(/\s/g, "");
    const body = { brand: detectBrand(cleaned), last4: cleaned.slice(-4), exp: form.exp, billingName: form.name.trim(), billingZip: form.zip };
    setBusy(true);
    try {
      const pm = await api.post<PaymentMethod>("/billing/payment-methods", body);
      toast("Card added: " + pm.brand + " ending in " + pm.last4);
      onAdded(pm);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setFieldErrors(e.fieldErrors);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add Payment Method" subtitle="Card processing is not live yet — no card will be charged" onClose={busy ? undefined : onClose} maxWidth={460}>
      <div className="space-y-3">
        <div className="p-2 rounded text-xs flex items-start gap-2" style={{ background: "var(--warn-soft)", color: "#a16207" }}>
          <Icon name="AlertTriangle" size={12} className="mt-0.5" />
          <div>
            <strong>Card metadata only.</strong> We save the brand, last 4 digits, expiration, name and ZIP. The full card number and CVC are never sent to our servers.
          </div>
        </div>

        <Field label="Card Number" error={fieldErrors.last4 || fieldErrors.brand}>
          <div className="relative">
            <input
              value={form.number}
              onChange={(e) => setForm({ ...form, number: formatCardNumber(e.target.value) })}
              className="input font-mono"
              placeholder="Enter Card Number"
              style={{ paddingRight: 60 }}
              autoComplete="cc-number"
              inputMode="numeric"
            />
            {form.number && (
              <div className="absolute right-2 top-1.5 px-2 py-0.5 rounded text-[10px] font-bold text-white" style={{ background: brandColor(detectBrand(form.number)) }}>
                {detectBrand(form.number).toUpperCase()}
              </div>
            )}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Expiration (MM/YY)" error={fieldErrors.exp}>
            <input value={form.exp} onChange={(e) => setForm({ ...form, exp: formatExp(e.target.value) })} className="input font-mono" placeholder="Enter Expiration (MM/YY)" autoComplete="cc-exp" inputMode="numeric" />
          </Field>
          <Field label="CVC">
            <input value={form.cvc} onChange={(e) => setForm({ ...form, cvc: e.target.value.replace(/\D/g, "").slice(0, 4) })} className="input font-mono" placeholder="Enter CVC" autoComplete="cc-csc" inputMode="numeric" />
          </Field>
        </div>

        <Field label="Cardholder Name" error={fieldErrors.billingName}>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" placeholder="Enter Cardholder Name" autoComplete="cc-name" />
        </Field>

        <Field label="Billing ZIP" error={fieldErrors.billingZip}>
          <input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value.replace(/\D/g, "").slice(0, 5) })} className="input font-mono" style={{ maxWidth: 120 }} placeholder="Enter Billing ZIP" autoComplete="postal-code" inputMode="numeric" />
        </Field>

        {error && (
          <div className="px-3 py-2 rounded-lg text-sm flex items-center gap-2" style={{ background: "var(--danger-soft)", color: "#991b1b" }}>
            <Icon name="AlertCircle" size={13} /> {error}
          </div>
        )}

        <div className="text-[10px] text-ink-faint flex items-center gap-1">
          <Icon name="Lock" size={10} /> In a later phase, card details will be tokenized via Stripe Elements and never touch our servers.
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={handleSubmit} className="btn btn-primary" disabled={busy}>
            {busy ? <span className="loader" style={{ borderTopColor: "white" }} /> : <Icon name="Lock" size={13} />} Add Card
          </button>
        </div>
      </div>
    </Modal>
  );
}
