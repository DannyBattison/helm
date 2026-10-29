import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.helm.mobile',
  appName: 'Helm',
  webDir: 'www',
  backgroundColor: '#0e0e12',
  // The page is served from inside the app, so its own origin is the app's; hosted servers and GitHub are reached with plain requests.
  server: { androidScheme: 'https' },
  plugins: {
    // GitHub's sign-in endpoints do not allow requests from a web page's origin; the native HTTP stack is not subject to that.
    CapacitorHttp: { enabled: true },
    LocalNotifications: { smallIcon: 'ic_stat_helm', iconColor: '#a78bfa' }
  }
};
export default config;
