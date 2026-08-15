import type { SessionUser, UserRole } from "./domain.js";

const SEEDED_NAMES: Record<string, string> = {
  "user-underwriter-1": "Ada Underwriter",
  "user-underwriter-2": "Grace Underwriter",
  "user-support-1": "Sam Support",
};

function headerValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function parseRole(value: string | undefined): UserRole | undefined {
  if (value === "UNDERWRITER" || value === "SUPPORT") {
    return value;
  }
  return undefined;
}

/** Missing or unrecognised identity headers yield no session (HTTP 401). */
export function sessionFromHeaders(headers: {
  "x-user-id"?: string | string[] | undefined;
  "x-user-role"?: string | string[] | undefined;
}): { user: SessionUser } | null {
  const id = headerValue(headers["x-user-id"]);
  const role = parseRole(headerValue(headers["x-user-role"]));
  if (!id || !role) {
    return null;
  }

  return {
    user: {
      id,
      name: SEEDED_NAMES[id] ?? "Unknown user",
      role,
    },
  };
}
