// 헤드리스 Chrome 실행 공용 헬퍼
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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

// 헤드리스 Chrome 은 창 폭이 약 504px 아래로 내려가지 않는다. 좁은 폭은 iframe 으로 만든다.
// 안쪽 셀프테스트 결과는 postMessage 로 받아 #selftest-result 에 옮긴다.
export function narrowUrl(width, query) {
  const file = join(outDir, 'narrow.html');
  const inner = previewUrl(query);
  writeFileSync(file, '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#888">' +
    '<iframe id="f" src="' + inner + '" style="width:' + width + 'px;height:2400px;border:0;display:block;background:#fff"></iframe>' +
    '<script>addEventListener("message",function(e){if(e.data&&e.data.__selftest){var p=document.createElement("pre");p.id="selftest-result";p.textContent=JSON.stringify(e.data.__selftest);document.body.appendChild(p);}});</script>');
  return pathToFileURL(file).href;
}
