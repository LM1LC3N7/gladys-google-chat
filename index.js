// -----------------------------------------------------------------------------
// Entry point: SDK wiring only (src/handlers.js), handlers registered BEFORE
// connect(). Environment variables provided by the Gladys supervisor, read by
// the SDK: GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN,
// GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, createLogger } from '@gladysassistant/integration-sdk';
import { GoogleChatApp } from './src/app.js';
import { registerHandlers } from './src/handlers.js';
import { FileStore } from './src/store.js';

const logger = createLogger({ name: 'google-chat' });
const gladys = new GladysIntegration();
const app = new GoogleChatApp({ gladys, logger, store: new FileStore({ name: 'state.json' }) });

registerHandlers(gladys, app, logger);
gladys.handleShutdown(() => app.stop());

logger.info('Starting the Google Chat integration...');
gladys.connect().catch((err) => {
  logger.error(`Initial connection failed (${err?.name ?? 'Error'})`);
  process.exit(1);
});
