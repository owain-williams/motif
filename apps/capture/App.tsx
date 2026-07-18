import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { SYNC_PROTOCOL_VERSION } from "@motif/shared";

/**
 * Capture app shell (scaffold). Renders a placeholder screen and imports a
 * value from @motif/shared to prove the shared package resolves at runtime.
 * The record-and-auto-save loop lands in a later ticket.
 */
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Motif Capture</Text>
      <Text style={styles.subtitle}>sync protocol v{SYNC_PROTOCOL_VERSION}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b0b0f",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: "#f5f5f7",
    fontSize: 24,
    fontWeight: "600",
  },
  subtitle: {
    color: "#8a8a92",
    fontSize: 13,
    marginTop: 8,
  },
});
