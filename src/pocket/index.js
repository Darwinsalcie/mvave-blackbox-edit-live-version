/**
 * src/pocket/index.js
 * Entry point for Pocket Motion Mode module.
 */

import { pocketModeUI } from './PocketModeUI.js';
import { pocketConfig } from './PocketConfig.js';
import { pocketGestureEngine } from './PocketGestureEngine.js';

function initPocketMode() {
  pocketModeUI.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPocketMode);
} else {
  initPocketMode();
}

export { pocketModeUI, pocketConfig, pocketGestureEngine };
