import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { isValidPairingCode } from "@motif/shared";
import { startBridgeDiscovery } from "../bridge-discovery";
import type { DiscoveredBridge, StopBridgeDiscovery } from "../bridge-discovery";
import { colors, fonts, radii } from "../theme";
import { Dialog } from "./Sheet";

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
    <Dialog visible={visible} title="Pair with Bridge" onClose={onCancel}>
      {bridge ? (
        <Text style={styles.hint}>
          Found {bridge.name}. Enter the pairing code shown on Bridge.
        </Text>
      ) : discoveryFailed ? (
        <Text style={styles.hint}>
          Couldn't search for Bridge. Check local-network permission, then reopen
          this dialog.
        </Text>
      ) : (
        <View style={styles.discoveryStatus}>
          <ActivityIndicator color={colors.textDim} size="small" />
          <Text style={styles.hint}>Looking for Bridge on your local network…</Text>
        </View>
      )}

      <View style={styles.field}>
        <Text style={styles.label}>Pairing code</Text>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          autoFocus
          keyboardType="number-pad"
          placeholder="000000"
          placeholderTextColor={colors.textFaint}
          returnKeyType="done"
          onSubmitEditing={submit}
        />
      </View>

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.action}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={submit}
          disabled={!canSubmit}
          style={[styles.action, canSubmit ? styles.pair : styles.pairDisabled]}
        >
          <Text style={[styles.pairLabel, !canSubmit && styles.pairLabelDisabled]}>
            Pair
          </Text>
        </Pressable>
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textDim,
  },
  discoveryStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  field: {
    gap: 8,
  },
  label: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    letterSpacing: 1.5,
    color: colors.textFaint,
  },
  input: {
    fontFamily: fonts.mono,
    fontSize: 20,
    letterSpacing: 4,
    color: colors.text,
    backgroundColor: colors.canvas,
    borderRadius: radii.field,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    fontVariant: ["tabular-nums"],
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  action: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
  },
  pair: {
    backgroundColor: colors.text,
  },
  pairDisabled: {
    backgroundColor: colors.surfaceActive,
  },
  cancelLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    color: colors.textDim,
  },
  pairLabel: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
    color: colors.canvas,
  },
  pairLabelDisabled: {
    color: colors.textFaint,
  },
});
