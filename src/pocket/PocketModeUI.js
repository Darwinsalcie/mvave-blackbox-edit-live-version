/**
 * PocketModeUI.js
 * Controls the OLED Black Screen overlay, Screen Wake Lock,
 * Double-Tap to Unlock, and the Calibration/Settings Modal.
 */

import { pocketConfig } from './PocketConfig.js';
import { pocketSensor } from './PocketSensor.js';
import { pocketGestureEngine, POCKET_MODES } from './PocketGestureEngine.js';
import { pocketFeedback } from './PocketFeedback.js';

export class PocketModeUI {
  constructor() {
    this.wakeLock = null;
    this.isPocketModeActive = false;

    // Double tap on screen to exit
    this.lastScreenTapTime = 0;

    // DOM Elements
    this.overlayEl = null;
    this.statusTextEl = null;
    this.valueDisplayEl = null;
  }

  init() {
    this.buildOledOverlay();
    this.buildSettingsModal();
    this.bindHeaderButtons();

    // Listen to engine state updates to update OLED screen readout
    pocketGestureEngine.setCallbacks(
      (mode) => this.handleModeChange(mode),
      (actionType, param, value) => this.handleAction(actionType, param, value)
    );
  }

  bindHeaderButtons() {
    const pocketModeBtn = document.getElementById('pocketModeBtn');
    const pocketSettingsBtn = document.getElementById('pocketSettingsBtn');

    pocketModeBtn?.addEventListener('click', () => this.enterPocketMode());
    pocketSettingsBtn?.addEventListener('click', () => this.openSettingsModal());
  }

  // =========================================================
  // OLED BLACK SCREEN & WAKE LOCK
  // =========================================================

  buildOledOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'pocketOledScreen';
    overlay.className = 'pocket-oled-screen';
    overlay.style.display = 'none';

    overlay.innerHTML = `
      <div class="oled-content">
        <div class="oled-badge">👖 MODO BOLSILLO</div>
        <div id="oledStatusText" class="oled-status">LISTO · ESPERANDO PISADAS</div>
        <div id="oledValueDisplay" class="oled-value">--</div>
        <div class="oled-instructions">
          <span>2 Pisadas: Subir Vol | 3 Pisadas: Bajar Vol | 4 Pisadas: Drive</span>
          <span class="oled-unlock-hint">Toca 2 veces la pantalla para salir</span>
        </div>
      </div>
    `;

