// index.html 의 <?!= include('x') ?> 를 펼치고 스텁/셀프테스트를 인라인 주입해 dev/out/preview.html 생성
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function expand(html, depth = 0) {
  if (depth > 10) throw new Error('include 중첩이 너무 깊습니다');
  return html.replace(/<\?!=\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*\?>/g, (_, name) =>
    expand(readFileSync(join(root, name + '.html'), 'utf8'), depth + 1));
}

export function buildPreview() {
  let html = expand(readFileSync(join(root, 'index.html'), 'utf8'));
  const stub = readFileSync(join(here, 'stub-gas.js'), 'utf8');
  const selftest = readFileSync(join(here, 'selftest.js'), 'utf8');
  // 스텁은 앱 스크립트보다 먼저(</head> 앞), 셀프테스트는 앱 스크립트 뒤(</body> 앞)
  html = html.replace('</head>', () => '<script>\n' + stub + '\n</script>\n</head>');
  html = html.replace('</body>', () => '<script>\n' + selftest + '\n</script>\n</body>');
  const out = join(here, 'out', 'preview.html');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('생성: ' + buildPreview());
}
