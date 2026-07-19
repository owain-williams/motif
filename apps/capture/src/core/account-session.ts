import type { Tier } from "@motif/shared";

export type AccountSession =
  | { readonly kind: "anonymous" }
  | {
      readonly kind: "authenticated";
      readonly email: string;
      readonly tier: Tier;
    };

/** Capture needs no account: anonymous use always receives Free capabilities. */
export const ANONYMOUS_ACCOUNT: AccountSession = { kind: "anonymous" };

export function authenticatedAccount(input: {
  readonly email: string;
  readonly tier: Tier;
}): AccountSession {
  return { kind: "authenticated", email: input.email, tier: input.tier };
}

export function effectiveTier(account: AccountSession): Tier {
  return account.kind === "authenticated" ? account.tier : "free";
}

export function signOutAccount(_account: AccountSession): AccountSession {
  return ANONYMOUS_ACCOUNT;
}
