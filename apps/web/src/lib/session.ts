export const SESSION_ACTORS = [
  { id: "user-underwriter-1", name: "Ada Underwriter", role: "UNDERWRITER" as const },
  { id: "user-underwriter-2", name: "Grace Underwriter", role: "UNDERWRITER" as const },
  { id: "user-support-1", name: "Sam Support", role: "SUPPORT" as const },
] as const;

export type SessionActor = (typeof SESSION_ACTORS)[number];

export function actorName(id: string | null): string {
  return SESSION_ACTORS.find((actor) => actor.id === id)?.name ?? id ?? "Unknown";
}
