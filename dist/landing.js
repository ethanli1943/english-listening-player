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

// 收到分享連結：#p=<清單>&f=<冊別>
const params = new URLSearchParams(location.hash.slice(1));
const data = params.get('p'), field = params.get('f');
if (data && /^[A-Za-z0-9_-]+$/.test(data)) {
  const safeField = /^[A-Za-z0-9]{1,10}$/.test(field || '') ? field : 'CA3';
  try {
    const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    const groups = new Map();
    for (const [track, label, round, total, group] of parsed.q) {
      const key = `${group}`;
      if (!groups.has(key)) groups.set(key, { label: parsed.l[label], tracks: new Set(), total });
      groups.get(key).tracks.add(track);
    }
    const lines = [...groups.values()].map(g => {
      const t = [...g.tracks].sort((a, b) => a - b);
      return `${g.label}：Track ${t[0]}${t.length > 1 ? `–${t[t.length - 1]}` : ''}，${g.total} 遍`;
    });
    $('shared-summary').textContent = `共 ${parsed.q.length} 首。` + lines.join('；');
    $('shared').hidden = false;
    $('open').href = `https://listeningdata.knsh.com.tw/cd_online/V1/index.html?field=${safeField}#elp=${data}`;
    $('open').textContent = `▶ 開啟康軒並帶入這份作業`;
  } catch { /* 壞掉的連結就當一般入口 */ }
}
