import { boot } from '../hosted/web/boot';
import { pair } from './pairing';

// The layout the window's size asks for, and push notifications through this app's own worker. The relay carries the connection to your
// computer, so first this browser has to be signed in and paired with it.
void pair().then(() => boot({ push: true }));
