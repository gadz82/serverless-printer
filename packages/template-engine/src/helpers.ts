import { TemplateEngineError } from "./errors.js";

export const FIXED_HELPER_NAMES = ["eq", "formatCurrency", "formatDate"] as const;

export type FixedHelperName = (typeof FIXED_HELPER_NAMES)[number];

export type FixedHelpers = {
  readonly eq: (left: unknown, right: unknown) => boolean;
  readonly formatCurrency: (amount: unknown, currency?: string, locale?: string) => string;
  readonly formatDate: (value: unknown, locale?: string) => string;
};

const FIXED_HELPER_NAME_SET: ReadonlySet<string> = new Set(FIXED_HELPER_NAMES);

const CONTROL_HELPER_NAMES: ReadonlySet<string> = new Set(["each", "if", "unless", "with"]);

export const defaultFixedHelpers: FixedHelpers = {
  eq,
  formatCurrency,
  formatDate,
};

export function isFixedHelperName(name: string): name is FixedHelperName {
  return FIXED_HELPER_NAME_SET.has(name);
}

export function isControlHelperName(name: string): boolean {
  return CONTROL_HELPER_NAMES.has(name);
}

export function isKnownHelperName(name: string): boolean {
  return FIXED_HELPER_NAME_SET.has(name) || CONTROL_HELPER_NAMES.has(name);
}

function eq(left: unknown, right: unknown): boolean {
  return left === right;
}

function formatCurrency(amount: unknown, currency = "USD", locale = "en-US"): string {
  const numericAmount = readFiniteNumber(amount);
  if (numericAmount === undefined) {
    throw new TemplateEngineError("formatCurrency requires a finite numeric amount");
  }

  const currencyCode = currency.trim().toUpperCase();
  if (currencyCode.length === 0) {
    throw new TemplateEngineError("formatCurrency requires a currency code");
  }

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
    }).format(numericAmount);
  } catch (error) {
    throw new TemplateEngineError(
      `formatCurrency received an invalid currency or locale: ${currencyCode}`,
      { cause: error },
    );
  }
}

function formatDate(value: unknown, locale = "en-US"): string {
  const date = readDate(value);
  if (date === undefined) {
    throw new TemplateEngineError("formatDate requires a valid date");
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(date);
  } catch (error) {
    throw new TemplateEngineError(`formatDate received an invalid locale: ${locale}`, {
      cause: error,
    });
  }
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function readDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
