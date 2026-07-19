import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { AuthTokens } from "./account-client";

const SESSION_KEY = "motif.account-session.v1";

function webStorage(): Storage | null {
  return typeof globalThis.localStorage === "undefined"
    ? null
    : globalThis.localStorage;
}

export async function loadAuthTokens(): Promise<AuthTokens | null> {
  const value =
    Platform.OS === "web"
      ? webStorage()?.getItem(SESSION_KEY) ?? null
      : await SecureStore.getItemAsync(SESSION_KEY);
  if (!value) return null;
  try {
    return JSON.parse(value) as AuthTokens;
  } catch {
    await clearAuthTokens();
    return null;
  }
}

export async function saveAuthTokens(tokens: AuthTokens): Promise<void> {
  const value = JSON.stringify(tokens);
  if (Platform.OS === "web") {
    webStorage()?.setItem(SESSION_KEY, value);
  } else {
    await SecureStore.setItemAsync(SESSION_KEY, value);
  }
}

export async function clearAuthTokens(): Promise<void> {
  if (Platform.OS === "web") {
    webStorage()?.removeItem(SESSION_KEY);
  } else {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  }
}
