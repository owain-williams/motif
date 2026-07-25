import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { formatDuration } from "@motif/shared";
import type { RecordingChannelCount } from "@motif/shared";
import type { SyncSummary } from "../core/sync-summary";
import { formatCapturedAt } from "../core/capture-time";
import { colors, fonts, radii, SCREEN_TOP_INSET } from "../theme";
import { BackIcon, DesktopIcon } from "./Icon";

/**
 * Sync — where an Idea goes after it is captured, and the only screen that
 * admits Motif has settings. It answers three questions in order: which Bridge
 * this Capture is paired with, how much has reached it, and what is still
 * queued. Account, recording format and location tagging sit below that,
 * deliberately after the answer rather than in front of it.
 */

/** How the paired device is currently reachable. */
export interface SyncStatus {
  readonly label: string;
  readonly tone: "live" | "idle" | "warn";
}

export function SyncScreen({
  bridgeName,
  bridgeDetail,
  status,
  statusLine,
  summary,
  syncing,
  paired,
  canSync,
  now,
  accountLabel,
  recordingFormat,
  channelChoices,
  channels,
  locationTaggingEnabled,
  onBack,
  onSyncNow,
  onPair,
  onUnpair,
  onOpenAccount,
  onSelectChannels,
  onToggleLocationTagging,
}: {
  bridgeName: string | null;
  bridgeDetail: string;
  status: SyncStatus;
  /** What the last pass reported, or `null` if none has run. */
  statusLine: string | null;
  summary: SyncSummary;
  syncing: boolean;
  paired: boolean;
  /** Whether any transport is open — LAN pairing or a paid cloud relay. */
  canSync: boolean;
  now: number;
  accountLabel: string;
  recordingFormat: string;
  channelChoices: readonly RecordingChannelCount[];
  channels: RecordingChannelCount;
  locationTaggingEnabled: boolean;
  onBack: () => void;
  onSyncNow: () => void;
  onPair: () => void;
  onUnpair: () => void;
  onOpenAccount: () => void;
  onSelectChannels: (channels: RecordingChannelCount) => void;
  onToggleLocationTagging: (enabled: boolean) => void;
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <BackIcon />
        </Pressable>
        <Text style={styles.headerTitle}>Sync</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <View style={styles.device}>
            <View style={styles.deviceIcon}>
              <DesktopIcon />
            </View>
            <View style={styles.deviceName}>
              <Text style={styles.deviceTitle} numberOfLines={1}>
                {bridgeName ?? "No Bridge paired"}
              </Text>
              <Text style={styles.deviceDetail} numberOfLines={1}>
                {bridgeDetail}
              </Text>
            </View>
            <View style={[styles.statusPill, statusPillStyle(status.tone)]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor(status.tone) }]} />
              <Text style={[styles.statusLabel, { color: statusColor(status.tone) }]}>
                {status.label}
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.stats}>
            <Stat value={String(summary.ideaCount)} label="ideas" />
            <Stat value={formatDuration(summary.totalDurationMs)} label="recorded" />
            <Stat
              value={String(summary.queuedCount)}
              label="queued"
              highlight={summary.queuedCount > 0}
            />
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: syncing }}
          disabled={syncing}
          onPress={paired || canSync ? onSyncNow : onPair}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        >
          <Text style={styles.primaryLabel}>
            {!paired && !canSync
              ? "Pair with Bridge"
              : syncing
                ? "Sending…"
                : summary.queuedCount > 0
                  ? `Send ${summary.queuedCount} now`
                  : "Everything is up to date"}
          </Text>
        </Pressable>

        {statusLine === null ? null : (
          <Text style={styles.statusLine} numberOfLines={2}>
            {statusLine}
          </Text>
        )}

        {summary.activity.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.eyebrow}>ACTIVITY</Text>
            {summary.activity.map((entry) => (
              <View key={entry.id} style={styles.activity}>
                <View
                  style={[
                    styles.activityDot,
                    {
                      backgroundColor: entry.queued
                        ? colors.relay
                        : colors.borderStrong,
                    },
                  ]}
                />
                <Text style={styles.activityTitle} numberOfLines={1}>
                  {entry.name}
                </Text>
                <Text style={styles.activityWhen}>
                  {entry.queued ? "queued" : formatCapturedAt(entry.capturedAt, now)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.eyebrow}>THIS DEVICE</Text>

          <SettingRow
            label="Account"
            value={accountLabel}
            action="Manage"
            onPress={onOpenAccount}
          />

          <View style={styles.setting}>
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>Recording</Text>
              <Text style={styles.settingValue} numberOfLines={1}>
                {recordingFormat}
              </Text>
            </View>
            {channelChoices.length > 1 ? (
              <View style={styles.segmented}>
                {channelChoices.map((choice) => (
                  <Pressable
                    key={choice}
                    accessibilityRole="button"
                    accessibilityLabel={choice === 1 ? "Record in mono" : "Record in stereo"}
                    accessibilityState={{ selected: choice === channels }}
                    onPress={() => onSelectChannels(choice)}
                    style={[
                      styles.segment,
                      choice === channels && styles.segmentActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.segmentLabel,
                        choice === channels && styles.segmentLabelActive,
                      ]}
                    >
                      {choice === 1 ? "Mono" : "Stereo"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>

          <View style={styles.setting}>
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>Location tagging</Text>
              <Text style={styles.settingValue} numberOfLines={2}>
                {locationTaggingEnabled
                  ? "New recordings are tagged with where you made them"
                  : "Off — recordings are never location-tagged"}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Location tagging"
              value={locationTaggingEnabled}
              onValueChange={onToggleLocationTagging}
              trackColor={{ false: colors.border, true: colors.signal }}
              thumbColor={colors.text}
            />
          </View>

          {paired ? (
            <SettingRow
              label="Paired Bridge"
              value={bridgeName ?? ""}
              action="Unpair"
              destructive
              onPress={onUnpair}
            />
          ) : (
            <SettingRow
              label="Bridge"
              value="Not paired with a desktop"
              action="Pair"
              onPress={onPair}
            />
          )}
        </View>

        <Text style={styles.footnote}>
          Motif sends Ideas to Bridge over your local network whenever both apps
          are awake. Basic and Pro accounts also relay through your account, so
          an Idea captured away from home is waiting on the desktop when you get
          back.
        </Text>
      </ScrollView>
    </View>
  );
}

function Stat({
  value,
  label,
  highlight = false,
}: {
  value: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, highlight && styles.statValueHighlight]}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SettingRow({
  label,
  value,
  action,
  destructive = false,
  onPress,
}: {
  label: string;
  value: string;
  action: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.setting}>
      <View style={styles.settingText}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${action} ${label.toLowerCase()}`}
        onPress={onPress}
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
      >
        <Text
          style={[styles.secondaryLabel, destructive && styles.secondaryLabelDanger]}
        >
          {action}
        </Text>
      </Pressable>
    </View>
  );
}

function statusColor(tone: SyncStatus["tone"]): string {
  if (tone === "live") return colors.relay;
  return tone === "warn" ? colors.signal : colors.textDim;
}

function statusPillStyle(tone: SyncStatus["tone"]) {
  return {
    backgroundColor:
      tone === "live"
        ? colors.relaySoft
        : tone === "warn"
          ? colors.signalSoft
          : colors.surfaceActive,
  };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: SCREEN_TOP_INSET,
    backgroundColor: colors.canvas,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
    color: colors.text,
  },
  pressed: {
    opacity: 0.6,
  },
  content: {
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 56,
  },
  card: {
    gap: 20,
    padding: 22,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  device: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  deviceIcon: {
    width: 52,
    height: 52,
    borderRadius: radii.field,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceActive,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  deviceName: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  deviceTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    color: colors.text,
  },
  deviceDetail: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textDim,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
  },
  statusLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
  },
  stats: {
    flexDirection: "row",
    gap: 12,
  },
  stat: {
    flex: 1,
    gap: 5,
  },
  statValue: {
    fontFamily: fonts.mono,
    fontSize: 19,
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  statValueHighlight: {
    color: colors.relay,
  },
  statLabel: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.textDim,
  },
  primary: {
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    backgroundColor: colors.surfaceActive,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  primaryLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    color: colors.text,
  },
  statusLine: {
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 17,
    color: colors.textFaint,
    textAlign: "center",
  },
  section: {
    marginTop: 12,
  },
  eyebrow: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    letterSpacing: 1.7,
    color: colors.textFaint,
    paddingBottom: 10,
    paddingHorizontal: 2,
  },
  activity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  activityDot: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
  },
  activityTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.textSecondary,
  },
  activityWhen: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    color: colors.textFaint,
  },
  setting: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  settingText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  settingLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.text,
  },
  settingValue: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textDim,
  },
  secondary: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceActive,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.text,
  },
  secondaryLabelDanger: {
    color: colors.danger,
  },
  segmented: {
    flexDirection: "row",
    gap: 2,
    padding: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
  },
  segmentActive: {
    backgroundColor: colors.border,
  },
  segmentLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    color: colors.textDim,
  },
  segmentLabelActive: {
    color: colors.text,
  },
  footnote: {
    marginTop: 18,
    paddingHorizontal: 2,
    fontFamily: fonts.sans,
    fontSize: 12.5,
    lineHeight: 20,
    color: colors.textFaint,
  },
});
