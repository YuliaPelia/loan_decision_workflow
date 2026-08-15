/** Prisma `Int` / PostgreSQL `INTEGER` ceiling. Same bound as the API domain. */
export const POSTGRES_INTEGER_MAX = 2_147_483_647;

/** Parse a euro amount typed by an underwriter into integer minor units. No float math. */
export function parseEuroToMinorUnits(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    return null;
  }

  const [whole = "0", fraction = ""] = value.split(".");
  const minorDigits = `${whole}${fraction.padEnd(2, "0")}`;
  const minor = Number(minorDigits);

  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > POSTGRES_INTEGER_MAX) {
    return null;
  }

  return minor;
}

/** Format minor units with integer division and remainder — no `minor / 100` float. */
export function formatMinorUnits(minor: number): string {
  const negative = minor < 0;
  const absolute = negative ? -minor : minor;
  const whole = Math.trunc(absolute / 100);
  const cents = absolute % 100;
  const grouped = new Intl.NumberFormat("en-GB").format(whole);
  return `${negative ? "-" : ""}€${grouped}.${String(cents).padStart(2, "0")}`;
}
