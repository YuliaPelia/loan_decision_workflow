"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import superjson from "superjson";

import { SESSION_ACTORS, type SessionActor } from "@/lib/session";
import { trpc } from "@/lib/trpc";

const SessionContext = createContext<{
  actor: SessionActor;
  setActor: (actor: SessionActor) => void;
} | null>(null);

export function useSessionActor() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSessionActor must be used within Providers");
  }
  return value;
}

export function Providers({ children }: Readonly<{ children: ReactNode }>) {
  const [actor, setActor] = useState<SessionActor>(() => {
    const ada = SESSION_ACTORS.find((item) => item.id === "user-underwriter-1");
    if (!ada) {
      throw new Error("Seeded Ada underwriter is missing from SESSION_ACTORS");
    }
    return ada;
  });
  const actorRef = useRef(actor);
  actorRef.current = actor;

  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          transformer: superjson,
          url: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc",
          headers() {
            return {
              "x-user-id": actorRef.current.id,
              "x-user-role": actorRef.current.role,
            };
          },
        }),
      ],
    }),
  );

  const session = useMemo(() => ({ actor, setActor }), [actor]);

  function switchActor(next: SessionActor) {
    setActor(next);
    void queryClient.invalidateQueries();
  }

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <SessionContext.Provider value={session}>
          <div className="session-bar">
            <label>
              Acting as
              <select
                aria-label="Acting as"
                onChange={(event) => {
                  const next = SESSION_ACTORS.find((item) => item.id === event.target.value);
                  if (next) {
                    switchActor(next);
                  }
                }}
                value={actor.id}
              >
                {SESSION_ACTORS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.role})
                  </option>
                ))}
              </select>
            </label>
            <p>
              Header identity for local review. Production must replace this with a verified
              session.
            </p>
          </div>
          {children}
        </SessionContext.Provider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
