import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.pebbles.money',
  appName: 'Pebbles',
  webDir: 'dist',
  android: {
    // Sync with the desktop hub happens over plain HTTP on the home network.
    // Payloads are AES-GCM encrypted end to end, so this is safe on LAN.
    allowMixedContent: true,
    backgroundColor: '#F3EFE6',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_pebble',
      iconColor: '#5F7A5A',
    },
  },
};

export default config;
