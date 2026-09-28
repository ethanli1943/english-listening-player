// 英聽小幫手：在康軒 CD 線上聽頁面上加一個作業播放面板。
// 音檔一律由康軒官方頁面自己的播放器播放，本程式只負責「按哪一首、播幾遍」。
(() => {
  if (window.__elpPanel) { window.__elpPanel.show(); return; }
  const audio = document.getElementById('audio-player');
  if (!audio || !/knsh\.com\.tw$/.test(location.hostname)) {
    alert('請先打開康軒「CD 線上聽」的頁面（掃課本 QR code 進入），再點一次這個書籤。');
    return;
  }

  const SITE = 'https://ethanli1943.github.io/english-listening-player/';
  const FIELD = new URLSearchParams(location.search).get('field') || 'default';
  const KEY = `elp-panel-v1:${FIELD}`;
  const EXAMPLE = '(二) 聆聽CD：Track11-13（配合課本p.18-21）5遍\n(三) 聆聽CD：Track14-16（配合課本p.22-24）5遍';

  let queue = [], currentIndex = 0, savedOffset = 0, history = [], homeworkText = '';
  let active = false, expectTrack = null, pendingOffset = 0, pendingPause = false, seeking = false;
  let lastSave = 0, toastTimer = 0, collapsed = false;

  // ---------- 工具 ----------
  const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const fmt = s => { const n = Math.max(0, Math.floor(s || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
  const longFmt = s => { const n = Math.max(0, Math.ceil(s || 0)); const h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60); return h ? `${h} 小時 ${m} 分` : `${m} 分 ${n % 60} 秒`; };

  function tracks() {
    const map = new Map();
    for (const li of document.querySelectorAll('li.playlist-item')) {
      const t = li.textContent.match(/Track\s*0*(\d+)\.mp3/i);
      if (!t) continue;
      const d = li.textContent.match(/(\d{2}):(\d{2}):(\d{2})/);
      map.set(Number(t[1]), { li, dur: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0 });
    }
    return map;
  }
  const srcTrack = () => { const m = (audio.currentSrc || audio.src || '').match(/Track0*(\d+)\.mp3/i); return m ? Number(m[1]) : null; };
  const current = () => queue[currentIndex] || null;

  function parseHomework(text) {
    const groups = [], skipped = [];
    for (const original of text.split(/\r?\n/)) {
      const line = original.trim(); if (!line) continue;
      const range = line.match(/Track\s*0*(\d{1,3})(?:\s*[-–—~～至]\s*(?:Track\s*)?0*(\d{1,3}))?/i);
      const repeat = line.match(/(\d{1,2})\s*遍/);
      if (!range || !repeat) { skipped.push(line); continue; }
      const first = +range[1], last = +(range[2] || range[1]), times = +repeat[1];
      if (first < 1 || last < first || last - first > 59 || times < 1 || times > 30) { skipped.push(line); continue; }
      const prefix = line.slice(0, range.index).replace(/聆聽\s*CD\s*[:：]?/gi, '').trim();
      groups.push({ id: makeId(), label: prefix || `第 ${groups.length + 1} 組`, first, last, times });
    }
    return { groups, skipped };
  }
  function expand(groups) {
    const out = [];
    for (const g of groups) for (let round = 1; round <= g.times; round++) for (let track = g.first; track <= g.last; track++)
      out.push({ id: makeId(), groupId: g.id, label: g.label, track, round, total: g.times });
    return out;
  }

  // ---------- 分享格式（與入口網頁共用） ----------
  function encodeQueue() {
    const labels = [...new Set(queue.map(i => i.label))], groups = [...new Set(queue.map(i => i.groupId))];
    const data = { v: 1, l: labels, g: groups.map((_, i) => String(i)), q: queue.map(i => [i.track, labels.indexOf(i.label), i.round, i.total, groups.indexOf(i.groupId)]) };
    const bytes = new TextEncoder().encode(JSON.stringify(data)); let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeQueue(value) {
    const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    if (data.v !== 1 || !Array.isArray(data.q) || data.q.length > 1500) throw Error('bad');
    const gid = (data.g || []).map(() => makeId());
    return data.q.map(([track, label, round, total, group]) => {
      if (!Number.isInteger(track) || track < 1 || track > 999 || typeof data.l[label] !== 'string') throw Error('bad');
      return { id: makeId(), track, label: data.l[label].slice(0, 80), round: +round || 1, total: +total || 1, groupId: gid[group] || makeId() };
    });
  }

  // ---------- 儲存 ----------
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ queue, currentIndex, history, homeworkText,
        offset: current() && srcTrack() === current().track ? audio.currentTime : savedOffset }));
    } catch { /* 無法儲存時仍可播放 */ }
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || '{}');
      queue = Array.isArray(s.queue) ? s.queue : [];
      currentIndex = Math.min(Math.max(+s.currentIndex || 0, 0), queue.length);
      savedOffset = +s.offset || 0;
      history = Array.isArray(s.history) ? s.history.slice(-12) : [];
      homeworkText = s.homeworkText || '';
    } catch { /* 忽略壞掉的舊資料 */ }
  }

  // ---------- 播放控制 ----------
  function turnOffSitePlaylistModes() {
    for (const id of ['continuous-play', 'loop-all-button']) {
      const cb = document.getElementById(id);
      if (cb?.checked) cb.click();
    }
  }
  function rememberPosition() {
    const item = current(); if (!item) return;
    history.push({ id: item.id, seconds: srcTrack() === item.track ? audio.currentTime : savedOffset, wasPlaying: !audio.paused });
    if (history.length > 12) history.shift();
  }
  function playAt(index, { offset = 0, start = true, remember = false } = {}) {
    if (remember) rememberPosition();
    active = true;
    turnOffSitePlaylistModes();
    if (index >= queue.length) {
      currentIndex = queue.length; savedOffset = 0; audio.pause(); save(); render();
      if (queue.length) toast('🎉 這份作業全部聽完了！');
      return;
    }
    currentIndex = Math.max(0, index); savedOffset = 0;
    const item = current(), info = tracks().get(item.track);
    if (!info) { toast(`這本書找不到 Track ${item.track}，請檢查清單。`, true); save(); render(); return; }
    if (srcTrack() === item.track) {
      audio.currentTime = offset;
      if (start) audio.play().catch(() => toast('請按一下「播放」繼續。', true)); else audio.pause();
    } else {
      expectTrack = item.track; pendingOffset = offset; pendingPause = !start;
      (info.li.querySelector('.track-info') || info.li).click();
    }
    save(); render();
  }
  function roundStart(i) {
    if (!queue.length) return -1;
    let s = Math.min(i, queue.length - 1); const it = queue[s];
    while (s > 0 && queue[s - 1].groupId === it.groupId && queue[s - 1].round === it.round) s--;
    return s;
  }
  function previousRoundIndex() {
    if (!queue.length) return -1;
    if (currentIndex >= queue.length) return roundStart(queue.length - 1);
    const s = roundStart(currentIndex);
    return s > 0 ? roundStart(s - 1) : -1;
  }
  function nextRound() {
    const it = current(); if (!it) return;
    let i = currentIndex + 1;
    while (i < queue.length && queue[i].groupId === it.groupId && queue[i].round === it.round) i++;
    playAt(i, { remember: true });
  }
  function undoJump() {
    while (history.length) {
      const p = history.pop(), i = queue.findIndex(q => q.id === p.id);
      if (i < 0) continue;
      playAt(i, { offset: p.seconds, start: p.wasPlaying });
      toast('已回到剛才的位置。');
      return;
    }
    render();
  }
  function togglePlay() {
    if (!queue.length) return toast('先貼上作業並按「建立清單」。', true);
    if (currentIndex >= queue.length) return playAt(0);
    const it = current();
    if (srcTrack() !== it.track) return playAt(currentIndex, { offset: savedOffset });
    active = true;
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }

  audio.addEventListener('loadedmetadata', () => {
    if (expectTrack !== srcTrack()) return;
    if (pendingOffset > 0 && pendingOffset < audio.duration) audio.currentTime = pendingOffset;
    pendingOffset = 0;
  });
  audio.addEventListener('play', () => {
    if (pendingPause && expectTrack === srcTrack()) { pendingPause = false; audio.pause(); }
    render();
  });
  audio.addEventListener('pause', () => { save(); render(); });
  audio.addEventListener('ended', () => {
    const it = current();
    if (!active || !it || srcTrack() !== it.track) return;
    playAt(currentIndex + 1);
  });
  audio.addEventListener('timeupdate', () => {
    renderNow();
    if (Date.now() - lastSave > 5000) { lastSave = Date.now(); save(); }
  });

  // ---------- 清單編輯 ----------
  function insertAfter(i) {
    const raw = prompt('要在後面加入哪一首？請輸入 Track 編號：'); if (raw === null) return;
    const track = +raw; if (!Number.isInteger(track) || !tracks().has(track)) return toast('這本書沒有這個 Track 編號。', true);
    const a = queue[i];
    queue.splice(i + 1, 0, { id: makeId(), groupId: a.groupId, label: a.label, track, round: a.round, total: a.total });
    if (i + 1 <= currentIndex) currentIndex++;
    save(); render();
  }
  function addLast(track) {
    if (!Number.isInteger(track) || !tracks().has(track)) return toast('這本書沒有這個 Track 編號。', true);
    queue.push({ id: makeId(), groupId: makeId(), label: '手動新增', track, round: 1, total: 1 });
    save(); render(); toast(`已加入 Track ${track}。`);
  }
  function removeItem(i) {
    const wasCurrent = i === currentIndex;
    queue.splice(i, 1);
    if (i < currentIndex) currentIndex--;
    if (wasCurrent) { audio.pause(); savedOffset = 0; }
    currentIndex = Math.min(currentIndex, queue.length);
    save(); render();
  }
  function moveItem(i, d) {
    const t = i + d; if (t < 0 || t >= queue.length) return;
    const id = current()?.id, [it] = queue.splice(i, 1); queue.splice(t, 0, it);
    if (id) currentIndex = queue.findIndex(q => q.id === id);
    save(); render();
  }
  function applyHomework() {
    const r = parseHomework($('hw').value);
    if (!r.groups.length) return toast('沒有找到作業。每行要有 Track 範圍和「幾遍」。', true);
    if (queue.length && currentIndex < queue.length && !confirm('要用新作業取代目前的清單嗎？')) return;
    audio.pause();
    homeworkText = $('hw').value; queue = expand(r.groups); currentIndex = 0; savedOffset = 0; history = [];
    save(); render();
    toast(`已建立 ${r.groups.length} 組、共 ${queue.length} 首。按「播放」開始。${r.skipped.length ? `（${r.skipped.length} 行看不懂，已略過）` : ''}`, !!r.skipped.length);
  }
  async function share() {
    if (!queue.length) return toast('先建立清單才能分享。', true);
    const link = `${SITE}#p=${encodeQueue()}&f=${encodeURIComponent(FIELD)}`;
    try { await navigator.clipboard.writeText(link); toast('分享連結已複製，可以貼到 LINE。'); }
    catch { prompt('請複製這個分享連結：', link); }
  }

  // ---------- 畫面 ----------
  const host = document.createElement('div');
  host.id = 'elp-panel-host';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
