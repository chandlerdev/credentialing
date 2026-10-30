// Shared form rules for the organization forms (client, practice, location).
// Input filters stop invalid characters while typing; validators give the error message on save.
// The backend enforces the same rules (OrgStructureDtos.PracticeRequest, LocationRequest).

/** Keeps digits only (phone, NPI, ZIP). */
export const digitsOnly = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max);

/**
 * The 10-digit US number from what was typed or pasted: "+12818843247", "1 (281) 884-3247" and "2818843247" all give
 * "2818843247" (the country code 1 is dropped; US area codes never start with 1).
 */
export const usPhoneDigits = (v: string) => {
  let d = v.replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("1")) d = d.slice(1);
  return d.slice(0, 10);
};

/** Tax ID: letters, digits and hyphen, upper-cased. */
export const taxIdChars = (v: string) => v.replace(/[^A-Za-z0-9-]/g, "").toUpperCase().slice(0, 20);

/** City: letters, spaces, period, apostrophe, hyphen. */
export const cityChars = (v: string) => v.replace(/[^A-Za-z .'-]/g, "").slice(0, 100);

/** Address: letters (incl. accented), digits, spaces and # , . : - / ' & ( ). */
export const addressChars = (v: string) => v.replace(/[^\p{L}0-9 #,.:'/&()-]/gu, "").slice(0, 255);

/** Phone / mobile: the country code +1 (fixed for now) and exactly 10 digits, e.g. "+1 2025550123". */
export const PHONE_RE = /^\+1 \d{10}$/;
export const DEFAULT_PHONE_CODE = "+1";
export const NPI_RE = /^\d{10}$/;
export const ZIP_RE = /^\d{5}$/;
export const TAX_ID_RE = /^[A-Za-z0-9-]{5,20}$/;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const HAS_LETTER = /[A-Za-z]/;
const HAS_ANY_LETTER = /\p{L}/u;
const HAS_ALNUM = /[A-Za-z0-9]/;

type Rule = (v: string) => string | undefined;

/** Required name-like text (client, practice, location, legal name): must contain a letter. */
export const nameRule = (label: string, max: number, required = true): Rule => (v) => {
  const t = v.trim();
  if (!t) return required ? label + " is required" : undefined;
  if (t.length < 2) return label + " must be at least 2 characters";
  if (t.length > max) return "Max " + max + " characters";
  if (!HAS_LETTER.test(t)) return label + " must contain letters";
  return undefined;
};

export const phoneRule: Rule = (v) => (v && !PHONE_RE.test(v) ? "Ph.No must be 10 digits" : undefined);
export const npiRule: Rule = (v) => (v && !NPI_RE.test(v) ? "NPI must be 10 digits" : undefined);
export const zipRule = (required: boolean): Rule => (v) => (!v ? (required ? "ZIP is required" : undefined) : !ZIP_RE.test(v) ? "ZIP must be 5 digits" : undefined);
export const emailRule: Rule = (v) => (v && !EMAIL_RE.test(v.trim()) ? "Enter a valid email address" : undefined);

export const taxIdRule: Rule = (v) => {
  if (!v) return undefined;
  if (!TAX_ID_RE.test(v)) return "Tax ID must be 5-20 letters or digits";
  if (!HAS_ALNUM.test(v)) return "Tax ID must contain letters or digits";
  return undefined;
};

export const addressRule = (required: boolean): Rule => (v) => {
  const t = v.trim();
  if (!t) return required ? "Address is required" : undefined;
  if (t.length < 5) return "Address must be at least 5 characters";
  if (!HAS_ANY_LETTER.test(t)) return "Address must contain a street name";
  return undefined;
};

export const cityRule = (required: boolean): Rule => (v) => {
  const t = v.trim();
  if (!t) return required ? "City is required" : undefined;
  if (t.length < 2) return "City must be at least 2 characters";
  return undefined;
};

/** Runs rules per field and returns only the failing ones. */
export function validate(rules: Record<string, [string, Rule]>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [field, [value, rule]] of Object.entries(rules)) {
    const msg = rule(value);
    if (msg) errors[field] = msg;
  }
  return errors;
}

/**
 * Splits a stored phone into its country code and 10 digits. The code is always +1 for now: numbers saved earlier
 * with +91 (or without a code) keep their 10 digits and are saved back as +1.
 */
export function splitPhone(v: string | null | undefined): { code: string; digits: string } {
  const t = (v || "").trim();
  const m = /^\+(1|91)\s*(.*)$/.exec(t);
  return { code: DEFAULT_PHONE_CODE, digits: (m ? m[2] : t).replace(/\D/g, "").slice(-10) };
}

/** "+1 2025550123" — empty when no digits were entered. */
export const joinPhone = (code: string, digits: string) => (digits ? code + " " + digits : "");

/** A stored phone in the form value format ("+1 2025550123"; "" when none). */
export const phoneDigits = (v: string | null | undefined) => {
  const { code, digits } = splitPhone(v);
  return joinPhone(code, digits);
};

/** Card expiry "MM/YY": a real month, and this month or later. */
export const cardExpProblem = (exp: string): string | null => {
  if (!exp || !exp.trim()) return "Expiration date is required";
  const m = /^(\d{2})\/(\d{2})$/.exec(exp.trim());
  if (!m) return "MM/YY format";
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return "Month must be 01-12";
  const now = new Date();
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) return "The card has expired";
  return null;
};
