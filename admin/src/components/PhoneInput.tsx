"use client";

import { DEFAULT_PHONE_CODE, joinPhone, splitPhone, usPhoneDigits } from "@/lib/validation";

/**
 * Phone / mobile input used everywhere: the country code +1 (fixed for now) and a 10-digit number.
 * The value is "+1 2025550123" ("" while no digits are entered).
 */
export function PhoneInput({
  value,
  onChange,
  invalid = false,
  disabled = false,
  id,
  autoComplete = "tel-national",
  placeholder = "10 digits",
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  autoComplete?: string;
  placeholder?: string;
}) {
  const parts = splitPhone(value);
  return (
    <div className="flex gap-1.5">
      <span
        className={"input font-mono flex items-center justify-center" + (invalid ? " input-error" : "")}
        style={{ width: 56, flexShrink: 0, background: "var(--bg-soft)", color: "var(--ink-light)", paddingLeft: 8, paddingRight: 8 }}
        aria-label="Country code"
        data-country-code
      >
        {DEFAULT_PHONE_CODE}
      </span>
      <input
        id={id}
        value={parts.digits}
        onChange={(e) => onChange(joinPhone(DEFAULT_PHONE_CODE, usPhoneDigits(e.target.value)))}
        className={"input font-mono flex-1 min-w-0" + (invalid ? " input-error" : "")}
        inputMode="numeric"
        placeholder={placeholder || undefined}
        maxLength={18} /* room for a pasted "+1 (281) 884-3247"; the value keeps the 10 digits */
        disabled={disabled}
        autoComplete={autoComplete}
      />
    </div>
  );
}
