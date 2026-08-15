/** Parse a euro amount typed by an underwriter into integer minor units. No float math. */
export function parseEuroToMinorUnits(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    return null;
  }

  const [whole = "0", fraction = ""] = value.split(".");
  const minorDigits = `${whole}${fraction.padEnd(2, "0")}`;
  const minor = Number(minorDigits);

  if (!Number.isSafeInteger(minor) || minor <= 0) {
    return null;
  }

  return minor;
}

export function formatMinorUnits(minor: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(minor / 100);
}
