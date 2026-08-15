import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  try {
    const envPath = resolve(import.meta.dirname, "../../../../.env");
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("DATABASE_URL=")) {
        return trimmed.slice("DATABASE_URL=".length).replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}
