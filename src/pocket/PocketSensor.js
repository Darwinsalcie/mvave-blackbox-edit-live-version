/**
 * PocketSensor.js
 * Listens to accelerometer motion and detects sharp foot-strike impacts.
 */

import { pocketConfig } from './PocketConfig.js';

export class PocketSensor {
  constructor() {
    this.isActive = false;
    this.lastStompTime = 0;
    this.stompDebounceMs = 180; // Minimum time between consecutive stomps to avoid shock resonance

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
    return true; // Not required on Android or older browsers
  }

  start(onStomp, onLiveMagnitude = null) {
    if (this.isActive) return;
    this.onStompCallback = onStomp;
    this.onLiveMagnitudeCallback = onLiveMagnitude;

    window.addEventListener('devicemotion', this.handleMotion, { passive: true });
    this.isActive = true;
  }

  stop() {
    if (!this.isActive) return;
    window.removeEventListener('devicemotion', this.handleMotion);
    this.isActive = false;
  }

  handleMotion(event) {
    let mag = 0;

    // Prefer linear acceleration (gravity already subtracted by sensor fusion)
    if (event.acceleration && event.acceleration.x !== null) {
      const ax = event.acceleration.x || 0;
      const ay = event.acceleration.y || 0;
      const az = event.acceleration.z || 0;
      mag = Math.sqrt(ax * ax + ay * ay + az * az);
    } else if (event.accelerationIncludingGravity) {
      // Fallback: estimate linear acceleration using high-pass filter
      const rawX = event.accelerationIncludingGravity.x || 0;
      const rawY = event.accelerationIncludingGravity.y || 0;
      const rawZ = event.accelerationIncludingGravity.z || 0;

      this.gravity.x = this.alpha * this.gravity.x + (1 - this.alpha) * rawX;
      this.gravity.y = this.alpha * this.gravity.y + (1 - this.alpha) * rawY;
      this.gravity.z = this.alpha * this.gravity.z + (1 - this.alpha) * rawZ;

      const lx = rawX - this.gravity.x;
      const ly = rawY - this.gravity.y;
      const lz = rawZ - this.gravity.z;
      mag = Math.sqrt(lx * lx + ly * ly + lz * lz);
    }

    if (this.onLiveMagnitudeCallback) {
      this.onLiveMagnitudeCallback(mag);
    }

    const cfg = pocketConfig.get();
    const threshold = cfg.sensitivityThreshold || 16.0;

    // Check for a sharp foot-stomp impact
    const now = Date.now();
    if (mag >= threshold && now - this.lastStompTime >= this.stompDebounceMs) {
      this.lastStompTime = now;
      if (this.onStompCallback) {
        this.onStompCallback(mag, now);
      }
    }
  }
}

export const pocketSensor = new PocketSensor();
