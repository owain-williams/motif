import { defineConfig } from "vitest/config";

/**
 * Vitest runs Capture's framework-agnostic core (`src/core`) in Node — no
 * simulator or device. The Expo/React Native shell is intentionally excluded;
 * its behavior is exercised on-device, not here.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/core/**/*.test.ts"],
  },
});
