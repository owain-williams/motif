import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import {
  formatDuration,
  formatRestoreWindow,
  RECENTLY_DELETED_RETENTION_DAYS,
} from "@motif/shared";
import type { IdeaMetadata, RecentlyDeletedIdea } from "@motif/shared";
import { colors, fonts, radii } from "../theme";
import { Sheet } from "./Sheet";

/**
 * Recently Deleted: the Ideas this device has deleted but still holds, each
 * restorable until its 30-day window runs out (CONTEXT.md, ADR 0005). Purely
 * presentational — the deletion records, the restore, and the clock are the
 * parent's (App) job, so `now` is passed in rather than read here.
 */
export function RecentlyDeletedDialog({
  visible,
  ideas,
  now,
  onRestore,
  onClose,
}: {
  visible: boolean;
  ideas: readonly RecentlyDeletedIdea<IdeaMetadata>[];
  now: number;
  onRestore: (idea: IdeaMetadata) => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      title="Recently Deleted"
      subtitle={`Deleted ideas stay here for ${RECENTLY_DELETED_RETENTION_DAYS} days before they go for good.`}
      onClose={onClose}
    >
      {ideas.length === 0 ? (
        <Text style={styles.empty}>Nothing here.</Text>
      ) : (
        <FlatList
          data={ideas}
          keyExtractor={(entry) => entry.idea.id}
          style={styles.list}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowInfo}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.idea.name}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {formatDuration(item.idea.durationMs)}
                  {" · "}
                  {formatRestoreWindow(item.purgeAt, now)}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Restore ${item.idea.name}`}
                onPress={() => onRestore(item.idea)}
                style={({ pressed }) => [styles.restore, pressed && styles.pressed]}
              >
                <Text style={styles.restoreLabel}>Restore</Text>
              </Pressable>
            </View>
          )}
        />
      )}
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        style={({ pressed }) => [styles.done, pressed && styles.pressed]}
      >
        <Text style={styles.doneLabel}>Done</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  empty: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.textFaint,
    paddingVertical: 24,
    textAlign: "center",
  },
  list: {
    maxHeight: 360,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  rowName: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    color: colors.text,
  },
  rowMeta: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textDim,
  },
  restore: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceActive,
    borderWidth: 1,
    borderColor: colors.border,
  },
  restoreLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.text,
  },
  pressed: {
    opacity: 0.6,
  },
  done: {
    alignSelf: "center",
    marginTop: 18,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  doneLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    color: colors.textDim,
  },
});
