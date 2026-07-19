import { useEffect, useState } from "react";
import {
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

/**
 * Pair-with-Bridge prompt (motif-6fu.6). The user reads Bridge's address and
 * pairing code off its window and enters them here; the parent performs the
 * pairing handshake. Zero-config discovery (mDNS) that would fill the address
 * in automatically is a later refinement — for now pairing is by address.
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
  const [host, setHost] = useState("");
  const [port, setPort] = useState("47600");
  const [code, setCode] = useState("");

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (visible) {
      setHost("");
      setPort("47600");
      setCode("");
    }
  }, [visible]);

  const canSubmit =
    host.trim().length > 0 &&
    /^\d+$/.test(port.trim()) &&
    isValidPairingCode(code.trim());

  function submit() {
    if (canSubmit) {
      onSubmit({ host: host.trim(), port: port.trim(), code: code.trim() });
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
          <Text style={styles.hint}>
            Open Bridge on your computer and enter its address and code.
          </Text>

          <Text style={styles.label}>Address</Text>
          <TextInput
            style={styles.input}
            value={host}
            onChangeText={setHost}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            placeholder="192.168.1.20"
            placeholderTextColor="#5a5a62"
          />

          <Text style={styles.label}>Port</Text>
          <TextInput
            style={styles.input}
            value={port}
            onChangeText={setPort}
            keyboardType="number-pad"
            placeholder="47600"
            placeholderTextColor="#5a5a62"
          />

          <Text style={styles.label}>Pairing code</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
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
