/**
 * PocketSensor.js
 * Listens to accelerometer and gyroscope motion.
 * Uses 3D jerk (jolt rate) and high-pass differential impact detection
 * so soft stomps are detected reliably regardless of foot posture or pocket angle.
 */

import { pocketConfig } from './PocketConfig.js';

export class PocketSensor {
  constructor() {
    this.isActive = false;
    this.lastStompTime = 0;
    this.stompDebounceMs = 170; // Minimum time between consecutive stomps to avoid shock resonance

    // Previous acceleration sample for 3D Jerk / Delta-acceleration calculation
    this.prevSample = { x: 0, y: 0, z: 0, t: 0 };

    // High-pass filter for smooth motion rejection
    this.hpAcc = { x: 0, y: 0, z: 0 };
    this.prevRaw = { x: 0, y: 0, z: 0 };
    this.hpAlpha = 0.82; // Cutoff for smooth leg repositioning / body sway

    // Gravity filter for accelerationIncludingGravity fallback
    this.gravity = { x: 0, y: 0, z: 9.8 };
    this.alpha = 0.8;

    this.onStompCallback = null;
    this.onLiveMagnitudeCallback = null;

    this.handleMotion = this.handleMotion.bind(this);
  }

  async requestPermission() {
    if (
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function'
    ) {
      try {
        const response = await DeviceMotionEvent.requestPermission();
        return response === 'granted';
      } catch (e) {
        console.warn('DeviceMotion permission error:', e);
        return false;
      }
    }
    return true; // Not required on Android or standard browsers
  }

  start(onStomp, onLiveMagnitude = null) {
    if (this.isActive) return;
    this.onStompCallback = onStomp;
    this.onLiveMagnitudeCallback = onLiveMagnitude;

    this.prevSample = { x: 0, y: 0, z: 0, t: 0 };
    this.hpAcc = { x: 0, y: 0, z: 0 };
    this.prevRaw = { x: 0, y: 0, z: 0 };

    window.addEventListener('devicemotion', this.handleMotion, { passive: true });
    this.isActive = true;
  }

  stop() {
    if (!this.isActive) return;
    window.removeEventListener('devicemotion', this.handleMotion);
    this.isActive = false;
  }

  handleMotion(event) {
    const now = Date.now();
    let ax = 0;
    let ay = 0;
    let az = 0;

    // 1. Acquire linear acceleration (prefer sensor fusion without gravity)
    if (event.acceleration && event.acceleration.x !== null) {
      ax = event.acceleration.x || 0;
      ay = event.acceleration.y || 0;
      az = event.acceleration.z || 0;
    } else if (event.accelerationIncludingGravity) {
      // Fallback: estimate linear acceleration by subtracting low-pass gravity
      const rawX = event.accelerationIncludingGravity.x || 0;
      const rawY = event.accelerationIncludingGravity.y || 0;
      const rawZ = event.accelerationIncludingGravity.z || 0;

      this.gravity.x = this.alpha * this.gravity.x + (1 - this.alpha) * rawX;
      this.gravity.y = this.alpha * this.gravity.y + (1 - this.alpha) * rawY;
      this.gravity.z = this.alpha * this.gravity.z + (1 - this.alpha) * rawZ;

      ax = rawX - this.gravity.x;
      ay = rawY - this.gravity.y;
      az = rawZ - this.gravity.z;
    }

    // 2. High-pass filter to strip away slow leg movement / postural shift
    this.hpAcc.x = this.hpAlpha * (this.hpAcc.x + ax - this.prevRaw.x);
    this.hpAcc.y = this.hpAlpha * (this.hpAcc.y + ay - this.prevRaw.y);
    this.hpAcc.z = this.hpAlpha * (this.hpAcc.z + az - this.prevRaw.z);
    this.prevRaw = { x: ax, y: ay, z: az };

    // High-pass magnitude (sharp acceleration isolated from posture/tilt)
    const hpMag = Math.sqrt(
      this.hpAcc.x * this.hpAcc.x +
      this.hpAcc.y * this.hpAcc.y +
      this.hpAcc.z * this.hpAcc.z
    );

    // 3. Compute 3D Jerk / Delta-acceleration (Rate of impact)
    // When the foot strikes the floor, deceleration is nearly instantaneous (<25ms)
    let jerkIntensity = 0;
    if (this.prevSample.t > 0) {
      const dt = (now - this.prevSample.t) / 1000; // seconds
      if (dt > 0.003 && dt < 0.1) {
        const dax = ax - this.prevSample.x;
        const day = ay - this.prevSample.y;
        const daz = az - this.prevSample.z;
        const deltaAcc = Math.sqrt(dax * dax + day * day + daz * daz);
        // Normalized jerk: scaled for intuitive comparison with m/s² thresholds
        jerkIntensity = deltaAcc;
      }
    }
    this.prevSample = { x: ax, y: ay, z: az, t: now };

    // 4. Combined Impact Metric:
    // Blends high-pass instant shock with delta rate of change.
    // This allows SOFT stomps (1.5 - 3 m/s²) to trigger cleanly while ignoring
    // larger but gradual leg positioning movements (raising thigh, moving foot forward).
    const impactScore = Math.max(hpMag, jerkIntensity * 1.25);

    if (this.onLiveMagnitudeCallback) {
      this.onLiveMagnitudeCallback(impactScore);
    }

    const cfg = pocketConfig.get();
    const threshold = cfg.sensitivityThreshold !== undefined ? cfg.sensitivityThreshold : 6.0;

    // 5. Trigger Stomp Impact Detection
    if (impactScore >= threshold && now - this.lastStompTime >= this.stompDebounceMs) {
      this.lastStompTime = now;
      if (this.onStompCallback) {
        this.onStompCallback(impactScore, now);
      }
    }
  }
}

export const pocketSensor = new PocketSensor();

