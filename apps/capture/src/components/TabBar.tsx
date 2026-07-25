import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, TAB_BAR_HEIGHT } from "../theme";
import { LibraryIcon, RecordIcon } from "./Icon";

/**
 * The whole app, in two tabs: the thing that captures Ideas and the place they
 * land. Anything else (sync, account, settings) is reached from within those
 * two rather than competing with them for a slot.
 */

export type CaptureTab = "record" | "library";

export function TabBar({
  active,
  disabled,
  onSelect,
}: {
  active: CaptureTab;
  /** Set while recording — leaving mid-capture would drop the Idea. */
  disabled: boolean;
  onSelect: (tab: CaptureTab) => void;
}) {
  return (
    <View style={styles.bar}>
      <Tab
        label="Record"
        active={active === "record"}
        disabled={disabled}
        onPress={() => onSelect("record")}
        icon={
          <RecordIcon
            color={active === "record" ? colors.text : colors.textInactive}
          />
        }
      />
      <Tab
        label="Library"
        active={active === "library"}
        disabled={disabled}
        onPress={() => onSelect("library")}
        icon={
          <LibraryIcon
            color={active === "library" ? colors.text : colors.textInactive}
          />
        }
      />
    </View>
  );
}

function Tab({
  label,
  icon,
  active,
  disabled,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
    >
      {icon}
      <Text style={[styles.label, active ? styles.labelActive : styles.labelIdle]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: TAB_BAR_HEIGHT,
    flexDirection: "row",
    gap: 4,
    paddingTop: 10,
    paddingBottom: 30,
    paddingHorizontal: 24,
    backgroundColor: colors.canvas,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    gap: 5,
    paddingVertical: 8,
  },
  tabPressed: {
    opacity: 0.6,
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 10.5,
    letterSpacing: 0.4,
  },
  labelActive: {
    color: colors.text,
  },
  labelIdle: {
    color: colors.textInactive,
  },
});
