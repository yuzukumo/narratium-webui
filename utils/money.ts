const MICROUSD_PER_USD = 1_000_000n;

function decimalToFraction(value: string): { numerator: bigint; denominator: bigint } | null {
  const match = value.trim().match(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/);
  if (!match) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const denominator = 10n ** BigInt(fraction.length);
  return {
    numerator: BigInt(whole) * denominator + BigInt(fraction || "0"),
    denominator,
  };
}

export function parseUSDToMicrousd(value: string, allowNegative = false): string | null {
  const normalized = value.trim();
  const pattern = allowNegative
    ? /^([+-]?)(\d+)(?:\.(\d{0,6}))?$/
    : /^(\+?)(\d+)(?:\.(\d{0,6}))?$/;
  const match = normalized.match(pattern);
  if (!match) {
    return null;
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] || "").padEnd(6, "0"));
  return (sign * (whole * MICROUSD_PER_USD + fraction)).toString();
}

export function microusdToUSDInput(value: string): string {
  try {
    const amount = BigInt(value || "0");
    const sign = amount < 0n ? "-" : "";
    const absolute = amount < 0n ? -amount : amount;
    const whole = absolute / MICROUSD_PER_USD;
    const fraction = (absolute % MICROUSD_PER_USD)
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "");
    return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
  } catch {
    return "0";
  }
}

/** Applies the billing multiplier using integer arithmetic and billing's upward rounding. */
export function multiplyMicrousdByMultiplier(value: string, multiplier: string): string {
  try {
    const amount = BigInt(value || "0");
    const fraction = decimalToFraction(multiplier || "1");
    if (!fraction || amount <= 0n) return value || "0";
    const numerator = amount * fraction.numerator;
    const quotient = numerator / fraction.denominator;
    const remainder = numerator % fraction.denominator;
    return (remainder === 0n ? quotient : quotient + 1n).toString();
  } catch {
    return value || "0";
  }
}

export function formatMicrousd(value: string, fractionDigits = 2): string {
  try {
    const amount = BigInt(value || "0");
    const sign = amount < 0n ? "-" : "";
    const absolute = amount < 0n ? -amount : amount;
    const digits = Math.min(Math.max(fractionDigits, 0), 6);
    const divisor = 10n ** BigInt(6 - digits);
    const rounded = (absolute + divisor / 2n) / divisor;
    const decimalScale = 10n ** BigInt(digits);
    const whole = rounded / decimalScale;
    const fraction = digits > 0
      ? `.${(rounded % decimalScale).toString().padStart(digits, "0")}`
      : "";
    return `${sign}$${whole}${fraction}`;
  } catch {
    return "$0.00";
  }
}
