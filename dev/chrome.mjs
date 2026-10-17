// 헤드리스 Chrome 실행 공용 헬퍼
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const outDir = join(here, 'out');
export const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

export function previewUrl(query) {
  return pathToFileURL(join(outDir, 'preview.html')).href + '?' + query;
}
// 실행마다 새 프로필(localStorage 초기화)
export function freshProfile() {
  mkdirSync(join(outDir, 'profiles'), { recursive: true });
  return mkdtempSync(join(outDir, 'profiles', 'p-'));
}
export function runChrome(extraArgs, url) {
  const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    '--user-data-dir=' + freshProfile(), ...extraArgs, url];
  return spawnSync(CHROME, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
}
