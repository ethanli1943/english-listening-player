const BASE = new URL('./', location.href).href;
const BOOKMARKLET = `javascript:(function(){var s=document.createElement('script');s.src='${BASE}panel.js?v='+Date.now();document.body.appendChild(s);})();`;
const $ = id => document.getElementById(id);

$('code').value = BOOKMARKLET;
$('bookmarklet').href = BOOKMARKLET;
$('bookmarklet').onclick = e => { e.preventDefault(); alert('請把這顆按鈕「拖曳」到書籤列，不是直接點。'); };

$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(BOOKMARKLET); $('copy').textContent = '✅ 已複製'; }
  catch { $('code').select(); document.execCommand('copy'); $('copy').textContent = '✅ 已複製'; }
  setTimeout(() => { $('copy').textContent = '📋 複製書籤碼'; }, 2500);
};

for (const tab of document.querySelectorAll('.tab')) {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.steps[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
  };
}
const ua = navigator.userAgent;
const guess = /iPhone|iPad|Macintosh.*Mobile/.test(ua) ? 'iphone' : /Android/.test(ua) ? 'android' : /Mobi/.test(ua) ? 'iphone' : 'pc';
document.querySelector(`.tab[data-tab="${guess}"]`)?.click();

// ---------- 老師產生作業連結（格式與 panel.js 的分享相同） ----------
function parseHomework(text) {
  const groups = [], skipped = [];
  for (const original of text.split(/\r?\n/)) {
    const line = original.trim(); if (!line) continue;
    const range = line.match(/Track\s*0*(\d{1,3})(?:\s*[-–—~～至]\s*(?:Track\s*)?0*(\d{1,3}))?/i);
    const repeat = line.match(/(\d{1,2})\s*遍/);
    if (!range || !repeat) { if (/track/i.test(line)) skipped.push(line); continue; }
    const first = +range[1], last = +(range[2] || range[1]), times = +repeat[1];
    if (first < 1 || last < first || last - first > 59 || times < 1 || times > 30) { skipped.push(line); continue; }
    const prefix = line.slice(0, range.index).replace(/聆聽\s*CD\s*[:：]?/gi, '').trim();
    groups.push({ label: prefix || `第 ${groups.length + 1} 組`, first, last, times });
  }
  return { groups, skipped };
}
// v2 短格式：只記每組「標籤、起訖 Track、遍數」
function encode(groups) {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 2, g: groups.map(g => [g.label, g.first, g.last, g.times]) }));
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
$('t-make').onclick = () => {
  const { groups, skipped } = parseHomework($('t-hw').value);
  const preview = $('t-preview'); preview.replaceChildren(); $('t-result').hidden = false;
  if (!groups.length) {
    preview.textContent = '沒有找到作業。每一行要有 Track 範圍和「幾遍」，例如：Track11-13 5遍';
    $('t-link').hidden = $('t-copy').hidden = true; return;
  }
  const field = /^[A-Za-z0-9]{1,10}$/.test($('t-field').value.trim()) ? $('t-field').value.trim() : 'CA3';
  for (const g of groups) {
    const line = document.createElement('div');
    line.textContent = `✓ ${g.label}：Track ${g.first}${g.last > g.first ? `–${g.last}` : ''}，${g.times} 遍`;
    preview.append(line);
  }
  if (skipped.length) {
    const warn = document.createElement('div'); warn.className = 'warn';
    warn.textContent = `⚠ 有 ${skipped.length} 行看不懂，沒有放進連結：${skipped.join('／')}`;
    preview.append(warn);
  }
  $('t-link').hidden = $('t-copy').hidden = false;
  $('t-link').value = `${BASE}#p=${encode(groups)}&f=${field}`;
};
$('t-copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('t-link').value); }
  catch { $('t-link').select(); document.execCommand('copy'); }
  $('t-copy').textContent = '✅ 已複製，可以貼到 LINE';
  setTimeout(() => { $('t-copy').textContent = '📋 複製連結'; }, 2500);
};

// 收到分享連結：#p=<清單>&f=<冊別>
const params = new URLSearchParams(location.hash.slice(1));
const data = params.get('p'), field = params.get('f');
if (data && /^[A-Za-z0-9_-]+$/.test(data)) {
  const safeField = /^[A-Za-z0-9]{1,10}$/.test(field || '') ? field : 'CA3';
  try {
    const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    let lines, count;
    if (parsed.v === 2) {
      lines = parsed.g.map(([label, first, last, times]) => `${label}：Track ${first}${last > first ? `–${last}` : ''}，${times} 遍`);
      count = parsed.g.reduce((n, [, first, last, times]) => n + (last - first + 1) * times, 0);
    } else {
      const groups = new Map();
      for (const [track, label, , total, group] of parsed.q) {
        if (!groups.has(group)) groups.set(group, { label: parsed.l[label], tracks: new Set(), total });
        groups.get(group).tracks.add(track);
      }
      lines = [...groups.values()].map(g => {
        const t = [...g.tracks].sort((a, b) => a - b);
        return `${g.label}：Track ${t[0]}${t.length > 1 ? `–${t[t.length - 1]}` : ''}，${g.total} 遍`;
      });
      count = parsed.q.length;
    }
    $('shared-summary').textContent = `共 ${count} 首。` + lines.join('；');
    $('shared').hidden = false;
    $('open').href = `https://listeningdata.knsh.com.tw/cd_online/V1/index.html?field=${safeField}#elp=${data}`;
    $('open').textContent = `▶ 開啟康軒並帶入這份作業`;
  } catch { /* 壞掉的連結就當一般入口 */ }
}
