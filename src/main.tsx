import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './ui/theme.css';
import { App } from './ui/App';
import { store } from './data/store';
import { syncClient } from './data/syncClient';
import { checkTaxUpdates, getSettings, updateMarket } from './data/actions';
import { setupNative } from './platform/native';
import { checkForUpdate } from './platform/updater';
import { startAutopilot } from './data/autopilot';
import { loadBankLog, recoverPendingLinks, syncAllBanks } from './data/bank';
import { checkGuidelineUpdates, refreshStorePrices } from './data/groceryActions';

async function boot() {
  await store.init();
  const root = createRoot(document.getElementById('root')!);
  root.render(<App />);
  void syncClient.start();
  void setupNative();
  startAutopilot();
  void loadBankLog();
  // finish any bank sign-in that completed while Pebbles was in the background
  // coming back to Pebbles: pick up new bank transactions (at most every 30 min) and look for an update
  let lastUpdateCheck = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void recoverPendingLinks().catch(() => {});
    void syncAllBanks();
    if (Date.now() - lastUpdateCheck > 60 * 60_000) {
      lastUpdateCheck = Date.now();
      void checkForUpdate();
    }
  });
  window.addEventListener('focus', () => {
    if (Date.now() - lastUpdateCheck > 60 * 60_000) {
      lastUpdateCheck = Date.now();
      void checkForUpdate();
    }
  });
  // background refreshes: tax tables (daily) and prices (twice a day)
  const refresh = () => {
    const s = getSettings();
    if (!s.onboarded) return;
    if (s.integrations.autoUpdate) {
      void checkTaxUpdates();
      void checkGuidelineUpdates();
    }
    void updateMarket();
    void syncAllBanks();
    void refreshStorePrices();
  };
  setTimeout(refresh, 4000);
  setTimeout(() => void checkForUpdate(), 8000);
  // a computer can leave Pebbles open for days: check for updates every 2 hours, banks every 30 min
  setInterval(() => void checkForUpdate(), 2 * 3600_000);
  setInterval(refresh, 3 * 3600_000);
  setInterval(() => void syncAllBanks(), 30 * 60_000);
}

void boot();
