import { boot } from '../hosted/web/boot';

// The layout the window's size asks for, and push notifications through this app's own worker.
void boot({ push: true });
