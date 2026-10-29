import { resolve } from 'node:path';
import { webConfig } from '../hosted/vite.base';

// Served by the relay (`relay/`), not by hosted helm: this build talks to a desktop app through it.
export default webConfig({ dir: __dirname, name: 'companion', out: resolve(__dirname, 'dist') });
