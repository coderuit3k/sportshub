"use client";
import { useEffect, useState } from "react";

/**
 * Date field that always DISPLAYS dd/MM/yyyy while the value it carries
 * stays ISO yyyy-mm-dd (the shape the server, URLs and <input type="date">
 * use). A native date input renders in the *browser's* locale, which is
 * how users ended up seeing MM/DD/YYYY — this field pins the display
 * format instead.
 *
 * Editing: digits only, slashes are inserted automatically
 * ("26102026" → "26/10/2026"). As soon as the text forms a complete,
 * real calendar date it is accepted (onChange with the ISO value, or the
 * hidden `name` input for plain form submits). Anything invalid — a
 * non-existent date like 31/02, or a date before `minISO` — is never
 * accepted, and on blur the text reverts to the last valid value.
 */
export interface DateFieldProps {
  /** Controlled ISO value (yyyy-mm-dd). */
  value?: string;
  /** Initial ISO value when uncontrolled. */
  defaultValue?: string;
  /** Called with the ISO value whenever a complete valid date is entered. */
  onChange?: (iso: string) => void;
  /** When set, a hidden input with this name carries the ISO value (form submit). */
  name?: string;
  /** Earliest acceptable ISO date; earlier dates are rejected. */
  minISO?: string;
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-26" → "26/10/2026"; anything not ISO-shaped → "". */
export function isoToDisplay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/**
 * Strictly parse a displayed dd/MM/yyyy date to ISO yyyy-mm-dd.
 * Returns null for malformed text and for dates that don't exist
 * (31/02, 29/02 in a non-leap year, month 13, day 0, …).
 */
export function parseDisplayDate(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  // Day 0 of the next month = last day of this one (leap-year aware).
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Insert the slashes while typing: "2610" → "26/10". */
function maskDigits(digits: string): string {
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export default function DateField({
  value,
  defaultValue,
  onChange,
  name,
  minISO,
  className,
  ariaLabel,
  placeholder = "dd/MM/yyyy",
}: DateFieldProps) {
  const [iso, setIso] = useState<string>(value ?? defaultValue ?? "");
  const [text, setText] = useState<string>(() => isoToDisplay(value ?? defaultValue ?? ""));

  // Sync with a controlled `value` changed from outside this field.
  useEffect(() => {
    if (value !== undefined && value !== iso) {
      setIso(value);
      setText(isoToDisplay(value));
    }
  }, [value, iso]);

  const handleChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    const masked = maskDigits(digits);
    setText(masked);
    if (digits.length === 8) {
      const parsed = parseDisplayDate(masked);
      if (parsed && (!minISO || parsed >= minISO)) {
        setIso(parsed);
        onChange?.(parsed);
      }
    }
  };

  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        className={className}
        aria-label={ariaLabel}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setText(isoToDisplay(iso))}
      />
      {name && <input type="hidden" name={name} value={iso} />}
    </>
  );
}
