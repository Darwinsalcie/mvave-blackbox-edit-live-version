/**
 * PocketConfig.js
 * Manages configuration and persistence for Pocket Motion Mode.
 */

const STORAGE_KEY = 'blackbox_pocket_config';

const DEFAULT_CONFIG = {
  // Acceleration spike threshold (m/s²) required to register a foot stomp
  sensitivityThreshold: 16.0,

  // Maximum time (ms) allowed between stomps to be grouped into a gesture (2, 3, or 4 stomps)
  stompWindowMs: 500,

  // Seconds of silence before locking the value and exiting the active mode
  inactivityTimeoutSec: 2.5,

  // Volume change per stomp
  volStep: 2,

  // Amp Drive change per stomp
  driveStep: 2,

  // Haptic feedback (navigator.vibrate)
  hapticFeedback: true,

  // Synthesized audio feedback tones (Web Audio API)
  audioFeedback: true,
};

export class PocketConfig {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.load();
  }

  load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
      }
    } catch {
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch (e) {
      console.error('Failed to save pocket config:', e);
    }
  }

  get() {
    return { ...this.config };
  }

  update(partial) {
    this.config = { ...this.config, ...partial };
    this.save();
    return this.get();
  }

  reset() {
    this.config = { ...DEFAULT_CONFIG };
    this.save();
    return this.get();
  }
}

export const pocketConfig = new PocketConfig();