    // Detect double-tap on screen to exit
    overlay.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const now = Date.now();
      if (now - this.lastScreenTapTime < 400) {
        this.exitPocketMode();
      } else {
        this.lastScreenTapTime = now;
      }
    });

    document.body.appendChild(overlay);

    this.overlayEl = overlay;
    this.statusTextEl = overlay.querySelector('#oledStatusText');
    this.valueDisplayEl = overlay.querySelector('#oledValueDisplay');
  }

  async enterPocketMode() {
    // Request iOS sensor permission if needed
    const granted = await pocketSensor.requestPermission();
    if (!granted) {
      alert('Permiso de sensores de movimiento requerido para el Modo Bolsillo.');
      return;
    }

    // Acquire Screen Wake Lock
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
      } catch (err) {
        console.warn('Wake Lock request failed:', err);
      }
    }

    // Start motion sensor
    pocketSensor.start((mag, ts) => {
      pocketGestureEngine.processStomp(mag, ts);
    });

    this.isPocketModeActive = true;
    if (this.overlayEl) {
      this.overlayEl.style.display = 'flex';
      this.statusTextEl.textContent = 'LISTO · ESPERANDO PISADAS';
      this.valueDisplayEl.textContent = `VOL: ${window.editor?.currentState?.volume ?? 50}%`;
    }

    pocketFeedback.playTone(880, 0.1, 'sine');
  }

  exitPocketMode() {
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }

    pocketSensor.stop();
    pocketGestureEngine.exitActiveMode();

    this.isPocketModeActive = false;
    if (this.overlayEl) {
      this.overlayEl.style.display = 'none';
    }

    pocketFeedback.pocketUnlocked();
  }

  handleModeChange(mode) {
    if (!this.statusTextEl) return;

    switch (mode) {
      case POCKET_MODES.IDLE:
        this.statusTextEl.textContent = 'VALOR FIJADO · LISTO';
        break;
      case POCKET_MODES.VOL_UP:
        this.statusTextEl.textContent = '▲ MODO SUBIR VOLUMEN';
        break;
      case POCKET_MODES.VOL_DOWN:
        this.statusTextEl.textContent = '▼ MODO BAJAR VOLUMEN';
        break;
      case POCKET_MODES.DRIVE:
        this.statusTextEl.textContent = '⚡ MODO DRIVE (1=Sube, 2=Baja)';
        break;
    }
  }

  handleAction(actionType, param, value) {
    if (!this.valueDisplayEl) return;

    if (actionType === 'STEP') {
      if (param === 'VOL') {
        this.valueDisplayEl.textContent = `VOL: ${value}%`;
      } else if (param.startsWith('DRIVE')) {
        this.valueDisplayEl.textContent = `DRIVE: ${value}`;
      }
    } else if (actionType === 'LOCK') {
      this.valueDisplayEl.textContent = '✓ FIJADO';
    }
  }

  // =========================================================
  // POCKET SETTINGS & CALIBRATION MODAL
  // =========================================================

  buildSettingsModal() {
    const modal = document.createElement('div');
    modal.id = 'pocketSettingsModal';
    modal.className = 'live-modal-backdrop';
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="live-modal-card pocket-modal-card">
        <div class="modal-header">
          <div class="modal-title-row">
            <h3>⚙️ Configuración Modo Bolsillo</h3>
            <button id="closePocketSettingsBtn" class="close-x-btn">✕</button>
          </div>
          <p class="modal-subtitle">Calibra el acelerómetro y tiempos de pisadas con el pie</p>
        </div>

        <div class="pocket-settings-body">
          <!-- Live Force Meter (VU bar) -->
          <div class="setting-group">
            <label class="setting-label">
              <span>Medidor de Fuerza en Vivo (Pisa el suelo)</span>
              <span id="liveMagnitudeLabel" class="live-val">0.0 m/s²</span>
            </label>
            <div class="force-meter-track">
              <div id="forceMeterFill" class="force-meter-fill"></div>
              <div id="thresholdMarker" class="threshold-marker" title="Umbral actual"></div>
            </div>
          </div>

          <!-- Sensitivity Slider -->
          <div class="setting-group">
            <label class="setting-label">
              <span>Sensibilidad de Pisada (Umbral de Impacto)</span>
              <span id="sensitivityValLabel" class="setting-val">16 m/s²</span>
            </label>
            <input type="range" id="sensitivitySlider" min="8" max="30" step="0.5" value="16" class="pocket-slider" />
          </div>

          <!-- Stomp Window Slider -->
          <div class="setting-group">
            <label class="setting-label">
              <span>Tiempo entre pisadas del gesto</span>
              <span id="windowValLabel" class="setting-val">500 ms</span>
            </label>
            <input type="range" id="windowSlider" min="300" max="800" step="25" value="500" class="pocket-slider" />
          </div>

          <!-- Inactivity Timeout Slider -->
          <div class="setting-group">
            <label class="setting-label">
              <span>Tiempo de espera antes de fijar y salir</span>
              <span id="inactivityValLabel" class="setting-val">2.5 s</span>
            </label>
            <input type="range" id="inactivitySlider" min="1.0" max="5.0" step="0.5" value="2.5" class="pocket-slider" />
          </div>

          <!-- Steps Row (Volume & Drive) -->
          <div class="setting-row-duo">
            <div class="setting-group-half">
              <label class="setting-label">Paso Volumen (+/-)</label>
              <select id="volStepSelect" class="pocket-select">
                <option value="1">1 %</option>
                <option value="2" selected>2 %</option>
                <option value="3">3 %</option>
                <option value="5">5 %</option>
              </select>
            </div>
            <div class="setting-group-half">
              <label class="setting-label">Paso Drive (+/-)</label>
              <select id="driveStepSelect" class="pocket-select">
                <option value="1">1</option>
                <option value="2" selected>2</option>
                <option value="3">3</option>
                <option value="5">5</option>
              </select>
            </div>
          </div>

          <!-- Feedback Toggles -->
          <div class="setting-row-duo">
            <label class="pocket-check-label">
              <input type="checkbox" id="hapticCheck" checked />
              <span>Vibración Háptica</span>
            </label>
            <label class="pocket-check-label">
              <input type="checkbox" id="audioCheck" checked />
              <span>Tonos de Audio</span>
            </label>
          </div>

          <!-- Gesture Simulator / Practice -->
          <div class="practice-box">
            <span class="practice-title">Probar Gestos sin meter al bolsillo:</span>
            <div class="practice-btns">
              <button id="simVolUpBtn" class="sim-btn">2 Pisadas (Vol +)</button>
              <button id="simVolDownBtn" class="sim-btn">3 Pisadas (Vol -)</button>
              <button id="simDriveBtn" class="sim-btn">4 Pisadas (Drive)</button>
            </div>
            <div id="simFeedbackText" class="sim-feedback">Estado: Inactivo</div>
          </div>
        </div>

        <div class="modal-footer">
          <button id="savePocketSettingsBtn" class="live-modal-btn">LISTO</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    this.bindSettingsEvents(modal);
  }

  bindSettingsEvents(modal) {
    const closeBtn = modal.querySelector('#closePocketSettingsBtn');
    const saveBtn = modal.querySelector('#savePocketSettingsBtn');

    const sensitivitySlider = modal.querySelector('#sensitivitySlider');
    const windowSlider = modal.querySelector('#windowSlider');
    const inactivitySlider = modal.querySelector('#inactivitySlider');
    const volStepSelect = modal.querySelector('#volStepSelect');
    const driveStepSelect = modal.querySelector('#driveStepSelect');
    const hapticCheck = modal.querySelector('#hapticCheck');
    const audioCheck = modal.querySelector('#audioCheck');

    const sensitivityValLabel = modal.querySelector('#sensitivityValLabel');
    const windowValLabel = modal.querySelector('#windowValLabel');
    const inactivityValLabel = modal.querySelector('#inactivityValLabel');
    const thresholdMarker = modal.querySelector('#thresholdMarker');

    const updateControlsFromConfig = () => {
      const cfg = pocketConfig.get();
      sensitivitySlider.value = cfg.sensitivityThreshold;
      windowSlider.value = cfg.stompWindowMs;
      inactivitySlider.value = cfg.inactivityTimeoutSec;
      volStepSelect.value = cfg.volStep;
      driveStepSelect.value = cfg.driveStep;
      hapticCheck.checked = cfg.hapticFeedback;
      audioCheck.checked = cfg.audioFeedback;

      sensitivityValLabel.textContent = `${cfg.sensitivityThreshold} m/s²`;
      windowValLabel.textContent = `${cfg.stompWindowMs} ms`;
      inactivityValLabel.textContent = `${cfg.inactivityTimeoutSec} s`;

      // Position threshold marker (scale 0-40 m/s²)
      const pct = (cfg.sensitivityThreshold / 40) * 100;
      thresholdMarker.style.left = `${pct}%`;
    };

    sensitivitySlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      sensitivityValLabel.textContent = `${val} m/s²`;
      pocketConfig.update({ sensitivityThreshold: val });
      const pct = (val / 40) * 100;
      thresholdMarker.style.left = `${pct}%`;
    });

    windowSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      windowValLabel.textContent = `${val} ms`;
      pocketConfig.update({ stompWindowMs: val });
    });

    inactivitySlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      inactivityValLabel.textContent = `${val} s`;
      pocketConfig.update({ inactivityTimeoutSec: val });
    });

    volStepSelect.addEventListener('change', (e) => {
      pocketConfig.update({ volStep: parseInt(e.target.value, 10) });
    });

    driveStepSelect.addEventListener('change', (e) => {
      pocketConfig.update({ driveStep: parseInt(e.target.value, 10) });
    });

    hapticCheck.addEventListener('change', (e) => {
      pocketConfig.update({ hapticFeedback: e.target.checked });
    });

    audioCheck.addEventListener('change', (e) => {
      pocketConfig.update({ audioFeedback: e.target.checked });
    });

    const closeModal = () => {
      pocketSensor.stop();
      modal.style.display = 'none';
    };

    closeBtn.addEventListener('click', closeModal);
    saveBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Gesture Simulator Buttons
    const simFeedback = modal.querySelector('#simFeedbackText');
    const simVolUpBtn = modal.querySelector('#simVolUpBtn');
    const simVolDownBtn = modal.querySelector('#simVolDownBtn');
    const simDriveBtn = modal.querySelector('#simDriveBtn');

    const runSimulation = (stompCount, name) => {
      simFeedback.textContent = `Ejecutando ${stompCount} pisadas: ${name}...`;
      for (let i = 0; i < stompCount; i++) {
        setTimeout(() => {
          pocketGestureEngine.processStomp(25.0, Date.now());
        }, i * 200);
      }
      setTimeout(() => {
        simFeedback.textContent = `Modo actual: ${pocketGestureEngine.currentMode}`;
      }, stompCount * 200 + 600);
    };

    simVolUpBtn.addEventListener('click', () => runSimulation(2, 'Volumen UP'));
    simVolDownBtn.addEventListener('click', () => runSimulation(3, 'Volumen DOWN'));
    simDriveBtn.addEventListener('click', () => runSimulation(4, 'Drive Amp'));

    this.updateControlsFromConfig = updateControlsFromConfig;
  }

  openSettingsModal() {
    const modal = document.getElementById('pocketSettingsModal');
    if (!modal) return;

    if (this.updateControlsFromConfig) {
      this.updateControlsFromConfig();
    }

    const forceMeterFill = modal.querySelector('#forceMeterFill');
    const liveMagnitudeLabel = modal.querySelector('#liveMagnitudeLabel');

    // Start live sensor in calibration mode
    pocketSensor.start(
      (mag, ts) => {
        // Flash meter on stomp
        if (forceMeterFill) {
          forceMeterFill.classList.add('stomp-flash');
          setTimeout(() => forceMeterFill.classList.remove('stomp-flash'), 120);
        }
      },
      (liveMag) => {
        if (liveMagnitudeLabel) liveMagnitudeLabel.textContent = `${liveMag.toFixed(1)} m/s²`;
        if (forceMeterFill) {
          const pct = Math.min(100, (liveMag / 40) * 100);
          forceMeterFill.style.width = `${pct}%`;
        }
      }
    );

    modal.style.display = 'flex';
  }
}

export const pocketModeUI = new PocketModeUI();
