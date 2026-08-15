import { describe, expect, it } from "vitest";

import { sessionFromHeaders } from "../../src/session.js";

describe("sessionFromHeaders", () => {
  it("returns no session when credentials are missing", () => {
    expect(sessionFromHeaders({})).toBeNull();
    expect(sessionFromHeaders({ "x-user-id": "user-underwriter-1" })).toBeNull();
    expect(sessionFromHeaders({ "x-user-role": "UNDERWRITER" })).toBeNull();
  });

  it("returns no session for an unrecognised role", () => {
    expect(
      sessionFromHeaders({
        "x-user-id": "user-underwriter-1",
        "x-user-role": "ADMIN",
      }),
    ).toBeNull();
    expect(
      sessionFromHeaders({
        "x-user-id": "user-underwriter-1",
        "x-user-role": "underwriter",
      }),
    ).toBeNull();
    expect(
      sessionFromHeaders({
        "x-user-id": "user-underwriter-1",
        "x-user-role": " ",
      }),
    ).toBeNull();
  });

  it("builds a session only when id and an exact known role are present", () => {
    expect(
      sessionFromHeaders({
        "x-user-id": "user-underwriter-1",
        "x-user-role": "UNDERWRITER",
      }),
    ).toMatchObject({
      user: { id: "user-underwriter-1", role: "UNDERWRITER", name: "Ada Underwriter" },
    });
  });
});
