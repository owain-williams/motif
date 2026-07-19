import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Tier } from "@motif/shared";
import type { AccountSession } from "../core/account-session";

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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Account</Text>
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
                    <Text style={styles.buttonText}>{titleCase(tier)}</Text>
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
                placeholderTextColor="#676771"
                value={email}
                onChangeText={setEmail}
                style={styles.input}
              />
              {mode === "confirm" ? (
                <TextInput
                  autoCapitalize="none"
                  keyboardType="number-pad"
                  placeholder="Confirmation code"
                  placeholderTextColor="#676771"
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
                placeholderTextColor="#676771"
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
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>
                    {mode === "login" ? "Log in" : mode === "signup" ? "Create account" : "Confirm"}
                  </Text>
                )}
              </Pressable>
            </>
          )}
          <Pressable disabled={busy} onPress={onClose} style={styles.cancel}>
            <Text style={styles.secondaryText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function titleCase(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.72)" },
  card: { backgroundColor: "#1a1a20", borderRadius: 16, padding: 20, gap: 12 },
  title: { color: "#f5f5f7", fontSize: 20, fontWeight: "700" },
  email: { color: "#b8b8c0", fontSize: 15 },
  label: { color: "#8a8a92", fontSize: 12, textTransform: "uppercase" },
  tabs: { flexDirection: "row", gap: 20, marginBottom: 4 },
  tab: { color: "#777780", fontSize: 15, fontWeight: "600" },
  tabActive: { color: "#f5f5f7", fontSize: 15, fontWeight: "700" },
  input: { color: "#f5f5f7", backgroundColor: "#101014", borderRadius: 9, padding: 12, fontSize: 16 },
  tiers: { flexDirection: "row", gap: 8 },
  tierButton: { flex: 1, alignItems: "center", padding: 10, backgroundColor: "#292932", borderRadius: 8 },
  tierButtonActive: { backgroundColor: "#9d3035" },
  primary: { minHeight: 44, justifyContent: "center", alignItems: "center", backgroundColor: "#e5484d", borderRadius: 9 },
  secondary: { alignItems: "center", padding: 10, backgroundColor: "#292932", borderRadius: 9 },
  cancel: { alignItems: "center", paddingTop: 4 },
  buttonText: { color: "#fff", fontWeight: "700" },
  secondaryText: { color: "#b8b8c0", fontWeight: "600" },
  note: { color: "#777780", fontSize: 12 },
  error: { color: "#ff8f92", fontSize: 13 },
});