:host{all:initial}
*{box-sizing:border-box;font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif}
.panel{position:fixed;z-index:2147483000;top:12px;right:12px;width:360px;max-height:calc(100vh - 24px);display:flex;flex-direction:column;background:#fff;color:#1d2a36;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.28);overflow:hidden;font-size:14px;line-height:1.45}
.bar{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#123e62;color:#fff;cursor:pointer;user-select:none}
.bar b{flex:1;font-size:15px}
.bar .mini{font-size:12px;opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px}
.icon{background:rgba(255,255,255,.15);border:0;color:#fff;border-radius:8px;width:30px;height:30px;font-size:16px;cursor:pointer}
.body{overflow:auto;padding:12px;display:flex;flex-direction:column;gap:12px}
.collapsed .body{display:none}
.now{background:#f1f6fb;border-radius:12px;padding:12px;position:sticky;top:0;z-index:1;box-shadow:0 6px 10px -8px rgba(0,0,0,.3)}
.now h3{margin:0;font-size:20px}
.now p{margin:2px 0 8px;color:#4a5b6b}
.remain{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.remain strong{font-size:18px;color:#123e62}
.seek{display:flex;align-items:center;gap:8px;font-size:12px;color:#4a5b6b}
.seek input{flex:1;accent-color:#123e62;height:28px}
.btns{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}
button.b{border:1px solid #c8d5e1;background:#fff;color:#123e62;border-radius:10px;padding:10px 4px;font-size:14px;cursor:pointer;min-height:44px}
button.b:disabled{opacity:.4;cursor:default}
button.primary{background:#123e62;color:#fff;border-color:#123e62;font-weight:700}
button.wide{grid-column:1/-1}
details{border:1px solid #e1e8ef;border-radius:12px;padding:8px 10px}
summary{cursor:pointer;font-weight:700;color:#123e62;padding:4px 0}
textarea{width:100%;min-height:110px;border:1px solid #c8d5e1;border-radius:8px;padding:8px;font-size:14px;margin:6px 0}
.row{display:flex;gap:6px}
.row input{flex:1;border:1px solid #c8d5e1;border-radius:8px;padding:8px;font-size:14px;min-width:0}
.list{display:flex;flex-direction:column;gap:2px;margin-top:6px}
.grp{font-size:12px;color:#6a7b8b;margin-top:8px;padding:0 4px}
.item{display:flex;align-items:center;gap:4px;border-radius:8px;padding:2px 4px}
.item.done .go{color:#9aa8b5}
.item.cur{background:#fff4d8}
.go{flex:1;text-align:left;background:none;border:0;padding:8px 4px;font-size:14px;color:#1d2a36;cursor:pointer}
.item.cur .go{font-weight:700}
.act{background:none;border:0;color:#6a7b8b;font-size:15px;width:28px;height:32px;cursor:pointer;border-radius:6px}
.act:hover{background:#eef3f8}
.muted{color:#6a7b8b;font-size:12px}
.toast{position:fixed;z-index:2147483001;left:50%;bottom:24px;transform:translateX(-50%);background:#1d2a36;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;max-width:90vw;opacity:0;pointer-events:none;transition:opacity .2s}
.toast.show{opacity:1}.toast.err{background:#a3321f}
.hidden{display:none}
@media (max-width:700px){
 .panel{top:auto;bottom:0;right:0;left:0;width:auto;max-height:72vh;border-radius:16px 16px 0 0}
 .bar .mini{max-width:none;flex:1}
 .collapsed .bar b{display:none}
}
</style>
<div class="panel" id="panel">
 <div class="bar" id="bar"><b>🎧 英聽小幫手</b><span class="mini" id="mini"></span><button class="icon" id="fold" title="收合／展開">▾</button><button class="icon" id="close" title="隱藏面板">✕</button></div>
 <div class="body">
  <div class="now">
   <h3 id="title">準備開始</h3><p id="detail">貼上作業，建立清單。</p>
   <div class="remain"><span class="muted">整份作業剩餘</span><strong id="remain">--</strong></div>
   <div class="seek"><span id="el">0:00</span><input id="seek" type="range" min="0" max="1000" value="0"><span id="du">0:00</span></div>
   <div class="btns">
    <button class="b" id="prev">⏮ 上一首</button><button class="b primary" id="play">▶ 播放</button><button class="b" id="next">下一首 ⏭</button>
    <button class="b" id="prevRound">⏪ 上一遍</button><button class="b" id="undo">↶ 返回剛才</button><button class="b" id="nextRound">下一遍 ⏩</button>
   </div>
   <p class="muted" id="count" style="margin:8px 0 0"></p>
  </div>
  <details id="hwBox"><summary>📋 貼上本週作業</summary>
   <textarea id="hw" placeholder="把老師的作業文字整段貼上，例如：&#10;(二) 聆聽CD：Track11-13（配合課本p.18-21）5遍"></textarea>
   <div class="row"><button class="b primary" id="apply" style="flex:1">建立清單</button><button class="b" id="example">填入範例</button></div>
   <p class="muted">每一行要有 Track 範圍和「幾遍」。Track 11-13 播 5 遍 = 11→12→13 算一遍，共 5 遍。</p>
  </details>
  <details id="listBox" open><summary>🎵 播放清單 <span class="muted" id="n"></span></summary>
   <p class="muted">點曲目可跳過去；跳錯了按「↶ 返回剛才」。＋ 加在後面、↑↓ 調整順序、✕ 移除。</p>
   <div class="list" id="list"></div>
   <div class="row" style="margin-top:8px"><input id="addNum" type="number" inputmode="numeric" placeholder="Track 編號"><button class="b" id="add">加到最後</button></div>
  </details>
  <button class="b" id="share">🔗 分享這份清單（傳 LINE）</button>
  <p class="muted">請不要同時按康軒頁面的「單元播放」。手機關螢幕時，部分瀏覽器可能在一首結束後停住，回到畫面按「播放」即可接續。</p>
 </div>
</div>
<div class="toast" id="toast"></div>`;
  const $ = id => root.getElementById(id);

  function toast(msg, err = false) {
    const t = $('toast'); t.textContent = msg; t.classList.toggle('err', err); t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
  }
  function remaining() {
    const map = tracks(); let s = 0;
    for (let i = currentIndex; i < queue.length; i++) {
      const it = queue[i], d = map.get(it.track)?.dur || 0;
      if (i === currentIndex) {
        const len = srcTrack() === it.track && Number.isFinite(audio.duration) ? audio.duration : d;
        const pos = srcTrack() === it.track ? audio.currentTime : savedOffset;
        s += Math.max(0, len - pos);
      } else s += d;
    }
    return s;
  }
  function renderNow() {
    const it = current(), done = queue.length && currentIndex >= queue.length;
    const mine = it && srcTrack() === it.track;
    $('title').textContent = it ? `Track ${it.track}` : done ? '全部聽完了 🎉' : '準備開始';
    $('detail').textContent = it ? `${it.label}・第 ${it.round} / ${it.total} 遍` : done ? '可以貼上下一週的作業。' : '貼上作業，建立清單。';
    const playing = mine && !audio.paused;
    $('play').textContent = done ? '↺ 從頭' : playing ? '⏸ 暫停' : '▶ 播放';
    $('prev').disabled = !queue.length || currentIndex === 0;
    $('next').disabled = !it; $('nextRound').disabled = !it;
    $('prevRound').disabled = previousRoundIndex() < 0;
    $('undo').disabled = !history.length;
    const len = mine && Number.isFinite(audio.duration) ? audio.duration : (it ? tracks().get(it.track)?.dur || 0 : 0);
    const pos = mine ? audio.currentTime : savedOffset;
    $('el').textContent = fmt(pos); $('du').textContent = fmt(len);
    $('seek').disabled = !mine;
    if (!seeking) $('seek').value = len ? Math.round(pos / len * 1000) : 0;
    $('remain').textContent = queue.length ? longFmt(remaining()) : '--';
    $('count').textContent = queue.length ? `第 ${Math.min(currentIndex + 1, queue.length)} / ${queue.length} 首` : '';
    $('mini').textContent = it ? `Track ${it.track}・第${it.round}/${it.total}遍・剩 ${longFmt(remaining())}` : '';
  }
  function renderList() {
    const list = $('list'); list.replaceChildren(); $('n').textContent = `（${queue.length} 首）`;
    if (!queue.length) { list.innerHTML = '<p class="muted">清單是空的。先貼上本週作業。</p>'; return; }
    let last = '';
    queue.forEach((it, i) => {
      const k = `${it.groupId}|${it.round}`;
      if (k !== last) { const g = document.createElement('div'); g.className = 'grp'; g.textContent = `${it.label}・第 ${it.round} / ${it.total} 遍`; list.append(g); last = k; }
      const row = document.createElement('div');
      row.className = `item${i === currentIndex ? ' cur' : ''}${i < currentIndex ? ' done' : ''}`;
      const go = document.createElement('button'); go.className = 'go';
      go.textContent = `${i < currentIndex ? '✓ ' : i === currentIndex ? '▶ ' : ''}Track ${it.track}`;
      go.onclick = () => playAt(i, { remember: true });
      row.append(go);
      for (const [sym, tip, fn] of [['＋', '在後面新增', () => insertAfter(i)], ['↑', '上移', () => moveItem(i, -1)], ['↓', '下移', () => moveItem(i, 1)], ['✕', '移除', () => removeItem(i)]]) {
        const b = document.createElement('button'); b.className = 'act'; b.textContent = sym; b.title = tip; b.onclick = fn; row.append(b);
      }
      list.append(row);
    });
  }
  function render() { renderNow(); renderList(); }

  $('play').onclick = togglePlay;
  $('prev').onclick = () => playAt(currentIndex - 1, { remember: true });
  $('next').onclick = () => playAt(currentIndex + 1, { remember: true });
  $('prevRound').onclick = () => { const i = previousRoundIndex(); if (i >= 0) playAt(i, { remember: true }); };
  $('nextRound').onclick = nextRound;
  $('undo').onclick = undoJump;
  $('apply').onclick = applyHomework;
  $('example').onclick = () => { $('hw').value = EXAMPLE; };
  $('add').onclick = () => { addLast(+$('addNum').value); $('addNum').value = ''; };
  $('addNum').onkeydown = e => { if (e.key === 'Enter') $('add').click(); };
  $('share').onclick = share;
  $('seek').oninput = () => { seeking = true; $('el').textContent = fmt($('seek').value / 1000 * (audio.duration || 0)); };
  $('seek').onchange = () => { if (Number.isFinite(audio.duration)) audio.currentTime = $('seek').value / 1000 * audio.duration; seeking = false; save(); };
  $('fold').onclick = e => { e.stopPropagation(); collapsed = !collapsed; $('panel').classList.toggle('collapsed', collapsed); $('fold').textContent = collapsed ? '▴' : '▾'; };
  $('bar').onclick = () => { if (collapsed) $('fold').click(); };
  $('close').onclick = e => { e.stopPropagation(); host.style.display = 'none'; };

  // ---------- 啟動 ----------
  load();
  const m = location.hash.match(/elp=([A-Za-z0-9_-]+)/);
  if (m) {
    try {
      const shared = decodeQueue(m[1]);
      if (!queue.length || confirm(`要載入分享的作業清單（${shared.length} 首）嗎？會取代目前的清單。`)) {
        queue = shared; currentIndex = 0; savedOffset = 0; history = []; homeworkText = '';
        save(); setTimeout(() => toast('已載入分享的作業清單，按「播放」開始。'), 300);
      }
    } catch { toast('分享連結無法讀取。', true); }
    window.history.replaceState(null, '', location.pathname + location.search);
  }
  $('hw').value = homeworkText;
  if (!queue.length) $('hwBox').open = true;
  turnOffSitePlaylistModes();
  render();

  window.__elpPanel = { show() { host.style.display = ''; if (collapsed) $('fold').click(); } };
})();
