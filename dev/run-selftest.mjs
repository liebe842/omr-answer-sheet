// 사용: node dev/run-selftest.mjs <scenario> [--fail=<serverFn>] [--width=360]
import { buildPreview } from './preview.mjs';
import { previewUrl, runChrome, narrowUrl } from './chrome.mjs';

const args = process.argv.slice(2);
const scenario = args.find(a => !a.startsWith('--')) || 'fresh';
const width = (args.find(a => a.startsWith('--width=')) || '').slice(8);
const fail = (args.find(a => a.startsWith('--fail=')) || '').slice(7);

buildPreview();
let query = 'scenario=' + encodeURIComponent(scenario) + '&selftest=1';
if (fail) query += '&fail=' + encodeURIComponent(fail);
const r = runChrome(['--virtual-time-budget=10000', '--dump-dom', '--window-size=1000,900'], width ? narrowUrl(width, query) : previewUrl(query));
const m = (r.stdout || '').match(/<pre id="selftest-result">([\s\S]*?)<\/pre>/);
if (!m) {
  console.log('FAIL: 셀프테스트 결과를 찾지 못했습니다 (scenario=' + scenario + ')');
  if (r.stderr) console.log(r.stderr.slice(0, 500));
  process.exit(1);
}
// dump-dom 은 텍스트를 HTML 이스케이프하므로 되돌려 파싱
const text = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const res = JSON.parse(text);
console.log('PASS ' + res.pass + ' / FAIL ' + res.fail);
res.failures.forEach(f => console.log('  - ' + f.name + ': ' + f.message));
process.exit(res.fail > 0 ? 1 : 0);
