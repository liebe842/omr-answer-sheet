// 사용: node dev/screenshot.mjs <scenario> <width> [name] [extraQuery]  (extraQuery 예: "mode=teacher&x=1")
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildPreview } from './preview.mjs';
import { previewUrl, runChrome, outDir, narrowUrl } from './chrome.mjs';

const [scenario = 'fresh', width = '360', name, extra] = process.argv.slice(2);
buildPreview();
const shots = join(outDir, 'shots');
mkdirSync(shots, { recursive: true });
const file = join(shots, (name || scenario + '-' + width) + '.png');
let query = 'scenario=' + encodeURIComponent(scenario);
if (extra) query += '&' + extra;
const r = runChrome(['--virtual-time-budget=3000', '--screenshot=' + file, '--window-size=' + Math.max(504, Number(width)) + ',2400'], Number(width) < 504 ? narrowUrl(width, query) : previewUrl(query));
if (r.status !== 0) { console.log(r.stderr); process.exit(1); }
console.log(file);
