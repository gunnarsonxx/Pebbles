// Two builds come from this code:
// - the personal build (the default), set up for its owner
// - the Community build (VITE_EDITION=community), for anyone else: no built-in keys, set up for your own state, store and banks
// The check is written out in full where it matters so the build drops the other side completely.

export const COMMUNITY: boolean = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_EDITION === 'community';

export const APP_NAME = COMMUNITY ? 'Pebbles Community' : 'Pebbles';

/** The files this build updates itself from on the Releases page (each edition only installs its own). */
export const ASSET_APK = COMMUNITY ? 'Pebbles-Community.apk' : 'Pebbles.apk';
export const ASSET_EXE = COMMUNITY ? 'Pebbles-Community-Setup.exe' : 'Pebbles-Setup.exe';

/** What to call the grocery store whose live prices Pebbles checks (Kroger's API covers all its stores). */
export const PRICE_STORE = COMMUNITY ? 'Kroger-family store' : 'King Soopers';
export const PRICE_STORE_SHORT = COMMUNITY ? 'Kroger' : 'King Soopers';

/** The Android app id (Google keys restricted to "Android apps" need it). */
export const ANDROID_PACKAGE = COMMUNITY ? 'app.pebbles.community' : 'app.pebbles.money';

/** Community build only: opening a Marcus account through this link gives the new saver (and the person who shared Pebbles) a rate boost. */
export const MARCUS_REFERRAL = COMMUNITY ? 'https://www.marcus.com/share/TRI-A5F-MSB9' : '';
