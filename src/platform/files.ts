// Hand a small file (like a calendar) to the phone's apps, or download it on a computer.
import { registerPlugin } from '@capacitor/core';
import { platformKind } from './index';

interface FilesPlugin {
  openFile(opts: { name: string; mime: string; text: string }): Promise<void>;
}
const Native = registerPlugin<FilesPlugin>('PebblesUpdate');

export async function openTextFile(name: string, mime: string, text: string): Promise<void> {
  if (platformKind === 'android') {
    await Native.openFile({ name, mime, text });
    return;
  }
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
