import { boot } from '../web/boot';

// The phone layout whatever the screen's width, and push notifications through this app's own worker.
void boot({ layout: 'phone', push: true });
