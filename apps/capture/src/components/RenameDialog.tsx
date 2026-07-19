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

/**
 * A small cross-platform rename prompt. `Alert.prompt` is iOS-only, so the
 * Library uses this Modal + TextInput instead. Validation (trimming, rejecting
 * blank names) is the parent's job via `normalizeIdeaName`.
 */
export function RenameDialog({
  visible,
  initialName,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  initialName: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState(initialName);

  // Re-seed the field each time the dialog opens for a different Idea.
  useEffect(() => {
    if (visible) setValue(initialName);
  }, [visible, initialName]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Rename idea</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            autoFocus
            selectTextOnFocus
            placeholder="Idea name"
            placeholderTextColor="#5a5a62"
            returnKeyType="done"
            onSubmitEditing={() => onSubmit(value)}
          />
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              style={styles.action}
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => onSubmit(value)}
              style={styles.action}
            >
              <Text style={styles.saveLabel}>Save</Text>
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
    marginBottom: 14,
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
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 18,
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
  saveLabel: {
    color: "#e5484d",
    fontSize: 15,
    fontWeight: "700",
  },
});
