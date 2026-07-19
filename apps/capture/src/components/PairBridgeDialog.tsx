import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { isValidPairingCode } from "@motif/shared";
import { startBridgeDiscovery } from "../bridge-discovery";
import type { DiscoveredBridge, StopBridgeDiscovery } from "../bridge-discovery";

/**
 * Pair-with-Bridge prompt. Bonjour supplies the endpoint automatically; the
 * pairing code remains the user-confirmed proof that these are their devices.
 */
export interface PairBridgeInput {
  readonly host: string;
  readonly port: string;
  readonly code: string;
}

export function PairBridgeDialog({
  visible,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (input: PairBridgeInput) => void;
}) {
  const [bridge, setBridge] = useState<DiscoveredBridge | null>(null);
  const [discoveryFailed, setDiscoveryFailed] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!visible) return;

    let active = true;
    let stop: StopBridgeDiscovery | null = null;
    setBridge(null);
    setDiscoveryFailed(false);
    setCode("");

    void startBridgeDiscovery((found) => {
      if (active) setBridge((current) => current ?? found);
    })
      .then((cleanup) => {
        if (active) stop = cleanup;
        else cleanup();
      })
      .catch(() => {
        if (active) setDiscoveryFailed(true);
      });

    return () => {
      active = false;
      stop?.();
    };
  }, [visible]);

  const canSubmit = bridge !== null && isValidPairingCode(code.trim());

  function submit() {
    if (canSubmit && bridge) {
      onSubmit({ host: bridge.host, port: String(bridge.port), code: code.trim() });
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Pair with Bridge</Text>
          {bridge ? (
            <Text style={styles.hint}>
              Found {bridge.name}. Enter the pairing code shown on Bridge.
            </Text>
          ) : discoveryFailed ? (
            <Text style={styles.hint}>
              Couldn't search for Bridge. Check local-network permission, then reopen this
              dialog.
            </Text>
          ) : (
            <View style={styles.discoveryStatus}>
              <ActivityIndicator color="#8a8a92" size="small" />
              <Text style={styles.hint}>Looking for Bridge on your local network…</Text>
            </View>
          )}

          <Text style={styles.label}>Pairing code</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            autoFocus
            keyboardType="number-pad"
            placeholder="000000"
            placeholderTextColor="#5a5a62"
            returnKeyType="done"
            onSubmitEditing={submit}
          />

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onCancel} style={styles.action}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={submit}
              disabled={!canSubmit}
              style={styles.action}
            >
              <Text style={[styles.pairLabel, !canSubmit && styles.pairLabelDisabled]}>
                Pair
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  card: {
    width: "100%",
    backgroundColor: "#17171d",
    borderRadius: 16,
    padding: 20,
  },
  title: {
    color: "#f5f5f7",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 6,
  },
  hint: {
    color: "#8a8a92",
    fontSize: 13,
    marginBottom: 14,
  },
  discoveryStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  label: {
    color: "#8a8a92",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    color: "#f5f5f7",
    fontSize: 16,
    backgroundColor: "#0b0b0f",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2a2a32",
    fontVariant: ["tabular-nums"],
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 20,
    gap: 8,
  },
  action: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  cancelLabel: {
    color: "#8a8a92",
    fontSize: 15,
    fontWeight: "500",
  },
  pairLabel: {
    color: "#e5484d",
    fontSize: 15,
    fontWeight: "700",
  },
  pairLabelDisabled: {
    color: "#5a5a62",
  },
});
