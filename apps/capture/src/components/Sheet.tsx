import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, fonts, radii } from "../theme";

/**
 * The two modal shapes the design system uses, so every dialog in Capture is
 * dismissed, padded and coloured the same way.
 *
 * {@link Sheet} rises from the bottom edge and is for choosing — a list of
 * actions, a list of Ideas. {@link Dialog} sits centred and is for answering:
 * a field to fill in, a decision to confirm. Both close on a backdrop tap and
 * on the Android back gesture.
 */

export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={styles.backdrop}
        onPress={onClose}
      />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <View style={styles.sheetHeader}>
          <Text style={styles.title}>{title}</Text>
          {subtitle === undefined ? null : (
            <Text style={styles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          )}
        </View>
        {children}
      </View>
    </Modal>
  );
}

export function Dialog({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.dialogLayer}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** One choice in a {@link Sheet}: a label, optional detail, optional emphasis. */
export function SheetAction({
  label,
  detail,
  tone = "default",
  disabled = false,
  onPress,
}: {
  label: string;
  detail?: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        pressed && styles.actionPressed,
        disabled && styles.actionDisabled,
      ]}
    >
      <Text
        style={[styles.actionLabel, tone === "danger" && styles.actionLabelDanger]}
      >
        {label}
      </Text>
      {detail === undefined ? null : (
        <Text style={styles.actionDetail}>{detail}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  sheet: {
    marginTop: "auto",
    maxHeight: "88%",
    paddingTop: 10,
    paddingBottom: 34,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.borderStrong,
  },
  sheetHeader: {
    gap: 5,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 12,
  },
  dialogLayer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  dialog: {
    width: "100%",
    gap: 16,
    padding: 22,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 18,
    letterSpacing: -0.2,
    color: colors.text,
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textDim,
  },
  action: {
    gap: 3,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  actionPressed: {
    backgroundColor: colors.surfaceActive,
  },
  actionDisabled: {
    opacity: 0.45,
  },
  actionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    color: colors.text,
  },
  actionLabelDanger: {
    color: colors.danger,
  },
  actionDetail: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: colors.textFaint,
  },
});
