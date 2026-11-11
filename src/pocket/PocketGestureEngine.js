/**
 * PocketGestureEngine.js
 * State machine that processes foot stomps, isolates command gestures from rhythm,
 * and controls Volume and Amp Drive.
 */

import { pocketConfig } from './PocketConfig.js';
import { pocketFeedback } from './PocketFeedback.js';

export const POCKET_MODES = {
  IDLE: 'IDLE',
  VOL_UP: 'VOL_UP',
  VOL_DOWN: 'VOL_DOWN',
  DRIVE: 'DRIVE',
};

export class PocketGestureEngine {
  constructor() {
    this.currentMode = POCKET_MODES.IDLE;

    // Window collection for initial command gestures
    this.stompCount = 0;
    this.gestureWindowTimer = null;

    // Sub-gesture collection for Drive mode (1 stomp = UP, 2 stomps = DOWN)
    this.driveStompCount = 0;
    this.driveWindowTimer = null;

    // Inactivity timer before fixing value and returning to IDLE
    this.inactivityTimer = null;

    // Stomp history for rhythm detection
    this.stompHistory = [];

    // Listener callbacks
    this.onStateChangeCallback = null;
    this.onActionCallback = null;
  }

  setCallbacks(onStateChange, onAction) {
    this.onStateChangeCallback = onStateChange;
    this.onActionCallback = onAction;
  }

