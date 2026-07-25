import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Tier } from "@motif/shared";
import type { AccountSession } from "../core/account-session";
import { colors, fonts, radii } from "../theme";
import { Dialog } from "./Sheet";

type Mode = "login" | "signup" | "confirm";

interface AccountDialogProps {
  readonly visible: boolean;
  readonly account: AccountSession;
  readonly onClose: () => void;
  readonly onLogin: (email: string, password: string) => Promise<void>;
  readonly onSignUp: (email: string, password: string) => Promise<void>;
  readonly onConfirm: (
    email: string,
    code: string,
    password: string,
  ) => Promise<void>;
  readonly onSetTier: (tier: Tier) => Promise<void>;
  readonly onLogout: () => Promise<void>;
}

export function AccountDialog({
  visible,
  account,
  onClose,
  onLogin,
  onSignUp,
  onConfirm,
  onSetTier,
  onLogout,
}: AccountDialogProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setError(null);
  }, [visible]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (mode === "login") {
      await run(() => onLogin(email, password));
    } else if (mode === "signup") {
      await run(async () => {
        await onSignUp(email, password);
        setMode("confirm");
      });
    } else if (!code.trim()) {
      setError("Enter the confirmation code from your email.");
    } else {
      await run(() => onConfirm(email, code, password));
    }
  }

  return (
    <Dialog visible={visible} title="Account" onClose={onClose}>
      {account.kind === "authenticated" ? (
        <>
          <Text style={styles.email}>{account.email}</Text>
          <Text style={styles.label}>Tier (debug)</Text>
          <View style={styles.tiers}>
            {(["free", "basic", "pro"] as const).map((tier) => (
              <Pressable
                key={tier}
                disabled={busy}
                onPress={() => run(() => onSetTier(tier))}
                style={[
                  styles.tierButton,
                  account.tier === tier && styles.tierButtonActive,
                ]}
              >
                <Text style={styles.tierLabel}>{titleCase(tier)}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.note}>
            Temporary tier control pending billing integration.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable disabled={busy} onPress={() => run(onLogout)} style={styles.secondary}>
            <Text style={styles.secondaryText}>Log out</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={styles.tabs}>
            <Pressable onPress={() => setMode("login")}>
              <Text style={mode === "login" ? styles.tabActive : styles.tab}>Log in</Text>
            </Pressable>
            <Pressable onPress={() => setMode("signup")}>
              <Text style={mode !== "login" ? styles.tabActive : styles.tab}>Create account</Text>
            </Pressable>
          </View>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor={colors.textFaint}
            value={email}
            onChangeText={setEmail}
            style={styles.input}
          />
          {mode === "confirm" ? (
            <TextInput
              autoCapitalize="none"
              keyboardType="number-pad"
              placeholder="Confirmation code"
              placeholderTextColor={colors.textFaint}
              value={code}
              onChangeText={setCode}
              style={styles.input}
            />
          ) : null}
          <TextInput
            autoCapitalize="none"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            secureTextEntry
            placeholder="Password"
            placeholderTextColor={colors.textFaint}
            value={password}
            onChangeText={setPassword}
            style={styles.input}
          />
          {mode === "confirm" ? (
            <Text style={styles.note}>Enter the code sent to {email}.</Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable disabled={busy} onPress={submit} style={styles.primary}>
            {busy ? (
              <ActivityIndicator color={colors.canvas} />
            ) : (
              <Text style={styles.primaryText}>
                {mode === "login" ? "Log in" : mode === "signup" ? "Create account" : "Confirm"}
              </Text>
            )}
          </Pressable>
        </>
      )}
      <Pressable disabled={busy} onPress={onClose} style={styles.cancel}>
        <Text style={styles.secondaryText}>Close</Text>
      </Pressable>
    </Dialog>
  );
}

function titleCase(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  email: { fontFamily: fonts.sans, fontSize: 15, color: colors.textSecondary },
  label: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    letterSpacing: 1.5,
    color: colors.textFaint,
  },
  tabs: { flexDirection: "row", gap: 20 },
  tab: { fontFamily: fonts.sansMedium, fontSize: 15, color: colors.textFaint },
  tabActive: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.text },
  input: {
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.canvas,
    borderRadius: radii.field,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tiers: { flexDirection: "row", gap: 8 },
  tierButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: radii.field,
    backgroundColor: colors.surfaceActive,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tierButtonActive: { backgroundColor: colors.signalSoft, borderColor: colors.signal },
  tierLabel: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.text },
  primary: {
    minHeight: 50,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: radii.control,
    backgroundColor: colors.text,
  },
  primaryText: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.canvas },
  secondary: {
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: radii.control,
    backgroundColor: colors.surfaceActive,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancel: { alignItems: "center", paddingTop: 2 },
  secondaryText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.textDim },
  note: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: colors.textFaint },
  error: { fontFamily: fonts.sans, fontSize: 13, color: colors.signal },
});
