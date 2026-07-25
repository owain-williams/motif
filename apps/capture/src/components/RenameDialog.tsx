import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, fonts, radii } from "../theme";
import { Dialog } from "./Sheet";

/**
 * A small cross-platform rename prompt. `Alert.prompt` is iOS-only, so the
 * Library uses this dialog instead. Validation (trimming, rejecting blank
 * names) is the parent's job via `normalizeIdeaName`.
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
    <Dialog visible={visible} title="Rename idea" onClose={onCancel}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        autoFocus
        selectTextOnFocus
        placeholder="Idea name"
        placeholderTextColor={colors.textFaint}
        returnKeyType="done"
        onSubmitEditing={() => onSubmit(value)}
      />
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.action}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onSubmit(value)}
          style={[styles.action, styles.save]}
        >
          <Text style={styles.saveLabel}>Save</Text>
        </Pressable>
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
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
  save: {
    backgroundColor: colors.text,
  },
  cancelLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    color: colors.textDim,
  },
  saveLabel: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
    color: colors.canvas,
  },
});
