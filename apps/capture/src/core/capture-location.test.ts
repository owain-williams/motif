import { describe, expect, it, vi } from "vitest";
import { resolveCaptureLocation } from "./capture-location.js";

/**
 * Opt-in location tag resolution (motif-kka.3). The pure decision behind attaching a
 * location to a new recording: it must never capture when the toggle is off,
 * never block a save when geocoding fails, and never invent a position.
 */

const LONDON = { lat: 51.5074, lon: -0.1278 };

describe("resolveCaptureLocation", () => {
  it("captures nothing when the toggle is off — not even reading a position", async () => {
    const readLastKnownPosition = vi.fn(async () => LONDON);
    const reverseGeocode = vi.fn(async () => "London");

    const result = await resolveCaptureLocation({
      enabled: false,
      readLastKnownPosition,
      reverseGeocode,
    });

    expect(result).toBeNull();
    expect(readLastKnownPosition).not.toHaveBeenCalled();
    expect(reverseGeocode).not.toHaveBeenCalled();
  });

  it("attaches coordinates and a reverse-geocoded label when enabled", async () => {
    const result = await resolveCaptureLocation({
      enabled: true,
      readLastKnownPosition: async () => LONDON,
      reverseGeocode: async () => "  London  ",
    });

    expect(result).toEqual({ lat: 51.5074, lon: -0.1278, label: "London" });
  });

  it("stores coordinates with an empty label when geocoding fails", async () => {
    const result = await resolveCaptureLocation({
      enabled: true,
      readLastKnownPosition: async () => LONDON,
      reverseGeocode: async () => {
        throw new Error("offline");
      },
    });

    expect(result).toEqual({ lat: 51.5074, lon: -0.1278, label: "" });
  });

  it("stores coordinates with an empty label when geocoding returns nothing", async () => {
    const result = await resolveCaptureLocation({
      enabled: true,
      readLastKnownPosition: async () => LONDON,
      reverseGeocode: async () => "",
    });

    expect(result).toEqual({ lat: 51.5074, lon: -0.1278, label: "" });
  });

  it("captures nothing when there is no cached position", async () => {
    const result = await resolveCaptureLocation({
      enabled: true,
      readLastKnownPosition: async () => null,
      reverseGeocode: async () => "London",
    });

    expect(result).toBeNull();
  });

  it("captures nothing when reading the position fails", async () => {
    const result = await resolveCaptureLocation({
      enabled: true,
      readLastKnownPosition: async () => {
        throw new Error("permission denied");
      },
      reverseGeocode: async () => "London",
    });

    expect(result).toBeNull();
  });
});
