import type { Tier } from "@motif/shared";

const REGION = process.env.EXPO_PUBLIC_MOTIF_AWS_REGION ?? "eu-west-2";
const CLIENT_ID =
  process.env.EXPO_PUBLIC_MOTIF_USER_POOL_CLIENT_ID ??
  "158crbvjn6ss89plph8p8ivo96";
export const MOTIF_API_URL =
  process.env.EXPO_PUBLIC_MOTIF_API_URL ??
  "https://to8jymiybd.execute-api.eu-west-2.amazonaws.com";
const COGNITO_URL = `https://cognito-idp.${REGION}.amazonaws.com/`;

export interface AuthTokens {
  readonly idToken: string;
  readonly accessToken: string;
  readonly refreshToken?: string;
}

export interface AccountProfile {
  readonly email: string;
  readonly tier: Tier;
}

async function cognito<T>(target: string, body: unknown): Promise<T> {
  const response = await fetch(COGNITO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof result.message === "string"
        ? result.message
        : "The account service couldn't complete that request.",
    );
  }
  return result as T;
}

export async function signUp(email: string, password: string): Promise<void> {
  await cognito("SignUp", {
    ClientId: CLIENT_ID,
    Username: email.trim().toLowerCase(),
    Password: password,
    UserAttributes: [{ Name: "email", Value: email.trim().toLowerCase() }],
  });
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  await cognito("ConfirmSignUp", {
    ClientId: CLIENT_ID,
    Username: email.trim().toLowerCase(),
    ConfirmationCode: code.trim(),
  });
}

export async function signIn(email: string, password: string): Promise<AuthTokens> {
  const result = await cognito<{
    AuthenticationResult?: {
      IdToken?: string;
      AccessToken?: string;
      RefreshToken?: string;
    };
  }>("InitiateAuth", {
    ClientId: CLIENT_ID,
    AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: {
      USERNAME: email.trim().toLowerCase(),
      PASSWORD: password,
    },
  });
  const auth = result.AuthenticationResult;
  if (!auth?.IdToken || !auth.AccessToken) {
    throw new Error("Login did not return a usable session.");
  }
  return {
    idToken: auth.IdToken,
    accessToken: auth.AccessToken,
    refreshToken: auth.RefreshToken,
  };
}

async function accountApi<T>(
  path: string,
  idToken: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${MOTIF_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Your session has expired. Please log in again."
        : "The account service is unavailable.",
    );
  }
  return (await response.json()) as T;
}

export function loadAccount(idToken: string): Promise<AccountProfile> {
  return accountApi<AccountProfile>("/me", idToken);
}

export async function setAccountTier(
  idToken: string,
  tier: Tier,
): Promise<AccountProfile> {
  const result = await accountApi<{ tier: Tier }>("/me/tier", idToken, {
    method: "PUT",
    body: JSON.stringify({ tier }),
  });
  const profile = await loadAccount(idToken);
  return { ...profile, tier: result.tier };
}
