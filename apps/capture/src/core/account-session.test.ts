import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_ACCOUNT,
  authenticatedAccount,
  effectiveTier,
  signOutAccount,
} from "./account-session";

describe("Capture account session", () => {
  it("uses Motif anonymously with Free-tier behavior", () => {
    expect(ANONYMOUS_ACCOUNT).toEqual({ kind: "anonymous" });
    expect(effectiveTier(ANONYMOUS_ACCOUNT)).toBe("free");
  });

  it("exposes the tier returned for a logged-in account", () => {
    const account = authenticatedAccount({
      email: "musician@example.com",
      tier: "pro",
    });

    expect(account).toEqual({
      kind: "authenticated",
      email: "musician@example.com",
      tier: "pro",
    });
    expect(effectiveTier(account)).toBe("pro");
  });

  it("returns to anonymous Free-tier behavior after logout", () => {
    const account = authenticatedAccount({
      email: "musician@example.com",
      tier: "basic",
    });

    expect(signOutAccount(account)).toBe(ANONYMOUS_ACCOUNT);
    expect(effectiveTier(signOutAccount(account))).toBe("free");
  });
});
