class MvaveBLEEditor {
  constructor() {
    this.SERVICE_UUID = "0000ae40-0000-1000-8000-00805f9b34fb";
    this.WRITE_CHAR_UUID = "0000ae41-0000-1000-8000-00805f9b34fb";
    this.NOTIFY_CHAR_UUID = "0000ae42-0000-1000-8000-00805f9b34fb";

    this.BLOCKS = {
      0: {
        id: "fx",
        label: "FX",
        toggleAddr: 0x08,
        modelAddr: 0x0e,
        knobStart: 0x14,
        isDynamic: true,
        modelNames: ["Noise Gate++", "Boost", "Compress", "AI Gate MS"],
        params: {
          0: ["Gate", "Ghost", "Ghost", "Ghost", "Ghost", "Ghost"],
          1: ["Gate", "Gain", "Ghost", "Ghost", "Ghost", "Ghost"],
          2: ["Gate", "Sustain", "Attack", "Level", "Ghost", "Ghost"],
          3: ["Gate", "Bias", "Ghost", "Ghost", "Ghost", "Ghost"],
        },
      },
      1: {
        id: "amp",
        label: "AMP",
        toggleAddr: 0x09,
        modelAddr: 0x0f,
        knobStart: 0x20,
        isDynamic: false,
        modelNames: Array.from({ length: 20 }, (_, i) => `Amp Model ${i + 1}`),
        params: ["Gain", "Level", "Bass", "Mid", "Treble", "Ghost"],
      },
      2: {
        id: "mod",
        label: "MOD",
        toggleAddr: 0x0a,
        modelAddr: 0x10,
        knobStart: 0x2c,
        isDynamic: true,
        modelNames: [
          "Chorus",
          "Phaser",
          "Tremolo",
          "Flanger",
          "Vibrato",
          "Univibe",
          "Autofilter",
        ],
        params: {
          0: ["Speed", "Depth", "Mix", "Ghost", "Ghost", "Ghost"],
          1: ["Speed", "Midcut", "Reso", "Feedback", "Ghost", "Ghost"],
          2: ["Speed", "Depth", "Level", "Ghost", "Ghost", "Ghost"],
          3: ["Speed", "Depth", "Feedback", "Mix", "Ghost", "Ghost"],
          4: ["Speed", "Depth", "Ghost", "Ghost", "Ghost", "Ghost"],
          5: ["Speed", "Depth", "Mix", "Ghost", "Ghost", "Ghost"],
          6: ["Speed", "Min", "Max", "Mix", "Feedback", "Ghost"],
        },
      },
      3: {
        id: "dly",
        label: "DLY",
        toggleAddr: 0x0b,
        modelAddr: 0x11,
        knobStart: 0x38,
        isDynamic: true,
        modelNames: ["Analog", "Duck", "Dtape", "Dual", "Lofi"],
        params: {
          0: ["Time", "Feedback", "Mix", "Phaser", "Pitch", "Ghost"],
          1: ["Time", "Feedback", "Mix", "Unpack", "Speed", "Depth"],
          2: ["Time", "Feedback", "Mix", "Grit", "Speed", "Depth"],
          3: ["Time", "Feedback", "Mix", "T-Mode", "Speed", "Depth"],
          4: ["Time", "Feedback", "Mix", "Grit", "Speed", "Depth"],
        },
      },
      4: {
        id: "rev",
        label: "REV",
        toggleAddr: 0x0c,
        modelAddr: 0x12,
        knobStart: 0x44,
        isDynamic: true,
        modelNames: ["Room", "Hall", "Swell", "Spring", "Shimmer", "Cloud"],
        params: {
          0: ["Decay", "Mix", "High Pass", "Low Pass", "Depth", "Ghost"],
          1: ["Decay", "Mix", "High Pass", "Low Pass", "Depth", "Ghost"],
          2: ["Decay", "Mix", "High Pass", "Low Pass", "Rise-T", "Ghost"],
          3: ["Decay", "Mix", "High Pass", "Low Pass", "Combs", "Ghost"],
          4: ["Decay", "Mix", "Tone", "Pitch", "Amount", "Ghost"],
          5: ["Decay", "Mix", "High Pass", "Low Pass", "Diffusion", "Ghost"],
        },
      },
      5: {
        id: "cab",
        label: "CAB",
        toggleAddr: 0x0d,
        modelAddr: 0x13,
        knobStart: 0x50,
        isDynamic: false,
        modelNames: Array.from({ length: 20 }, (_, i) => `Cab IR ${i + 1}`),
        params: ["Level", "Low Cut", "High Cut", "Ghost", "Ghost", "Ghost"],
      },
    };

    this.pollingInterval = null;
    this.device = null;
    this.server = null;
    this.writeCharacteristic = null;
    this.notifyCharacteristic = null;

    this.connectionType = null; // 'ble' or 'usb'
    this.midiInput = null;
    this.midiOutput = null;
    this.usbMidiBuffer = null;
    this.isConnected = false;

    this.syncState = "IDLE";
    this.rxBuffer = [];
    this.lastUiEditTime = 0;
    this.isModified = false;
    this.lastDumpHex = "";
    this.activePresetId = 0;
    this.currentRawData = new Uint8Array(92);

    this.pendingSaveResolve = null;
    this.pendingSaveReject = null;
    this.saveTimeoutId = null;
    this.isLoggingEnabled = false;
    this.isPollingPaused = false;

    // LIVE MODE STATE
    this.currentView = "effects"; // 'effects' or 'controls'
    try {
      const savedEffects = localStorage.getItem("blackbox_live_effects");
      this.selectedEffects = savedEffects
        ? JSON.parse(savedEffects)
        : ["mod", "dly", "rev"];
    } catch {
      this.selectedEffects = ["mod", "dly", "rev"];
    }
    if (!Array.isArray(this.selectedEffects) || this.selectedEffects.length === 0) {
      this.selectedEffects = ["mod", "dly", "rev"];
    }

    this.isDottedEighth = true;
    this.baseBpm = 120.0;
    this.tapTimestamps = [];
    this.tapTimeout = null;
    this.beatIntervalId = null;

    this.volumeRepeatTimer = null;
    this.volumeRepeatInterval = null;
    this.presetNames = Array.from({ length: 80 }, (_, i) => `Preset ${i + 1}`);

    // Pre-populate offline default state
    this.currentState = {
      volume: 50,
      routing: [0, 1, 2, 3, 4, 5],
      modulesOn: {
        fx: false,
        amp: true,
        mod: true,
        dly: true,
        rev: true,
        cab: true,
      },
      models: { fx: 0, amp: 0, mod: 0, dly: 0, rev: 0, cab: 0 },
      knobs: {},
    };

    Object.keys(this.BLOCKS).forEach((key) => {
      const block = this.BLOCKS[key];
      this.currentState.knobs[block.id] = {};
      for (let i = 0; i < 6; i++) {
        this.currentState.knobs[block.id][block.knobStart + i * 2] = 50;
      }
    });

    this.initLogPanel();
    this.initLiveMode();
    this.renderLiveEffects();
    this.updateLiveVolumeDisplay();
    this.updateLiveDelayDisplay();
    this.startBeatIndicator(this.baseBpm);
  }

