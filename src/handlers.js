// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so the
// tests run the exact wiring of the container. Every handler is registered
// before connect(). Send only: no incoming message, no device, no polling.
// -----------------------------------------------------------------------------

import { ACTIONS, SCENE_ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // A Gladys message to a user: `contact` is their "My account" values.
  gladys.onSendMessage((contact, message) => app.sendMessage(contact, message));

  // Scene action: a text to the default space.
  gladys.onSceneAction(SCENE_ACTIONS.POST, (fields) => app.postMessage(fields));

  // Configuration screen buttons.
  gladys.onAction(ACTIONS.TEST, () => app.test());
  gladys.onAction(ACTIONS.FORGET, () => app.forgetRefused());

  // Configuration saved by the user.
  gladys.onConfigUpdated((config) => app.configUpdated(config));

  // Every connection: the config read again (retried for ever).
  gladys.on('connected', async () => {
    try {
      await app.connected();
    } catch (err) {
      logger?.error(`Start failed (${err?.name ?? 'Error'})`);
    }
  });
}
