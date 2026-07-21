import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  formatDuration,
  formatRestoreWindow,
  RECENTLY_DELETED_RETENTION_DAYS,
} from "@motif/shared";
import type { IdeaMetadata, RecentlyDeletedIdea } from "@motif/shared";

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
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Recently Deleted</Text>
          <Text style={styles.subtitle}>
            {`Deleted ideas stay here for ${RECENTLY_DELETED_RETENTION_DAYS} days before they go for good.`}
          </Text>
          {ideas.length === 0 ? (
            <Text style={styles.empty}>Nothing here.</Text>
          ) : (
            <FlatList
              data={ideas}
              keyExtractor={(entry) => entry.idea.id}
              contentContainerStyle={styles.listContent}
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
                    style={styles.restore}
                  >
                    <Text style={styles.restoreLabel}>Restore</Text>
                  </Pressable>
                </View>
              )}
            />
          )}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={styles.action}
            >
              <Text style={styles.doneLabel}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
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
    maxHeight: "70%",
    backgroundColor: "#17171d",
    borderRadius: 16,
    padding: 20,
  },
  title: {
    color: "#f5f5f7",
    fontSize: 16,
    fontWeight: "600",
  },
  subtitle: {
    color: "#8a8a92",
    fontSize: 13,
    marginTop: 6,
    marginBottom: 14,
  },
  empty: {
    color: "#686872",
    fontSize: 14,
    paddingVertical: 18,
    textAlign: "center",
  },
  listContent: {
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#0b0b0f",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  rowInfo: {
    flex: 1,
  },
  rowName: {
    color: "#f5f5f7",
    fontSize: 15,
    fontWeight: "500",
  },
  rowMeta: {
    color: "#8a8a92",
    fontSize: 12,
    marginTop: 3,
  },
  restore: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#22222a",
  },
  restoreLabel: {
    color: "#f5f5f7",
    fontSize: 13,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 16,
  },
  action: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  doneLabel: {
    color: "#8a8a92",
    fontSize: 15,
    fontWeight: "500",
  },
});
