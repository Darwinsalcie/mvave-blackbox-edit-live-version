/**
 * PocketFeedback.js
 * Provides haptic vibrations and synthesized audio cues.
 */

import { pocketConfig } from './PocketConfig.js';

export class PocketFeedback {
  constructor() {
    this.audioCtx = null;
  }

  ensureAudio() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  playTone(freq = 600, durationSec = 0.08, type = 'sine') {
    const cfg = pocketConfig.get();
    if (!cfg.audioFeedback) return;

    try {
      this.ensureAudio();
      if (!this.audioCtx) return;

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);

      gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        this.audioCtx.currentTime + durationSec
      );

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + durationSec);
    } catch {
      // Audio autoplay policy or unavailable
    }
  }

  vibrate(pattern) {
    const cfg = pocketConfig.get();
    if (!cfg.hapticFeedback) return;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch {
        // Ignored
      }
    }
  }

  // --- Feedback Signals ---

  // Entered Mode: Volume UP (2 stomps)
  modeVolUp() {
    this.vibrate([120, 80, 120]);
    this.playTone(880, 0.15, 'triangle'); // High cheerful pitch
  }

  // Entered Mode: Volume DOWN (3 stomps)
  modeVolDown() {
    this.vibrate([100, 60, 100, 60, 100]);
    this.playTone(440, 0.18, 'triangle'); // Low pitch
  }

  // Entered Mode: Drive / Amp Gain (4 stomps)
  modeDrive() {
    this.vibrate([100, 50, 100, 50, 100, 50, 100]);
    this.playTone(660, 0.2, 'sawtooth'); // Edgy drive tone
  }

  // Increment Stomp (Volume or Drive UP)
  stompUp(isDrive = false) {
    this.vibrate(50);
    this.playTone(isDrive ? 750 : 950, 0.06, isDrive ? 'sawtooth' : 'sine');
  }

  // Decrement Stomp (Volume or Drive DOWN)
  stompDown(isDrive = false) {
    this.vibrate([35, 30, 35]);
    this.playTone(isDrive ? 550 : 380, 0.07, isDrive ? 'sawtooth' : 'sine');
  }

  // Locked & Mode Exited
  modeExit() {
    this.vibrate(180);
    this.playTone(520, 0.12, 'sine');
  }

  // Min / Max Limit Hit (0 or 100)
  limitHit() {
    this.vibrate([180, 60, 180]);
    this.playTone(260, 0.25, 'square');
  }

  // Screen Unlocked from Pocket Mode
  pocketUnlocked() {
    this.vibrate([60, 40, 90]);
    this.playTone(880, 0.12, 'sine');
  }
}

export const pocketFeedback = new PocketFeedback();

