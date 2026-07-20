import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  formatCoordinates,
  normalizeMultiValue,
  normalizeTempo,
} from "@motif/shared";
import type {
  IdeaLocation,
  IdeaMetadata,
  IdeaMetadataEdit,
} from "@motif/shared";

/**
 * Edits an Idea's searchable metadata — tags, instrument, style, tempo, and
 * location. Tags/instrument/style are the same zero-or-many free-text shape
 * (CONTEXT.md), each entered as removable chips with autocomplete drawn from the
 * distinct values already used across the Library (`suggestions`). Location is
 * captured on the device (opt-in, motif-kka.3); here its place label is editable
 * and the whole location tag removable. All the merge/stamp logic lives in
 * `@motif/shared`; this dialog only gathers input and hands the parent a
 * normalized {@link IdeaMetadataEdit}.
 */
export interface MetadataSuggestions {
  readonly tags: readonly string[];
  readonly instrument: readonly string[];
  readonly style: readonly string[];
}

function TagField({
  label,
  values,
  suggestions,
  onChange,
}: {
  label: string;
  values: string[];
  suggestions: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    onChange(normalizeMultiValue([...values, raw]));
    setDraft("");
  }

  const matches = useMemo(() => {
    const query = draft.trim().toLocaleLowerCase();
    const chosen = new Set(values.map((value) => value.toLocaleLowerCase()));
    return suggestions
      .filter((suggestion) => !chosen.has(suggestion.toLocaleLowerCase()))
      .filter((suggestion) =>
        query.length === 0
          ? true
          : suggestion.toLocaleLowerCase().includes(query),
      )
      .slice(0, 6);
  }, [draft, suggestions, values]);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {values.length > 0 ? (
        <View style={styles.chips}>
          {values.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${value}`}
              onPress={() =>
                onChange(values.filter((entry) => entry !== value))
              }
              style={styles.chip}
            >
              <Text style={styles.chipText}>{value} ✕</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={(text) => {
          // Committing on comma keeps entry quick without a dedicated button.
          if (text.endsWith(",")) commit(text.slice(0, -1));
          else setDraft(text);
        }}
        onSubmitEditing={() => commit(draft)}
        blurOnSubmit={false}
        placeholder={`Add ${label.toLowerCase()}…`}
        placeholderTextColor="#5a5a62"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
      />
      {matches.length > 0 ? (
        <View style={styles.suggestions}>
          {matches.map((suggestion) => (
            <Pressable
              key={suggestion}
              accessibilityRole="button"
              accessibilityLabel={`Add ${suggestion}`}
              onPress={() => commit(suggestion)}
              style={styles.suggestion}
            >
              <Text style={styles.suggestionText}>{suggestion}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function MetadataDialog({
  visible,
  idea,
  suggestions,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  idea: IdeaMetadata | null;
  suggestions: MetadataSuggestions;
  onCancel: () => void;
  onSubmit: (edit: IdeaMetadataEdit) => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const [instrument, setInstrument] = useState<string[]>([]);
  const [style, setStyle] = useState<string[]>([]);
  const [tempo, setTempo] = useState("");
  const [location, setLocation] = useState<IdeaLocation | null>(null);

  // Re-seed each time the dialog opens for a different Idea.
  useEffect(() => {
    if (!visible || !idea) return;
    setTags([...idea.tags]);
    setInstrument([...idea.instrument]);
    setStyle([...idea.style]);
    setTempo(idea.tempo === null ? "" : String(idea.tempo));
    setLocation(idea.location);
  }, [visible, idea]);

  function submit() {
    onSubmit({
      tags: normalizeMultiValue(tags),
      instrument: normalizeMultiValue(instrument),
      style: normalizeMultiValue(style),
      tempo: normalizeTempo(tempo),
      // Coordinates stay fixed on either device; only the label is editable and
      // the whole location tag removable. Send the desired state so an unchanged
      // location never re-stamps (the shared merge compares before stamping).
      location:
        location === null
          ? null
          : { ...location, label: location.label.trim() },
    });
  }

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
          <Text style={styles.title}>Edit metadata</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            <TagField
              label="Tags"
              values={tags}
              suggestions={suggestions.tags}
              onChange={setTags}
            />
            <TagField
              label="Instrument"
              values={instrument}
              suggestions={suggestions.instrument}
              onChange={setInstrument}
            />
            <TagField
              label="Style"
              values={style}
              suggestions={suggestions.style}
              onChange={setStyle}
            />
            <View style={styles.field}>
              <Text style={styles.label}>Tempo (BPM)</Text>
              <TextInput
                style={styles.input}
                value={tempo}
                onChangeText={setTempo}
                placeholder="e.g. 120"
                placeholderTextColor="#5a5a62"
                keyboardType="number-pad"
                returnKeyType="done"
              />
            </View>
            {location !== null ? (
              <View style={styles.field}>
                <Text style={styles.label}>Location</Text>
                <TextInput
                  style={styles.input}
                  value={location.label}
                  onChangeText={(text) =>
                    setLocation({ ...location, label: text })
                  }
                  placeholder="Place label"
                  placeholderTextColor="#5a5a62"
                  autoCorrect={false}
                  returnKeyType="done"
                />
                <View style={styles.locationMeta}>
                  <Text style={styles.coords}>{formatCoordinates(location)}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove location"
                    onPress={() => setLocation(null)}
                    style={styles.removeLocation}
                  >
                    <Text style={styles.removeLocationText}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </ScrollView>
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
              onPress={submit}
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
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxHeight: "80%",
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
  field: {
    marginBottom: 16,
  },
  label: {
    color: "#a0a0a8",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 8,
  },
  chip: {
    backgroundColor: "#2a2a32",
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  chipText: {
    color: "#f5f5f7",
    fontSize: 13,
  },
  input: {
    color: "#f5f5f7",
    fontSize: 15,
    backgroundColor: "#0b0b0f",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2a2a32",
  },
  locationMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  coords: {
    color: "#686872",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  removeLocation: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#2a2a32",
  },
  removeLocationText: {
    color: "#e5808a",
    fontSize: 13,
    fontWeight: "600",
  },
  suggestions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  suggestion: {
    backgroundColor: "#16161c",
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#33333d",
  },
  suggestionText: {
    color: "#9a9aa4",
    fontSize: 13,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
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
    color: "#4c9aff",
    fontSize: 15,
    fontWeight: "700",
  },
});
