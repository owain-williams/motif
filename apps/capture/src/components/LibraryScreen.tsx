import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { IdeaMetadata } from "@motif/shared";
import type { LibraryChip, LibraryEmptyState } from "../core/library-filter";
import { colors, fonts, radii, SCREEN_TOP_INSET, TAB_BAR_HEIGHT } from "../theme";
import { CloseIcon, SearchIcon } from "./Icon";
import { LibraryRow } from "./LibraryRow";

/**
 * The Library: one flat, reverse-chronological list with a search field and the
 * Library's own Tags as filter chips (CONTEXT.md — no folders, no grouping).
 *
 * Purely presentational. Which Ideas match, and what an empty result should
 * say, are decided in `src/core/library-filter`.
 */

export function LibraryScreen({
  ideas,
  totalCount,
  chips,
  activeChip,
  query,
  loading,
  playingId,
  progress,
  waveforms,
  queuedIds,
  now,
  disabled,
  deletedCount,
  emptyState,
  onQueryChange,
  onSelectChip,
  onPlayToggle,
  onOpenActions,
  onOpenRecentlyDeleted,
  onEmptyAction,
}: {
  ideas: readonly IdeaMetadata[];
  /** Ideas in the whole active Library, for the "shown / held" count. */
  totalCount: number;
  chips: readonly LibraryChip[];
  activeChip: string;
  query: string;
  loading: boolean;
  playingId: string | null;
  progress: number;
  waveforms: Record<string, readonly number[]>;
  queuedIds: ReadonlySet<string>;
  now: number;
  disabled: boolean;
  deletedCount: number;
  emptyState: LibraryEmptyState;
  onQueryChange: (query: string) => void;
  onSelectChip: (chip: string) => void;
  onPlayToggle: (idea: IdeaMetadata) => void;
  onOpenActions: (idea: IdeaMetadata) => void;
  onOpenRecentlyDeleted: () => void;
  onEmptyAction: () => void;
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Library</Text>
          <Text style={styles.count}>
            {ideas.length === totalCount
              ? `${totalCount}`
              : `${ideas.length} / ${totalCount}`}
          </Text>
        </View>

        <View style={styles.search}>
          <SearchIcon />
          <TextInput
            accessibilityLabel="Search Library"
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search names, tags, tempo, places"
            placeholderTextColor={colors.textFaint}
            returnKeyType="search"
            autoCorrect={false}
            style={styles.searchInput}
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => onQueryChange("")}
              hitSlop={10}
            >
              <CloseIcon />
            </Pressable>
          ) : null}
        </View>

        {chips.length > 1 ? (
          <FlatList
            horizontal
            data={chips}
            keyExtractor={(chip) => chip.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Filter by ${item.label}`}
                accessibilityState={{ selected: item.id === activeChip }}
                onPress={() => onSelectChip(item.id)}
                style={[
                  styles.chip,
                  item.id === activeChip ? styles.chipActive : styles.chipIdle,
                ]}
              >
                <Text
                  style={[
                    styles.chipLabel,
                    item.id === activeChip
                      ? styles.chipLabelActive
                      : styles.chipLabelIdle,
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            )}
          />
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.textDim} style={styles.loading} />
      ) : (
        <FlatList
          data={ideas}
          keyExtractor={(idea) => idea.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <LibraryRow
              idea={item}
              isPlaying={playingId === item.id}
              progress={progress}
              queued={queuedIds.has(item.id)}
              waveformPeaks={waveforms[item.id]}
              now={now}
              disabled={disabled}
              onPlayToggle={() => onPlayToggle(item)}
              onOpenActions={() => onOpenActions(item)}
            />
          )}
          ListEmptyComponent={
            <Empty state={emptyState} onPress={onEmptyAction} />
          }
          ListFooterComponent={
            deletedCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Recently Deleted, ${deletedCount} ideas`}
                onPress={onOpenRecentlyDeleted}
                style={({ pressed }) => [styles.deleted, pressed && styles.pressed]}
              >
                <Text style={styles.deletedLabel}>
                  {`Recently Deleted · ${deletedCount}`}
                </Text>
              </Pressable>
            ) : null
          }
        />
      )}
    </View>
  );
}

function Empty({
  state,
  onPress,
}: {
  state: LibraryEmptyState;
  onPress: () => void;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyMark} accessibilityElementsHidden>
        {[8, 18, 11, 24, 7].map((height, bar) => (
          <View key={bar} style={[styles.emptyBar, { height }]} />
        ))}
      </View>
      <Text style={styles.emptyTitle}>{state.title}</Text>
      <Text style={styles.emptyBody}>{state.body}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.emptyCta, pressed && styles.pressed]}
      >
        <Text style={styles.emptyCtaLabel}>{state.cta}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: SCREEN_TOP_INSET,
    backgroundColor: colors.canvas,
  },
  header: {
    gap: 14,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  title: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 26,
    letterSpacing: -0.5,
    color: colors.text,
  },
  count: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    letterSpacing: 0.6,
    color: colors.textFaint,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: radii.field,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.text,
  },
  chips: {
    gap: 7,
    paddingRight: 20,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  chipIdle: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  chipLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
  },
  chipLabelActive: {
    color: colors.canvas,
  },
  chipLabelIdle: {
    color: colors.textMuted,
  },
  loading: {
    marginTop: 40,
  },
  list: {
    paddingBottom: TAB_BAR_HEIGHT + 28,
    flexGrow: 1,
  },
  pressed: {
    opacity: 0.6,
  },
  empty: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 72,
    paddingHorizontal: 40,
  },
  emptyMark: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 28,
    opacity: 0.5,
  },
  emptyBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
  },
  emptyTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    color: colors.text,
  },
  emptyBody: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textDim,
    textAlign: "center",
    maxWidth: 280,
  },
  emptyCta: {
    marginTop: 6,
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 11,
    backgroundColor: colors.surfaceActive,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  emptyCtaLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.text,
  },
  deleted: {
    alignSelf: "center",
    marginTop: 22,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  deletedLabel: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.6,
    color: colors.textFaint,
  },
});
