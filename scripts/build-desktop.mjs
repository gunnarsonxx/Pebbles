// Bundles the Electron main + preload scripts into desktop-dist/.
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: false, logLevel: 'info' };

await build({ ...common, entryPoints: ['desktop/main.ts'], outfile: 'desktop-dist/main.cjs' });
await build({ ...common, entryPoints: ['desktop/preload.ts'], outfile: 'desktop-dist/preload.cjs' });

mkdirSync('desktop-dist/assets', { recursive: true });
cpSync('build/icon.png', 'desktop-dist/assets/icon.png');
cpSync('build/tray.png', 'desktop-dist/assets/tray.png');