  notifyState() {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(this.currentMode);
    }
  }

  notifyAction(actionType, paramName, value) {
    if (this.onActionCallback) {
      this.onActionCallback(actionType, paramName, value);
    }
  }

  resetInactivityTimer() {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }

    const cfg = pocketConfig.get();
    const timeoutMs = (cfg.inactivityTimeoutSec || 2.5) * 1000;

    this.inactivityTimer = setTimeout(() => {
      this.exitActiveMode();
    }, timeoutMs);
  }

  exitActiveMode() {
    if (this.currentMode !== POCKET_MODES.IDLE) {
      const exitedMode = this.currentMode;
      this.currentMode = POCKET_MODES.IDLE;
      this.stompCount = 0;
      this.driveStompCount = 0;
      if (this.inactivityTimer) clearTimeout(this.inactivityTimer);

      pocketFeedback.modeExit();
      this.notifyState();
      this.notifyAction('LOCK', exitedMode, null);
    }
  }

  processStomp(magnitude, timestamp) {
    this.stompHistory.push(timestamp);
    if (this.stompHistory.length > 8) this.stompHistory.shift();

    switch (this.currentMode) {
      case POCKET_MODES.IDLE:
        this.handleIdleStomp(timestamp);
        break;

      case POCKET_MODES.VOL_UP:
        this.handleVolUpStomp();
        break;

      case POCKET_MODES.VOL_DOWN:
        this.handleVolDownStomp();
        break;

      case POCKET_MODES.DRIVE:
        this.handleDriveStomp();
        break;
    }
  }

  // --- IDLE STATE: Collects 2, 3, or 4 stomps ---
  handleIdleStomp(timestamp) {
    const cfg = pocketConfig.get();
    const windowMs = cfg.stompWindowMs || 500;

    this.stompCount++;

    // Rhythm detection: if user stomps 5 or more times in a row, they are tapping the beat!
    if (this.stompCount >= 5) {
      if (this.gestureWindowTimer) clearTimeout(this.gestureWindowTimer);
      this.stompCount = 0;
      return;
    }

    if (this.gestureWindowTimer) {
      clearTimeout(this.gestureWindowTimer);
    }

    this.gestureWindowTimer = setTimeout(() => {
      const finalCount = this.stompCount;
      this.stompCount = 0;

      if (finalCount === 2) {
        // 2 Pisadas: MODO SUBIR VOLUMEN
        this.currentMode = POCKET_MODES.VOL_UP;
        pocketFeedback.modeVolUp();
        this.resetInactivityTimer();
        this.notifyState();
        this.notifyAction('MODE_ENTER', 'VOL_UP', null);
      } else if (finalCount === 3) {
        // 3 Pisadas: MODO BAJAR VOLUMEN
        this.currentMode = POCKET_MODES.VOL_DOWN;
        pocketFeedback.modeVolDown();
        this.resetInactivityTimer();
        this.notifyState();
        this.notifyAction('MODE_ENTER', 'VOL_DOWN', null);
      } else if (finalCount === 4) {
        // 4 Pisadas: MODO DRIVE (AMP GAIN)
        this.currentMode = POCKET_MODES.DRIVE;
        pocketFeedback.modeDrive();
        this.resetInactivityTimer();
        this.notifyState();
        this.notifyAction('MODE_ENTER', 'DRIVE', null);
      }
    }, windowMs);
  }

  // --- ACTIVE: VOL_UP ---
  handleVolUpStomp() {
    this.resetInactivityTimer();
    const cfg = pocketConfig.get();
    const step = cfg.volStep || 2;

    const editor = window.editor;
    if (editor && editor.currentState) {
      const currentVol = editor.currentState.volume ?? 50;
      const newVol = Math.min(100, currentVol + step);

      if (newVol === currentVol) {
        pocketFeedback.limitHit();
      } else {
        editor.currentState.volume = newVol;
        editor.updateLiveVolumeDisplay();
        editor.changeKnob(0, newVol);
        editor.registerEdit();
        pocketFeedback.stompUp(false);
      }
      this.notifyAction('STEP', 'VOL', newVol);
    }
  }

  // --- ACTIVE: VOL_DOWN ---
  handleVolDownStomp() {
    this.resetInactivityTimer();
    const cfg = pocketConfig.get();
    const step = cfg.volStep || 2;

    const editor = window.editor;
    if (editor && editor.currentState) {
      const currentVol = editor.currentState.volume ?? 50;
      const newVol = Math.max(0, currentVol - step);

      if (newVol === currentVol) {
        pocketFeedback.limitHit();
      } else {
        editor.currentState.volume = newVol;
        editor.updateLiveVolumeDisplay();
        editor.changeKnob(0, newVol);
        editor.registerEdit();
        pocketFeedback.stompDown(false);
      }
      this.notifyAction('STEP', 'VOL', newVol);
    }
  }

  // --- ACTIVE: DRIVE ---
  // 1 stomp: Subir drive. 2 stomps rápidos: Bajar drive.
  handleDriveStomp() {
    this.resetInactivityTimer();
    const cfg = pocketConfig.get();
    const windowMs = cfg.stompWindowMs || 500;

    this.driveStompCount++;

    if (this.driveWindowTimer) clearTimeout(this.driveWindowTimer);

    this.driveWindowTimer = setTimeout(() => {
      const count = this.driveStompCount;
      this.driveStompCount = 0;

      const editor = window.editor;
      if (!editor || !editor.currentState) return;

      const ampKnobs = editor.currentState.knobs?.amp;
      const currentDrive = ampKnobs ? (ampKnobs[0x20] ?? 50) : 50;
      const step = cfg.driveStep || 2;

      if (count === 1) {
        // 1 Pisada: SUBIR DRIVE
        const newDrive = Math.min(100, currentDrive + step);
        if (newDrive === currentDrive) {
          pocketFeedback.limitHit();
        } else {
          if (!editor.currentState.knobs.amp) editor.currentState.knobs.amp = {};
          editor.currentState.knobs.amp[0x20] = newDrive;
          editor.changeKnob(0x20, newDrive);
          editor.registerEdit();
          pocketFeedback.stompUp(true);
        }
        this.notifyAction('STEP', 'DRIVE_UP', newDrive);
      } else if (count >= 2) {
        // 2 Pisadas: BAJAR DRIVE
        const newDrive = Math.max(0, currentDrive - step);
        if (newDrive === currentDrive) {
          pocketFeedback.limitHit();
        } else {
          if (!editor.currentState.knobs.amp) editor.currentState.knobs.amp = {};
          editor.currentState.knobs.amp[0x20] = newDrive;
          editor.changeKnob(0x20, newDrive);
          editor.registerEdit();
          pocketFeedback.stompDown(true);
        }
        this.notifyAction('STEP', 'DRIVE_DOWN', newDrive);
      }
    }, windowMs);
  }
}

export const pocketGestureEngine = new PocketGestureEngine();