  // =========================================================
  // LIVE MODE INITIALIZATION & UI
  // =========================================================

  initLiveMode() {
    // 1. View Switcher Tabs (Efectos vs Vol & Delay)
    const tabEffects = document.getElementById("tabEffects");
    const tabControls = document.getElementById("tabControls");
    const viewEffects = document.getElementById("viewEffects");
    const viewControls = document.getElementById("viewControls");

    const switchView = (viewName) => {
      this.currentView = viewName;
      if (viewName === "effects") {
        tabEffects?.classList.add("active");
        tabControls?.classList.remove("active");
        viewEffects?.classList.add("active");
        viewControls?.classList.remove("active");
        this.renderLiveEffects();
      } else {
        tabControls?.classList.add("active");
        tabEffects?.classList.remove("active");
        viewControls?.classList.add("active");
        viewEffects?.classList.remove("active");
        this.updateLiveVolumeDisplay();
        this.updateLiveDelayDisplay();
      }
    };

    tabEffects?.addEventListener("click", () => switchView("effects"));
    tabControls?.addEventListener("click", () => switchView("controls"));

    // 2. Preset Navigator (Prev, Next, Picker)
    const prevPresetBtn = document.getElementById("prevPresetBtn");
    const nextPresetBtn = document.getElementById("nextPresetBtn");
    const presetDisplayBtn = document.getElementById("presetDisplayBtn");
    const presetPickerModal = document.getElementById("presetPickerModal");
    const closePresetPickerBtn = document.getElementById("closePresetPickerBtn");
    const presetSearchInput = document.getElementById("presetSearchInput");

    prevPresetBtn?.addEventListener("click", () => {
      const targetId = (this.activePresetId - 1 + 80) % 80;
      this.loadPreset(targetId);
    });

    nextPresetBtn?.addEventListener("click", () => {
      const targetId = (this.activePresetId + 1) % 80;
      this.loadPreset(targetId);
    });

    presetDisplayBtn?.addEventListener("click", () => {
      if (presetPickerModal) {
        this.renderPresetPickerGrid("");
        presetPickerModal.style.display = "flex";
        if (presetSearchInput) {
          presetSearchInput.value = "";
          setTimeout(() => presetSearchInput.focus(), 100);
        }
      }
    });

    closePresetPickerBtn?.addEventListener("click", () => {
      if (presetPickerModal) presetPickerModal.style.display = "none";
    });

    presetPickerModal?.addEventListener("click", (e) => {
      if (e.target === presetPickerModal) presetPickerModal.style.display = "none";
    });

    presetSearchInput?.addEventListener("input", (e) => {
      this.renderPresetPickerGrid(e.target.value.trim().toLowerCase());
    });

    // 3. Preset Volume Buttons (+ and -) with Hold-to-Repeat
    const volMinusBtn = document.getElementById("volMinusBtn");
    const volPlusBtn = document.getElementById("volPlusBtn");

    const bindVolumeRepeat = (btn, delta) => {
      if (!btn) return;
      const startRepeat = (e) => {
        e.preventDefault();
        this.adjustVolume(delta);
        this.stopVolumeRepeat();
        this.volumeRepeatTimer = setTimeout(() => {
          this.volumeRepeatInterval = setInterval(() => {
            this.adjustVolume(delta);
          }, 80);
        }, 280);
      };

      const stopRepeat = (e) => {
        this.stopVolumeRepeat();
      };

      btn.addEventListener("pointerdown", startRepeat);
      btn.addEventListener("pointerup", stopRepeat);
      btn.addEventListener("pointerleave", stopRepeat);
      btn.addEventListener("pointercancel", stopRepeat);
    };

    bindVolumeRepeat(volMinusBtn, -2);
    bindVolumeRepeat(volPlusBtn, 2);

    // 4. Dotted Delay Footswitch Button
    const dottedDelayBtn = document.getElementById("dottedDelayBtn");
    dottedDelayBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      this.toggleDottedEighth();
    });

    // 5. Tap Tempo Footswitch Button
    const liveTapTempoBtn = document.getElementById("liveTapTempoBtn");
    liveTapTempoBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      this.handleTapTempo();
    });

    // 6. Settings Modal (Choose up to 3 effects)
    const settingsBtn = document.getElementById("settingsBtn");
    const effectsConfigModal = document.getElementById("effectsConfigModal");
    const closeEffectsConfigBtn = document.getElementById("closeEffectsConfigBtn");

    settingsBtn?.addEventListener("click", () => {
      this.renderEffectsSelectionList();
      if (effectsConfigModal) effectsConfigModal.style.display = "flex";
    });

    closeEffectsConfigBtn?.addEventListener("click", () => {
      if (effectsConfigModal) effectsConfigModal.style.display = "none";
      this.renderLiveEffects();
    });

    effectsConfigModal?.addEventListener("click", (e) => {
      if (e.target === effectsConfigModal) {
        effectsConfigModal.style.display = "none";
        this.renderLiveEffects();
      }
    });

    // 7. Save Preset Button
    const savePresetBtn = document.getElementById("savePresetBtn");
    savePresetBtn?.addEventListener("click", () => this.saveCurrentPreset());
  }

  // =========================================================
  // LIVE STOMPBOXES (VISTA 1)
  // =========================================================

  renderLiveEffects() {
    const container = document.getElementById("stompboxesContainer");
    if (!container) return;
    container.innerHTML = "";

    this.selectedEffects.forEach((blockId) => {
      const blockKey = Object.keys(this.BLOCKS).find(
        (k) => this.BLOCKS[k].id === blockId,
      );
      if (blockKey === undefined) return;
      const block = this.BLOCKS[blockKey];
      const isOn = !!this.currentState.modulesOn[block.id];
      const modelId = this.currentState.models[block.id] || 0;
      const modelName = block.modelNames[modelId] || block.label;

      const card = document.createElement("div");
      card.className = `stompbox-card ${isOn ? "active" : ""}`;
      card.dataset.block = block.id;

      card.innerHTML = `
        <div class="stomp-header">
          <span class="stomp-label">${block.label}</span>
          <span class="stomp-model-name">${modelName}</span>
        </div>

        <div class="stomp-led-wrap">
          <div class="stomp-led"></div>
        </div>

        <div class="stomp-icon-box">
          <svg viewBox="0 0 92 80">
            <use href="#icon-${block.id}"></use>
          </svg>
        </div>

        <div class="stomp-switch-foot">
          <div class="stomp-metal-switch"></div>
          <span class="stomp-status-tag">${isOn ? "ACTIVO" : "BYPASS"}</span>
        </div>
      `;

      card.addEventListener("click", async (e) => {
        e.preventDefault();
        const currentIsOn = !!this.currentState.modulesOn[block.id];
        const nextState = !currentIsOn;

        // Instant visual response with zero perceived lag
        this.currentState.modulesOn[block.id] = nextState;
        card.classList.toggle("active", nextState);
        const tag = card.querySelector(".stomp-status-tag");
        if (tag) tag.textContent = nextState ? "ACTIVO" : "BYPASS";

        await this.toggleModule(block.toggleAddr, nextState);
      });

      container.appendChild(card);
    });
  }

  // =========================================================
  // VOLUME & DELAY LOGIC (VISTA 2)
  // =========================================================

  adjustVolume(delta) {
    let currentVol =
      this.currentState.volume !== undefined ? this.currentState.volume : 50;
    let newVol = Math.max(0, Math.min(100, currentVol + delta));

    if (newVol !== this.currentState.volume) {
      this.currentState.volume = newVol;
      this.updateLiveVolumeDisplay();
      this.changeKnob(0, newVol);
      this.registerEdit();
    }
  }

  stopVolumeRepeat() {
    if (this.volumeRepeatTimer) {
      clearTimeout(this.volumeRepeatTimer);
      this.volumeRepeatTimer = null;
    }
    if (this.volumeRepeatInterval) {
      clearInterval(this.volumeRepeatInterval);
      this.volumeRepeatInterval = null;
    }
  }

  updateLiveVolumeDisplay() {
    const vol =
      this.currentState.volume !== undefined ? this.currentState.volume : 50;
    const valueEl = document.getElementById("volumeValueDisplay");
    const barFillEl = document.getElementById("volumeBarFill");

    if (valueEl) valueEl.textContent = vol;
    if (barFillEl) barFillEl.style.width = `${vol}%`;
  }

  getDelayRange(modelId) {
    // Dual Delay is modelId === 3 (50ms to 500ms)
    if (modelId === 3) {
      return { minMs: 50, maxMs: 500 };
    } else {
      // Other Delays: Analog, Duck, Dtape, Lofi (100ms to 1000ms)
      return { minMs: 100, maxMs: 1000 };
    }
  }

  toggleDottedEighth() {
    this.isDottedEighth = !this.isDottedEighth;
    this.applyDelayCalculation();
  }

  applyDelayCalculation() {
    const block = this.BLOCKS[3]; // dly
    const currentModelId = this.currentState.models.dly || 0;
    const { minMs, maxMs } = this.getDelayRange(currentModelId);

    const currentVal = this.currentState.knobs.dly
      ? this.currentState.knobs.dly[block.knobStart] ?? 50
      : 50;
    const currentMs = Math.round(minMs + (currentVal / 100) * (maxMs - minMs));

    if (!this.baseBpm || this.baseBpm < 30 || this.baseBpm > 300) {
      const prevMultiplier = !this.isDottedEighth ? 0.75 : 1.0;
      let inferred = (60 * 1000) / (currentMs / prevMultiplier);
      this.baseBpm = Math.max(40, Math.min(260, Math.round(inferred * 2) / 2));
    }

    const multiplier = this.isDottedEighth ? 0.75 : 1.0;
    let targetMs = ((60 * 1000) / this.baseBpm) * multiplier;
    if (targetMs > maxMs) targetMs = maxMs;
    if (targetMs < minMs) targetMs = minMs;

    let sliderValue = Math.round(
      ((targetMs - minMs) / (maxMs - minMs)) * 100,
    );
    sliderValue = Math.max(0, Math.min(100, sliderValue));

    if (!this.currentState.knobs.dly) this.currentState.knobs.dly = {};
    this.currentState.knobs.dly[block.knobStart] = sliderValue;

    this.changeKnob(block.knobStart, sliderValue);
    this.registerEdit();
    this.updateLiveDelayDisplay();
    this.startBeatIndicator(this.baseBpm);
  }

  handleTapTempo() {
    const now = Date.now();
    clearTimeout(this.tapTimeout);
    this.tapTimestamps.push(now);
    if (this.tapTimestamps.length > 4) this.tapTimestamps.shift();

    if (this.tapTimestamps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < this.tapTimestamps.length; i++) {
        intervals.push(this.tapTimestamps[i] - this.tapTimestamps[i - 1]);
      }
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avg > 200 && avg < 3000) {
        let bpm = (60 * 1000) / avg;
        bpm = Math.max(40, Math.min(260, Math.round(bpm * 2) / 2));
        this.baseBpm = bpm;
        this.applyDelayCalculation();
      }
    }

    this.tapTimeout = setTimeout(() => {
      this.tapTimestamps = [];
    }, 2000);
  }

  startBeatIndicator(bpm) {
    if (this.beatIntervalId) clearInterval(this.beatIntervalId);
    if (!bpm || bpm <= 0 || bpm > 300) return;
    const dot = document.getElementById("tapIndicatorDot");
    if (!dot) return;

    const intervalMs = (60 * 1000) / bpm;
    this.beatIntervalId = setInterval(() => {
      dot.classList.add("flash");
      setTimeout(() => dot.classList.remove("flash"), 90);
    }, intervalMs);
  }

  updateLiveDelayDisplay() {
    const block = this.BLOCKS[3]; // dly
    const currentModelId = this.currentState.models.dly || 0;
    const { minMs, maxMs } = this.getDelayRange(currentModelId);
    const currentVal = this.currentState.knobs.dly
      ? this.currentState.knobs.dly[block.knobStart] ?? 50
      : 50;
    const currentMs = Math.round(minMs + (currentVal / 100) * (maxMs - minMs));

    const msEl = document.getElementById("delayTimeMsDisplay");
    const bpmEl = document.getElementById("delayBpmDisplay");
    const badgeEl = document.getElementById("delayModelBadge");
    const dottedBtn = document.getElementById("dottedDelayBtn");
    const dottedLabel = document.getElementById("dottedStatusLabel");

    if (msEl) msEl.textContent = `${currentMs}ms`;
    if (bpmEl && this.baseBpm)
      bpmEl.textContent = `${this.baseBpm.toFixed(1)} BPM`;

    const modelName = block.modelNames[currentModelId] || "Delay";
    if (badgeEl) badgeEl.textContent = modelName.toUpperCase();

    if (dottedBtn) {
      if (this.isDottedEighth) {
        dottedBtn.classList.add("active");
        if (dottedLabel) dottedLabel.textContent = "ACTIVO (1/8.)";
      } else {
        dottedBtn.classList.remove("active");
        if (dottedLabel) dottedLabel.textContent = "DESACTIVADO (1/4)";
      }
    }
  }

  // =========================================================
  // EFFECTS CONFIGURATION MODAL (MAX 3)
  // =========================================================

  renderEffectsSelectionList() {
    const container = document.getElementById("effectsSelectionList");
    if (!container) return;
    container.innerHTML = "";

    const allBlocks = [
      { id: "fx", name: "FX (Gate / Comp / Boost)" },
      { id: "amp", name: "AMP (Amplificador)" },
      { id: "mod", name: "MOD (Chorus / Phaser / Trem)" },
      { id: "dly", name: "DLY (Delay)" },
      { id: "rev", name: "REV (Reverb)" },
      { id: "cab", name: "CAB (Gabinete IR)" },
    ];

    allBlocks.forEach((b) => {
      const isSelected = this.selectedEffects.includes(b.id);
      const item = document.createElement("div");
      item.className = `effect-select-item ${isSelected ? "selected" : ""}`;
      item.innerHTML = `
        <span class="effect-select-name">${b.name}</span>
        <span class="effect-select-check">✔</span>
      `;

      item.addEventListener("click", () => {
        if (this.selectedEffects.includes(b.id)) {
          if (this.selectedEffects.length <= 1) {
            alert("Debes mantener al menos 1 efecto seleccionado.");
            return;
          }
          this.selectedEffects = this.selectedEffects.filter((id) => id !== b.id);
        } else {
          if (this.selectedEffects.length >= 3) {
            // Replaces the first one or prompts
            this.selectedEffects.shift();
          }
          this.selectedEffects.push(b.id);
        }

        try {
          localStorage.setItem(
            "blackbox_live_effects",
            JSON.stringify(this.selectedEffects),
          );
        } catch {}

        this.renderEffectsSelectionList();
      });

      container.appendChild(item);
    });
  }

  // =========================================================
  // PRESET PICKER MODAL (80 PRESETS)
  // =========================================================

  renderPresetPickerGrid(filterQuery = "") {
    const grid = document.getElementById("presetGridContainer");
    if (!grid) return;
    grid.innerHTML = "";

    for (let i = 0; i < 80; i++) {
      const pName = this.presetNames[i] || `Preset ${i + 1}`;
      const pNumStr = `P${(i + 1).toString().padStart(2, "0")}`;
      const searchTarget = `${pNumStr} ${pName}`.toLowerCase();

      if (filterQuery && !searchTarget.includes(filterQuery)) continue;

      const item = document.createElement("div");
      item.className = `preset-grid-item ${i === this.activePresetId ? "active" : ""}`;
      item.dataset.presetId = i;
      item.innerHTML = `
        <div class="preset-grid-num">${pNumStr}</div>
        <div class="preset-grid-title">${pName}</div>
      `;

      item.addEventListener("click", () => {
        this.loadPreset(i);
        const modal = document.getElementById("presetPickerModal");
        if (modal) modal.style.display = "none";
      });

      grid.appendChild(item);
    }
  }

  // =========================================================
  // LOG PANEL & MANUAL COMMANDS
  // =========================================================

  initLogPanel() {
    this.logPanel = document.getElementById("logPanel");
    this.logToggle = document.getElementById("logToggle");
    this.logContent = document.getElementById("logContent");

    document.getElementById("clearLogBtn")?.addEventListener("click", () => {
      if (this.logContent) this.logContent.innerHTML = "";
    });

    document.getElementById("closeLogDrawerBtn")?.addEventListener("click", () => {
      if (this.logPanel) this.logPanel.style.display = "none";
    });

    this.logToggle?.addEventListener("click", () => {
      if (this.logPanel) {
        const isVisible = this.logPanel.style.display === "flex";
        this.logPanel.style.display = isVisible ? "none" : "flex";
      }
    });

    const verboseToggle = document.getElementById("verboseLogToggle");
    if (verboseToggle) {
      verboseToggle.addEventListener("change", (e) => {
        this.isLoggingEnabled = e.target.checked;
      });
    }

    const pausePollingToggle = document.getElementById("pausePollingToggle");
    if (pausePollingToggle) {
      pausePollingToggle.addEventListener("change", (e) => {
        this.isPollingPaused = e.target.checked;
      });
    }

    document
      .getElementById("sendManualCommandBtn")
      ?.addEventListener("click", () => this.sendManualCommand());

    document
      .getElementById("manualCommandInput")
      ?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.sendManualCommand();
      });
  }

  log(message, type = "info", isVerbose = false) {
    if (isVerbose && !this.isLoggingEnabled) return;
    if (!this.logContent) return;

    const entry = document.createElement("div");
    entry.className = `log-entry log-${type}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${message}`;

    if (type === "error") entry.style.color = "#ff5252";
    else if (type === "sent") entry.style.color = "#00e5ff";
    else if (type === "success") entry.style.color = "#00e676";
    else entry.style.color = "#b0b8d0";

    this.logContent.appendChild(entry);
    this.logContent.scrollTop = this.logContent.scrollHeight;
  }

  // =========================================================
  // Checksum algorithm & Helpers
  // =========================================================

  calculateChecksum(payload) {
    let sum = 0;
    for (let i = 4; i < payload.length - 1; i++) sum += payload[i];
    return 0xff - (sum % 256);
  }

  buildPacket(hexString) {
    let bytes = hexString
      .replace(/\s/g, "")
      .match(/.{1,2}/g)
      .map((byte) => parseInt(byte, 16));
    let payload = new Uint8Array(bytes);
    payload[payload.length - 1] = this.calculateChecksum(payload);
    return payload;
  }

  bufToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
      .join(" ");
  }

  encodeSysEx(data) {
    let encoded = [];
    let accum = 0;
    let bitNum = 0;
    for (let i = 0; i < data.length; i++) {
      accum |= data[i] << bitNum;
      bitNum += 8;
      while (bitNum >= 7) {
        encoded.push(accum & 0x7f);
        accum >>= 7;
        bitNum -= 7;
      }
    }
    encoded.push(accum & 0x7f);
    return encoded;
  }

  decodeSysEx(encoded) {
    let decoded = [];
    let accum = 0;
    let bitNum = 0;
    for (let i = 0; i < encoded.length; i++) {
      accum |= encoded[i] << bitNum;
      bitNum += 7;
      if (bitNum >= 8) {
        decoded.push(accum & 0xff);
        accum >>= 8;
        bitNum -= 8;
      }
    }
    return decoded;
  }

  async sendManualCommand() {
    const input = document.getElementById("manualCommandInput");
    if (!input || !input.value.trim()) return;

    try {
      const packet = this.buildPacket(input.value.trim());
      this.log(`Manual Command -> ${this.bufToHex(packet)}`, "sent");
      await this.sendCommand(packet);
      input.value = "";
    } catch (e) {
      this.log(`Manual Command Failed: ${e.message}`, "error");
    }
  }

  async sendCommand(payload) {
    if (!this.isConnected) return;
    try {
      this.log(`[OUT | RAW] ${this.bufToHex(payload)}`, "sent", true);
      if (this.connectionType === "usb" && this.midiOutput) {
        const encoded = this.encodeSysEx(payload);
        const sysex = new Uint8Array([0xf0, ...encoded, 0xf7]);
        this.log(`[OUT | SYSEX] ${this.bufToHex(sysex)}`, "sent", true);
        this.midiOutput.send(sysex);
      } else if (this.connectionType === "ble" && this.writeCharacteristic) {
        await this.writeCharacteristic.writeValueWithoutResponse(payload);
      }
    } catch (err) {
      this.log(`Error sending command: ${err.message}`, "error");
    }
  }

  // =========================================================
  // CONNECTION LOGIC (BLE / USB MIDI)
  // =========================================================

  async connectBLE() {
    try {
      this.log("Requesting Bluetooth Device...", "info");
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "BlackBox" }, { namePrefix: "M-VAVE" }],
        optionalServices: [this.SERVICE_UUID],
      });

      this.device.addEventListener("gattserverdisconnected", () =>
        this.handleDisconnect(),
      );

      this.log("Connecting to GATT Server...", "info");
      this.server = await this.device.gatt.connect();

      this.log("Getting Service...", "info");
      const service = await this.server.getPrimaryService(this.SERVICE_UUID);

      this.log("Getting Characteristics...", "info");
      this.writeCharacteristic = await service.getCharacteristic(
        this.WRITE_CHAR_UUID,
      );
      this.notifyCharacteristic = await service.getCharacteristic(
        this.NOTIFY_CHAR_UUID,
      );

      this.log("Starting Notifications...", "info");
      await this.notifyCharacteristic.startNotifications();
      this.notifyCharacteristic.addEventListener(
        "characteristicvaluechanged",
        (event) => this.handleIncomingData(event),
      );

      this.isConnected = true;
      this.connectionType = "ble";
      this.updateUI();
      this.log("Connected to BlackBox via BLE!", "success");

      await this.startHandshake();
    } catch (error) {
      this.log(`BLE Connection failed: ${error.message}`, "error");
      this.handleDisconnect();
    }
  }

  async connect() {
    try {
      this.log("Searching for USB MIDI devices...", "info");
      if (!navigator.requestMIDIAccess) {
        this.log("Web MIDI API not supported. Falling back to BLE.", "info");
        return this.connectBLE();
      }

      const midiAccess = await navigator.requestMIDIAccess({ sysex: true });
      const inputs = Array.from(midiAccess.inputs.values());
      const outputs = Array.from(midiAccess.outputs.values());

      if (inputs.length === 0 || outputs.length === 0) {
        this.log(
          "No complete USB MIDI devices found. Falling back to BLE.",
          "info",
        );
        return this.connectBLE();
      }

      const deviceMap = new Map();
      inputs.forEach((input) => {
        const name = input.name || "Unknown Input";
        if (!deviceMap.has(name))
          deviceMap.set(name, {
            input: null,
            output: null,
            inputName: name,
            outputName: "",
          });
        deviceMap.get(name).input = input;
      });

      outputs.forEach((output) => {
        const name = output.name || "Unknown Output";
        let foundMatch = false;
        for (const [key, device] of deviceMap.entries()) {
          if (key === name || name.startsWith(key.split(" ")[0])) {
            device.output = output;
            device.outputName = name;
            foundMatch = true;
            break;
          }
        }
        if (!foundMatch)
          deviceMap.set(name, {
            input: null,
            output: output,
            inputName: "",
            outputName: name,
          });
      });

      const pairs = Array.from(deviceMap.values())
        .filter((pair) => pair.input && pair.output)
        .map((pair) => ({
          input: pair.input,
          output: pair.output,
          inputName: pair.inputName,
          outputName: pair.outputName,
          name: pair.inputName || pair.outputName,
        }));

      if (pairs.length === 0) {
        this.log("No paired USB MIDI found. Falling back to BLE.", "info");
        return this.connectBLE();
      }

      // Show USB modal so user can choose USB device or Cancel (Use BLE)
      const modal = document.getElementById("usbMidiModal");
      const list = document.getElementById("usbDeviceList");
      const confirmBtn = document.getElementById("confirmUsbBtn");
      if (!modal || !list || !confirmBtn) return this.finalizeUsbConnection(pairs[0]);

      list.innerHTML = "";
      confirmBtn.disabled = true;
      pairs.forEach((pair, index) => {
        const row = document.createElement("div");
        row.style.padding = "10px";
        row.style.cursor = "pointer";
        row.style.borderRadius = "4px";
        row.style.border = "1px solid #333";
        row.style.marginBottom = "6px";
        row.textContent = pair.input.name || `Device ${index + 1}`;
        row.onclick = () => {
          Array.from(list.children).forEach((c) => (c.style.background = "transparent"));
          row.style.background = "#2a3550";
          confirmBtn.disabled = false;
          confirmBtn.onclick = () => {
            modal.style.display = "none";
            this.finalizeUsbConnection(pair);
          };
        };
        list.appendChild(row);
        // Auto-select first option for convenience
        if (index === 0) row.click();
      });

      modal.style.display = "flex";
    } catch (e) {
      this.log(`Error checking USB MIDI: ${e.message}. Using BLE.`, "info");
      return this.connectBLE();
    }
  }

  cancelUsbConnection() {
    const modal = document.getElementById("usbMidiModal");
    if (modal) modal.style.display = "none";
    this.connectBLE();
  }

  async finalizeUsbConnection(devicePair) {
    try {
      this.midiInput = devicePair.input;
      this.midiOutput = devicePair.output;
      this.midiInput.onmidimessage = (e) => this.handleMidiMessage(e);

      this.isConnected = true;
      this.connectionType = "usb";
      this.updateUI();
      this.log(`Connected via USB MIDI: ${devicePair.input.name}`, "success");

      await this.startHandshake();
    } catch (e) {
      this.log(`USB connection failed: ${e.message}`, "error");
      this.handleDisconnect();
    }
  }

  async disconnect() {
    if (this.connectionType === "usb") {
      if (this.midiInput) this.midiInput.onmidimessage = null;
      this.midiInput = null;
      this.midiOutput = null;
      this.handleDisconnect();
    } else {
      if (this.device && this.device.gatt.connected) {
        this.device.gatt.disconnect();
      } else {
        this.handleDisconnect();
      }
    }
  }

  handleDisconnect() {
    this.isConnected = false;
    this.syncState = "IDLE";
    if (this.handshakeRetryTimer) clearTimeout(this.handshakeRetryTimer);
    this.setModified(false);
    this.updateUI();
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) overlay.style.display = "none";
    this.log("Disconnected from BlackBox.", "error");
  }

  async startHandshake() {
    if (this.handshakeRetryTimer) clearTimeout(this.handshakeRetryTimer);
    this.syncState = "READING_AMPS";
    this.rxBuffer = [];
    this.handshakeRetries = 0;

    const overlay = document.getElementById("loadingOverlay");
    const text = document.getElementById("loadingText");
    if (overlay) overlay.style.display = "flex";
    if (text) text.innerText = "Cargando amplificadores...";

    this.log("Handshake: Solicitando nombres de amplificadores...", "sent");
    await this.sendCommand(
      this.buildPacket("00 59 23 08 00 00 05 00 00 00 90 18 01 00 00"),
    );

    this.scheduleHandshakeRetry();
  }

  scheduleHandshakeRetry() {
    if (this.handshakeRetryTimer) clearTimeout(this.handshakeRetryTimer);
    this.handshakeRetryTimer = setTimeout(async () => {
      if (!this.isConnected || this.syncState === "READY") return;
      this.handshakeRetries = (this.handshakeRetries || 0) + 1;

      if (this.handshakeRetries <= 3) {
        this.log(
          `Sin respuesta en ${this.syncState}, reintentando (${this.handshakeRetries}/3)...`,
          "info",
        );
        this.rxBuffer = [];
        if (this.syncState === "READING_AMPS") {
          await this.sendCommand(
            this.buildPacket("00 59 23 08 00 00 05 00 00 00 90 18 01 00 00"),
          );
        } else if (this.syncState === "READING_CABS") {
          await this.sendCommand(
            this.buildPacket("00 59 23 08 00 00 05 00 00 00 80 18 01 00 00"),
          );
        }
        this.scheduleHandshakeRetry();
      } else {
        this.log(
          "El dispositivo tardó demasiado en enviar los nombres. Puedes omitir o verificar que no esté conectado a otra app.",
          "error",
        );
        const subText = document.getElementById("loadingSubText");
        if (subText) {
          subText.innerText =
            "El pedal no responde al handshake. Si estás por USB y otra app (o pestaña) usa el puerto MIDI, ciérrala o pulsa Omitir.";
          subText.style.color = "#ff9800";
        }
      }
    }, 2200);
  }

  async skipHandshake() {
    if (this.handshakeRetryTimer) clearTimeout(this.handshakeRetryTimer);
    this.log("Handshake omitido manualmente. Iniciando sincronización...", "info");
    await this.finishHandshake();
  }

  async finishHandshake() {
    if (this.handshakeRetryTimer) clearTimeout(this.handshakeRetryTimer);
    this.syncState = "READY";
    this.rxBuffer = [];
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) overlay.style.display = "none";

    if (this.pollingInterval) clearInterval(this.pollingInterval);
    this.pollingInterval = setInterval(() => {
      if (this.isConnected && !this.isPollingPaused) {
        this.requestCurrentPresetId();
        setTimeout(() => {
          if (this.isConnected && !this.isPollingPaused) {
            this.requestRamDump();
          }
        }, 250);
      }
    }, 2500);

    await this.requestCurrentPresetId();
    await this.requestRamDump();
    this.renderLiveEffects();
    this.log("Sincronización con Blackbox lista!", "success");
  }

  async processHandshakeBlock() {
    const extractedNames = this.decodeNamesBlock(this.rxBuffer);

    if (extractedNames.length >= 20) {
      if (this.syncState === "READING_AMPS") {
        this.BLOCKS[1].modelNames = extractedNames.slice(0, 20);
        this.syncState = "READING_CABS";
        this.rxBuffer = [];
        this.handshakeRetries = 0;
        const text = document.getElementById("loadingText");
        if (text) text.innerText = "Cargando cabinas...";

        await this.sendCommand(
          this.buildPacket("00 59 23 08 00 00 05 00 00 00 80 18 01 00 00"),
        );
        this.scheduleHandshakeRetry();
      } else if (this.syncState === "READING_CABS") {
        this.BLOCKS[5].modelNames = extractedNames.slice(0, 20);
        await this.finishHandshake();
      }
    }
  }

  decodeNamesBlock(byteArray) {
    let names = [],
      currentName = "";
    for (let b of byteArray) {
      if (b === 0x00) {
        if (currentName.trim().length > 0) {
          names.push(currentName.replace(/^\d+/, ""));
          currentName = "";
        }
      } else if (b >= 32 && b <= 126) {
        currentName += String.fromCharCode(b);
      }
    }
    return names;
  }

  handleMidiMessage(event) {
    const data = event.data;
    if (data[0] === 0xf0 && data[data.length - 1] === 0xf7) {
      this.log(`[IN | USB SYSEX] ${this.bufToHex(data)}`, "received", true);
      this.processCompleteSysEx(data);
    } else if (data[0] === 0xf0) {
      this.log(
        `[IN | USB SYSEX FRAGMENT START] ${this.bufToHex(data)}`,
        "info",
        true,
      );
      this.usbMidiBuffer = new Uint8Array(data);
    } else if (this.usbMidiBuffer) {
      const combined = new Uint8Array(this.usbMidiBuffer.length + data.length);
      combined.set(this.usbMidiBuffer);
      combined.set(data, this.usbMidiBuffer.length);
      this.usbMidiBuffer = combined;
      if (data[data.length - 1] === 0xf7) {
        this.log(
          `[IN | USB SYSEX FRAGMENT END] ${this.bufToHex(data)}`,
          "info",
          true,
        );
        const completeData = this.usbMidiBuffer;
        this.usbMidiBuffer = null;
        this.log(
          `[IN | USB SYSEX REASSEMBLED] ${this.bufToHex(completeData)}`,
          "received",
          true,
        );
        this.processCompleteSysEx(completeData);
      } else {
        this.log(
          `[IN | USB SYSEX FRAGMENT MIDDLE] ${this.bufToHex(data)}`,
          "info",
          true,
        );
      }
    }
  }

  processCompleteSysEx(data) {
    const encoded = data.slice(1, -1);
    const decodedArray = this.decodeSysEx(encoded);
    const decoded = new Uint8Array(decodedArray);
    this.handleIncomingData({ target: { value: { buffer: decoded.buffer } } });
  }

  handleIncomingData(event) {
    const value = event.target.value;
    const bytes = new Uint8Array(value.buffer || value);

    if (this.isLoggingEnabled) {
      this.log(`RX: ${this.bufToHex(bytes)}`, "info", true);
    }

    // --- DEVICE ACKNOWLEDGMENT (ACK) ---
    if (
      (bytes.length === 8 && bytes[3] === 0x01 && bytes[7] === 0xff) ||
      (bytes[2] === 0x24 && bytes.length === 16 && bytes[10] === 0xe0)
    ) {
      if (this.pendingSaveResolve) {
        clearTimeout(this.saveTimeoutId);
        this.pendingSaveResolve(true);
        this.pendingSaveResolve = null;
        this.pendingSaveReject = null;
        this.saveTimeoutId = null;
        this.log("Save Acknowledged by Device", "success");
      }
      return;
    }

    // --- HANDSHAKE STREAM ---
    if (
      this.syncState === "READING_AMPS" ||
      this.syncState === "READING_CABS"
    ) {
      let payload =
        bytes.length >= 14 && bytes[0] === 0x00 && bytes[1] === 0x59
          ? bytes.slice(14)
          : bytes;
      this.rxBuffer.push(...payload);
      this.processHandshakeBlock();
      return;
    }

    // Hardware Preset ID Packet
    if (bytes.length === 19 && bytes[10] === 0x20 && bytes[11] === 0x04) {
      const activePresetId = bytes[14];
      this.activePresetId = activePresetId;

      const patchNumEl = document.getElementById("patchNumber");
      const patchNameEl = document.getElementById("patchName");
      const expectedP = `P${(activePresetId + 1).toString().padStart(2, "0")}`;

      if (patchNumEl && patchNumEl.textContent !== expectedP) {
        patchNumEl.textContent = expectedP;
        if (patchNameEl) {
          patchNameEl.textContent =
            this.presetNames[activePresetId] || `Preset ${activePresetId + 1}`;
        }
        this.setModified(false);
      }
      return;
    }

    // RAM Dump Packet (107 bytes)
    if (
      this.syncState === "READY" &&
      bytes.length === 107 &&
      bytes[1] === 89 &&
      bytes[2] === 35
    ) {
      if (this.lastUiEditTime && Date.now() - this.lastUiEditTime < 1200) {
        return;
      }
      this.parseRamDump(bytes);
    }
  }

  async requestRamDump() {
    if (!this.isConnected) return;
    await this.sendCommand(
      this.buildPacket("00 59 23 08 00 00 04 00 00 00 10 5C 00 00 00"),
    );
  }

  parseRamDump(dump) {
    const data = dump.slice(14, 106);
    const currentDumpHex = Array.from(data).join("-");

    if (this.lastDumpHex === currentDumpHex) return;
    this.lastDumpHex = currentDumpHex;

    this.currentRawData = new Uint8Array(data);

    this.currentState = {
      volume: data[0],
      routing: [data[2], data[3], data[4], data[5], data[6], data[7]],
      modulesOn: {
        fx: data[8] === 1,
        amp: data[9] === 1,
        mod: data[10] === 1,
        dly: data[11] === 1,
        rev: data[12] === 1,
        cab: data[13] === 1,
      },
      models: {
        fx: data[14],
        amp: data[15],
        mod: data[16],
        dly: data[17],
        rev: data[18],
        cab: data[19],
      },
      knobs: {},
    };

    Object.keys(this.BLOCKS).forEach((key) => {
      const block = this.BLOCKS[key];
      this.currentState.knobs[block.id] = {};
      for (let i = 0; i < 6; i++) {
        const addr = block.knobStart + i * 2;
        this.currentState.knobs[block.id][addr] = data[addr];
      }
    });

    if (this.currentView === "effects") {
      this.renderLiveEffects();
    } else {
      this.updateLiveVolumeDisplay();
      this.updateLiveDelayDisplay();
    }
  }

  async requestCurrentPresetId() {
    if (!this.isConnected) return;
    const cmdHex = "00 59 23 08 00 00 04 00 00 00 20 04 00 00 00";
    await this.sendCommand(this.buildPacket(cmdHex));
  }

  async loadPreset(presetId) {
    if (!this.isConnected) return;
    this.log(
      `Cargando Preset: P${(presetId + 1).toString().padStart(2, "0")}`,
      "sent",
    );
    this.lastUiEditTime = Date.now();
    this.setModified(false);

    const idHex = presetId.toString(16).padStart(2, "0");
    const cmdHex = `00 59 22 09 00 00 04 ${idHex} 00 00 E0 01 00 00 01 00`;

    try {
      await this.sendCommand(this.buildPacket(cmdHex));
      this.activePresetId = presetId;
      const patchNumEl = document.getElementById("patchNumber");
      const patchNameEl = document.getElementById("patchName");
      if (patchNumEl)
        patchNumEl.textContent = `P${(presetId + 1).toString().padStart(2, "0")}`;
      if (patchNameEl)
        patchNameEl.textContent =
          this.presetNames[presetId] || `Preset ${presetId + 1}`;
      setTimeout(async () => {
        await this.requestRamDump();
      }, 350);
    } catch (err) {
      this.log(`Error al cambiar preset: ${err.message}`, "error");
    }
  }

  async savePresetToSlot(presetId, presetData) {
    if (!this.isConnected || !presetData || presetData.length !== 92) return;

    const address = presetId * 92;
    const addrL = address & 0xff;
    const addrH = (address >> 8) & 0xff;

    const header = new Uint8Array([
      0x00,
      0x59,
      0x22,
      0x64,
      0x00,
      0x00,
      0x04,
      addrL,
      addrH,
      0x00,
      0x00,
      0x5c,
      0x00,
      0x00,
    ]);

    const payload = new Uint8Array(107);
    payload.set(header, 0);
    payload.set(presetData, 14);
    payload[106] = this.calculateChecksum(payload);

    return new Promise(async (resolve, reject) => {
      this.pendingSaveResolve = resolve;
      this.pendingSaveReject = reject;
      this.saveTimeoutId = setTimeout(() => {
        if (this.pendingSaveReject) {
          this.pendingSaveReject(
            new Error("Timeout al guardar en memoria flash"),
          );
          this.pendingSaveResolve = null;
          this.pendingSaveReject = null;
        }
      }, 3000);

      try {
        await this.sendCommand(payload);
      } catch (error) {
        clearTimeout(this.saveTimeoutId);
        this.pendingSaveResolve = null;
        this.pendingSaveReject = null;
        reject(error);
      }
    });
  }

  async saveCurrentPreset() {
    if (!this.isConnected) return;
    const saveBtn = document.getElementById("savePresetBtn");
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "GUARDANDO...";
    }

    try {
      await this.savePresetToSlot(this.activePresetId, this.currentRawData);
      this.setModified(false);
      this.log(
        `Preset guardado en P${(this.activePresetId + 1).toString().padStart(2, "0")}!`,
        "success",
      );

      if (saveBtn) {
        saveBtn.textContent = "GUARDADO!";
        setTimeout(() => {
          saveBtn.textContent = "💾 GUARDAR";
          saveBtn.disabled = true;
        }, 1500);
      }
    } catch (err) {
      this.log(`Error al guardar: ${err.message}`, "error");
      if (saveBtn) {
        saveBtn.textContent = "ERROR";
        setTimeout(() => {
          saveBtn.textContent = "💾 GUARDAR";
          saveBtn.disabled = false;
        }, 2000);
      }
    }
  }

  setModified(isMod) {
    this.isModified = isMod;
    const saveBtn = document.getElementById("savePresetBtn");
    const nameEl = document.getElementById("patchName");

    if (saveBtn) {
      saveBtn.disabled = !this.isConnected || !isMod;
    }

    if (nameEl) {
      if (isMod && !nameEl.textContent.endsWith("*")) {
        nameEl.textContent += "*";
      } else if (!isMod && nameEl.textContent.endsWith("*")) {
        nameEl.textContent = nameEl.textContent.slice(0, -1);
      }
    }
  }

  registerEdit() {
    this.lastUiEditTime = Date.now();
    this.setModified(true);
  }

  async toggleModule(toggleAddr, isEnabled) {
    if (!this.isConnected) return;
    this.registerEdit();
    if (this.currentRawData) this.currentRawData[toggleAddr] = isEnabled ? 1 : 0;

    const cmdHex = `00 59 22 09 00 00 04 ${toggleAddr.toString(16).padStart(2, "0")} 00 00 10 01 00 00 ${isEnabled ? "01" : "00"} 00`;
    await this.sendCommand(this.buildPacket(cmdHex));
  }

  async changeKnob(addressDecimal, value) {
    if (!this.isConnected) return;
    this.registerEdit();
    let val = Math.max(0, Math.min(100, value));
    if (this.currentRawData) this.currentRawData[addressDecimal] = val;
    let v = val.toString(16).padStart(2, "0");
    const cmdHex = `00 59 22 0A 00 00 04 ${addressDecimal.toString(16).padStart(2, "0")} 00 00 10 02 00 00 ${v} 00 00`;
    await this.sendCommand(this.buildPacket(cmdHex));
  }

  async changeModel(addressHex, modelId) {
    if (!this.isConnected) return;
    this.registerEdit();
    if (this.currentRawData) this.currentRawData[addressHex] = modelId;

    const cmdHex = `00 59 22 09 00 00 04 ${addressHex.toString(16).padStart(2, "0")} 00 00 10 01 00 00 ${modelId.toString(16).padStart(2, "0")} 00`;
    await this.sendCommand(this.buildPacket(cmdHex));
  }

  updateUI() {
    const btn = document.getElementById("connectBtn");
    const disconnectBtn = document.getElementById("disconnectBtn");
    const statusText = document.getElementById("statusText");
    const statusDot = document.getElementById("statusDot");
    const saveBtn = document.getElementById("savePresetBtn");

    if (this.isConnected) {
      if (btn) btn.style.display = "none";
      if (disconnectBtn) {
        disconnectBtn.style.display = "inline-flex";
        disconnectBtn.disabled = false;
      }
      if (saveBtn) saveBtn.disabled = !this.isModified;
      if (statusText) {
        statusText.textContent =
          this.connectionType === "usb" ? "USB Conectado" : "BLE Conectado";
      }
      if (statusDot) statusDot.classList.add("connected");
    } else {
      if (btn) {
        btn.style.display = "inline-flex";
        btn.disabled = false;
      }
      if (disconnectBtn) disconnectBtn.style.display = "none";
      if (saveBtn) saveBtn.disabled = true;
      if (statusText) statusText.textContent = "Desconectado";
      if (statusDot) statusDot.classList.remove("connected");
    }
  }
}

const editor = new MvaveBLEEditor();
window.editor = editor;
