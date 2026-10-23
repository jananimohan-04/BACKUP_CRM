import type { CapacitorConfig } from '@capacitor/cli';

// Android app (APK): the built web app (dist/) runs inside the phone's WebView. Data still comes from the same
// Supabase project, so the phone needs an internet connection.
const config: CapacitorConfig = {
  appId: 'com.arguscnc.erp',
  appName: 'ARGUS CNC ERP',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
