const BIZ = [
  {name:'ギガネット（通信）', v:'--b-giga'},
  {name:'円山製麺', v:'--b-maru'},
  {name:'SHEEP GANG', v:'--b-sheep'},
  {name:'エルダイブ', v:'--b-eld'},
  {name:'ぽとふ', v:'--b-poto'},
  {name:'個人', v:'--b-self'},
];
const TASK_STATUS = ['未','済','待ち','保留','繰越','捨'];
const bizVar = n => (BIZ.find(b => b.name === n) || {v:'--b-self'}).v;
const bizOrder = n => { const i = BIZ.findIndex(b => b.name === n); return i < 0 ? 99 : i; };
const WD = ['日','月','火','水','木','金','土'];
// yyyy-mm-dd に日数を足す
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0,10); };
const md = ymd => { const d = new Date(ymd + 'T00:00:00Z'); return `${d.getUTCMonth()+1}/${d.getUTCDate()}（${WD[d.getUTCDay()]}）`; };
const mdShort = ymd => String(ymd).slice(5).replace('-','/');
// 内容をひとことに縮める（カッコの中を省き、最初の読点までで切って、長ければ省略）
function short(text, n = 20){
  let t = String(text || '').replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, ' ').trim();
  const head = t.split(/[、。，,]/)[0].trim();
  if (head.length >= 8) t = head;   // 切った結果が短すぎる（「近藤さんに」など）ときは、全体を使う
  if (!t) t = String(text || '');
  return t.length > n ? t.slice(0, n) + '…' : t;
}
// サブタスク：1行に1つ。完了した行は頭に「✓ 」（行の番号は元のまま）
function subsOf(t){
  return String(t['サブタスク'] || '').split(/\r?\n/).map((line, i) => ({i, line})).filter(x => x.line.trim())
    .map(x => ({i: x.i, done: /^✓\s/.test(x.line), text: x.line.replace(/^✓\s+/, '').trim()}));
}
// 一覧に出す一言：Claudeが書いた「要約」があればそれ。なければ内容から自動で縮める（約20字）
const sum = t => String(t['要約'] || '').trim() || short(t['内容'], 20);

const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
};
let cfg = store.get('board.cfg', {url:'', key:''});
let state = store.get('board.cache', null);

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(msg, opt){
  const t = $('#toast'); t.textContent = msg;
  if (opt && opt.label){
    const b = document.createElement('button');
    b.className = 'toast-act'; b.textContent = opt.label;
    b.addEventListener('click', () => { t.classList.remove('show'); clearTimeout(toast._t); opt.fn(); });
    t.appendChild(b);
  }
  t.classList.toggle('has-act', !!(opt && opt.label));
  t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), (opt && opt.ms) || 2200);
}
const nowStr = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
// 完了にした直後だけ、しばらく「元に戻す」を出す
function showUndo(id, prev){
  toast('完了にしました', {label:'元に戻す', ms:7000, fn: () => {
    const st = prev && prev !== '済' ? prev : '未';
    act(() => { allTasks().filter(x => x.ID === id).forEach(x => { x['状態'] = st; x['完了日時'] = ''; }); },
      () => api('status', {id, status: st}), '元に戻しました');
  }});
}

/* ---------- 通信 ---------- */
async function api(action, params = {}){
  if (cfg.url === 'demo') return demoApi(action, params);
  if (!cfg.url || !cfg.key) throw new Error('not_configured');
  // 合言葉はURLに載せず、すべて本文で送る
  const res = await fetch(cfg.url, {method:'POST', cache:'no-store', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify({action, key:cfg.key, ...params})});
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'error');
  return j.data;
}

async function load(){
  try {
    state = await api('data');
    store.set('board.cache', state);
    render();
  } catch(e){
    render(e);
  }
}

/* ---------- 描画 ---------- */
function render(err){
  renderMain(err);
  $('#stamp').textContent = state && state.fetchedAt ? String(state.fetchedAt).slice(11) + ' 時点' : '';
  if ($('#bizView').open) fillBiz();
  if ($('#monthDlg').open) fillMonth();
  if ($('#taskView').open && viewTask){ const fresh = findTask(viewTask.ID); if (fresh) viewTask = fresh; renderView(); }
}
function renderMain(err){
  const app = $('#app');
  if (!cfg.url){
    app.innerHTML = `<div class="today"><div class="date">ボード</div></div>
      <p class="empty-note">接続先がまだ設定されていません。</p>
      <div class="foot"><span></span><button class="link" data-act="settings">接続を設定する</button></div>`;
    return;
  }
  if (!state){
    app.innerHTML = `<div class="today"><div class="date">…</div></div>` + (err ? errBox(err) : '');
    return;
  }
  const d = new Date(state.today + 'T00:00:00+09:00');
  const tasks = [...state.tasks].sort((a,b) => (a['状態']==='済') - (b['状態']==='済') || bizOrder(a['事業']) - bizOrder(b['事業']));
  const done = tasks.filter(t => t['状態'] === '済').length;
  const strip = tasks.length
    ? tasks.map(t => `<span class="${t['状態']==='済'?'done':''}" style="--c:var(${bizVar(t['事業'])})"></span>`).join('')
    : '<span></span>';
  const openT = tasks.filter(t => t['状態'] !== '済');
  const waiting = (state.waiting || []).filter(t => t['状態'] !== '済');
  const somedayOpen = (state.someday || []).filter(t => t['状態'] !== '済');
  const somedayDone = doneBox('someday');
  const cands = state.candidates || [];
  const checks = state.checks || [];
  const chkNow = checks.filter(c => c['状態'] !== 'あとで')
    .sort((a, b) => (a['期限'] || '9999') < (b['期限'] || '9999') ? -1 : (a['期限'] || '9999') > (b['期限'] || '9999') ? 1 : String(a['作成日時']) < String(b['作成日時']) ? -1 : 1);
  const chkLater = checks.filter(c => c['状態'] === 'あとで');

  app.innerHTML = `
    <div class="a-works">${worksHtml()}</div>
    <div class="a-head">
      <header class="today">
        <div class="today-row">
          <div class="date">${d.getMonth()+1}/${d.getDate()}<small>${WD[d.getDay()]}</small></div>
          <div class="count"><b>${done}/${tasks.length}</b>今日の完了</div>
        </div>
        ${timelineHtml(openT)}
      </header>
      ${err ? errBox(err) : ''}
    </div>
    ${state.carry.length ? `<div class="a-carry"><section class="carry">
        <h2>前日までの残り <span class="n">${state.carry.length}件 ・ 今日やるか、やめるか</span></h2>
        <div class="list">${state.carry.map(carryItem).join('')}</div>
      </section></div>` : ''}
    <div class="a-cal">${upcomingHtml()}</div>
    <div class="a-r2">
      <section>
        <h2>今日やること <span class="n">${openT.length}件</span></h2>
        ${eventsHtml(state.today)}
        ${openT.length ? `<div class="list">${openT.map(t => taskItem(t)).join('')}</div>`
          : `<p class="empty-note">${tasks.length ? '今日のタスクは全部終わりました。' : '今日のタスクはまだありません。右下の＋か、Claudeに送って追加します。'}</p>`}
        ${doneBox('today')}
      </section>
      <section>
        <h2>待ち・保留 <span class="n">${waiting.length}件</span></h2>
        ${waiting.length ? `<div class="list">${waiting.map(t => taskItem(t, {showDate:true})).join('')}</div>` : '<p class="empty-note">なし</p>'}
      </section>
      <section>
        <h2>日付なし <span class="n">${somedayOpen.length}件</span></h2>
        ${somedayOpen.length ? `<div class="list">${somedayOpen.map(t => taskItem(t)).join('')}</div>` : '<p class="empty-note">なし</p>'}
        ${somedayDone}
      </section>
    </div>
    <div class="a-r3">
      ${goalsHtml()}
      ${decisionsHtml()}
      <section>
        <h2>確認リスト <span class="n">${chkNow.length + cands.length}件・AIが拾った「これ大丈夫？」</span></h2>
        ${chkNow.length + cands.length ? `<div class="list">${chkNow.map(checkItem).join('')}${cands.map(candItem).join('')}</div>` : '<p class="empty-note">なし</p>'}
        ${chkLater.length ? `<details class="more"><summary>あとで ${chkLater.length}件</summary><div class="list">${chkLater.map(checkItem).join('')}</div></details>` : ''}
      </section>
    </div>
    <div class="foot a-foot">
      <span>${esc(state.fetchedAt)} 時点</span>
      <span></span>
    </div>`;
}

// 今日の仮の時間割：カレンダーの予定は固定、今日やることを空き時間に順に詰める（画面の中だけ。カレンダーには書かない）
const WORK_START = 10 * 60, WORK_END = 19 * 60, DEFAULT_MIN = 30;
const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const toMin = x => { const m = /^(\d+):(\d+)/.exec(x || ''); return m ? +m[1] * 60 + +m[2] : null; };
function buildSchedule(openT){
  const evs = eventsOn(state.today);
  const fixed = evs.filter(e => e.start).map(e => {
    const a = toMin(e.start); let z = e.end ? toMin(e.end) : a + 60; if (z <= a) z = a + 60;
    return {kind:'ev', title:e.title, a, z};
  }).sort((x, y) => x.a - y.a);
  const allday = evs.filter(e => !e.start).map(e => e.title);
  const j = new Date(Date.now() + 9 * 3600e3);
  const isToday = j.toISOString().slice(0, 10) === state.today;
  let cur = WORK_START;
  if (isToday) cur = Math.max(cur, Math.ceil((j.getUTCHours() * 60 + j.getUTCMinutes()) / 15) * 15);
  const order = [...openT].sort((x, y) => (x['期限'] || '9999') < (y['期限'] || '9999') ? -1 : (x['期限'] || '9999') > (y['期限'] || '9999') ? 1 : bizOrder(x['事業']) - bizOrder(y['事業']));
  const placed = [];
  order.forEach(t => {
    const dur = Math.max(5, +t['見込み分'] || DEFAULT_MIN);
    let moved = true;
    while (moved){ moved = false;
      for (const f of fixed){ if (cur < f.z && cur + dur > f.a){ cur = f.z; moved = true; } }
    }
    placed.push({kind:'task', t, title: sum(t), a: cur, z: cur + dur, est: !t['見込み分'], over: cur + dur > WORK_END});
    cur += dur;
  });
  const items = [...fixed, ...placed].sort((x, y) => x.a - y.a);
  const over = placed.filter(x => x.over).length;
  const lastEnd = placed.length ? placed[placed.length - 1].z : cur;
  return {items, allday, over, lastEnd, total: placed.reduce((n, x) => n + x.z - x.a, 0)};
}
function timelineHtml(openT){
  const S = buildSchedule(openT);
  const lo = Math.min(WORK_START, ...S.items.map(x => x.a)), hi = Math.max(WORK_END, ...S.items.filter(x => x.kind === 'ev').map(x => x.z));
  const H0 = Math.floor(lo / 60), H1 = Math.min(24, Math.ceil(hi / 60));
  const pos = m => Math.max(0, Math.min(100, (m / 60 - H0) / (H1 - H0) * 100));
  const bar = S.items.map(x => `<i class="${x.kind === 'task' ? 'tent' : ''}" style="left:${pos(x.a)}%;width:${Math.max(pos(x.z) - pos(x.a), 1)}%;${x.kind === 'task' ? `--c:var(${bizVar(x.t['事業'])})` : ''}"></i>`).join('');
  const hrs = []; for (let h = H0; h <= H1; h += (H1 - H0 > 10 ? 3 : 2)) hrs.push(h);
  const ticks = hrs.map(h => `<b style="left:${pos(h * 60)}%"></b>`).join('');
  const labels = hrs.map(h => `<span style="left:${pos(h * 60)}%">${h}</span>`).join('');
  const rows = S.items.map(x => x.kind === 'ev'
    ? `<div class="sc sc-ev"><span class="sc-t">${hm(x.a)}–${hm(x.z)}</span><span class="sc-n">${esc(x.title)}</span><span class="sc-tag">予定</span></div>`
    : `<button class="sc sc-task tap ${x.over ? 'over' : ''}" data-act="view" data-id="${esc(x.t.ID)}" style="--c:var(${bizVar(x.t['事業'])})"><span class="sc-t">${hm(x.a)}–${hm(x.z)}</span><span class="sc-n">${esc(x.title)}</span><span class="sc-tag">仮${x.est ? '・時間未設定' : ''}${x.over ? '・時間外' : ''}</span></button>`).join('');
  const note = S.over ? `<div class="sc-warn">${hm(WORK_END)}までに入りきらない分が${S.over}件あります（約${Math.ceil((S.lastEnd - WORK_END) / 15) * 15}分オーバー）</div>` : '';
  return `<div class="tl"><div class="tl-bar">${ticks}${bar}</div><div class="tl-ax">${labels}</div>
    <details class="sched" open><summary>今日の仮の時間割 <span class="n">カレンダーの予定は固定／タスクは仮置き（カレンダーには書きません）</span></summary>
      ${S.allday.length ? `<div class="sc-all">終日：${S.allday.map(esc).join('　')}</div>` : ''}
      <div class="sc-list">${rows || '<p class="empty-note">今日の予定・タスクはありません。</p>'}</div>${note}
    </details></div>`;
}

function errBox(e){
  const m = String(e.message || e);
  const msg = m === 'unauthorized' ? '合言葉が一致しません。設定を確認してください。'
    : m === 'not_configured' ? '接続先が未設定です。'
    : /Failed to fetch|NetworkError|Load failed/.test(m) ? '通信できませんでした。前回読み込んだ内容を表示しています。'
    : 'エラー：' + m;
  return `<div class="err" role="alert">${esc(msg)}</div>`;
}

function taskItem(t, opt = {}){
  const isDone = t['状態'] === '済';
  const st = t['状態'] === '待ち' || t['状態'] === '保留' ? `<span class="chip wait">${esc(t['状態'])}</span>` : '';
  const subs = subsOf(t);
  const meta = [
    `<span class="biz">${esc(t['事業'] || '事業未設定')}</span>`,
    subs.length ? `<span class="sub-chip">サブ ${subs.filter(x => x.done).length}/${subs.length}</span>` : '',
    opt.showDate && t['日付'] ? esc(mdShort(t['日付'])) : '',
    t['期限'] ? `<span class="${t['期限'] < state.today && !isDone ? 'due-over' : ''}">期限 ${esc(mdShort(t['期限']))}</span>` : '',
    !opt.brief && t['見込み分'] ? esc(t['見込み分']) + '分' : '',
    !opt.brief && t['メモ'] ? esc(t['メモ']) : '',
  ].filter(Boolean).join('　');
  return `<div class="item ${isDone?'is-done':''}" style="--c:var(${bizVar(t['事業'])})">
    <button class="check" data-act="toggle" data-id="${esc(t.ID)}" aria-label="${isDone?'未完了に戻す':'完了にする'}：${esc(t['内容'])}">
      <svg viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2.4"><path d="M3 8.5l3.2 3L13 4.5"/></svg>
    </button>
    <button class="body tap" data-act="view" data-id="${esc(t.ID)}">
      <div class="title">${esc(opt.brief ? sum(t) : t['内容'])}${st}</div>
      <div class="meta">${meta}</div>
    </button>
  </div>`;
}

function carryItem(t){
  return `<div class="item" style="--c:var(${bizVar(t['事業'])})">
    <button class="body tap" data-act="view" data-id="${esc(t.ID)}">
      <div class="title">${esc(t['内容'])}</div>
      <div class="meta"><span class="biz">${esc(t['事業'] || '事業未設定')}</span>　${esc(mdShort(t['日付']))}の分</div>
    </button>
    <div class="acts">
      <button class="btn-s keep" data-act="keep" data-id="${esc(t.ID)}">今日やる</button>
      <button class="btn-s drop" data-act="drop" data-id="${esc(t.ID)}">やめる</button>
    </div>
  </div>`;
}

// 確認リスト：AIが拾った項目（スプシ「確認」タブ）。種類のタグ付き。済／あとで／不要で片づける
const CHECK_HOT = ['返信漏れ', '期限'];
function checkItem(c){
  const later = c['状態'] === 'あとで';
  const meta = [c['出所'] ? esc(c['出所']) : '', c['期限'] ? `期限 ${esc(mdShort(c['期限']))}` : '', c['メモ'] ? esc(c['メモ']) : ''].filter(Boolean).join('　');
  return `<div class="item chk ${later ? 'later' : ''}">
    <div class="body">
      <div class="title"><span class="kind ${CHECK_HOT.includes(c['種類']) ? 'hot' : ''}">${esc(c['種類'] || '確認')}</span>${esc(c['内容'])}</div>
      ${meta ? `<div class="meta">${meta}</div>` : ''}
    </div>
    <div class="acts">
      <button class="btn-s keep" data-act="check-done" data-id="${esc(c['ID'])}">済</button>
      ${later ? '' : `<button class="btn-s" data-act="check-later" data-id="${esc(c['ID'])}">あとで</button>`}
      <button class="btn-s drop" data-act="check-drop" data-id="${esc(c['ID'])}">不要</button>
    </div>
  </div>`;
}

function candItem(c){
  return `<div class="item cand">
    <div class="body">
      <div class="title"><span class="kind">候補</span>${esc(c['原文'])}</div>
      <div class="meta">${esc(String(c['日時']).slice(5, 10).replace('-','/'))}</div>
    </div>
    <div class="acts">
      <button class="btn-s keep" data-act="cand-take" data-id="${esc(c['行ID'])}">載せる</button>
      <button class="btn-s drop" data-act="cand-drop" data-id="${esc(c['行ID'])}">不要</button>
    </div>
  </div>`;
}

// カレンダーの予定（チェック丸なし。終日は時刻の代わりに「終日」）
const eventsOn = day => (state.events || []).filter(e => e.date === day)
  .sort((a,b) => (a.start || '') < (b.start || '') ? -1 : 1);
function eventsHtml(day){
  const evs = eventsOn(day);
  if (!evs.length) return '';
  return `<div class="list ev-list">${evs.map(e => `<div class="item ev">
    <div class="ev-time">${e.start ? esc(e.start) : '終日'}</div>
    <div class="body"><div class="title">${esc(e.title)}</div>${e.start && e.end ? `<div class="meta">〜${esc(e.end)}</div>` : ''}</div>
  </div>`).join('')}</div>`;
}

// カレンダー：明日から7日間を横に並べる。狭い画面は点だけ出して、タップした日の中身を下に出す
let calSel = null;
function calTask(t){
  const done = t['状態'] === '済', wait = t['状態'] === '待ち' || t['状態'] === '保留';
  return `<div class="cal-task ${done?'is-done':''}" style="--c:var(${bizVar(t['事業'])})">
    <button class="cal-chk" data-act="toggle" data-id="${esc(t.ID)}" aria-label="${done?'未完了に戻す':'完了にする'}：${esc(t['内容'])}"></button>
    <button class="tap cal-title" data-act="view" data-id="${esc(t.ID)}">${esc(sum(t))}${wait ? `<span class="chip wait">${esc(t['状態'])}</span>` : ''}</button>
  </div>`;
}
// 完了したタスク（各欄の右下の「完了 N件」）
const doneOpen = {};
function doneList(kind){
  const t0 = state.today, in7 = addDays(t0, 7);
  const day = t => String(t['完了日時'] || '').slice(0, 10);
  const seen = new Set(), out = [];
  allTasks().forEach(t => {
    if (t['状態'] !== '済' || seen.has(t.ID)) return;
    const d = t['日付'] || '';
    const ok = kind === 'today' ? (d === t0 || day(t) === t0)
      : kind === 'upcoming' ? (d > t0 && d <= in7)
      : kind === 'someday' ? (!d && day(t) !== '' && day(t) >= addDays(t0, -14))
      : false;
    if (ok){ seen.add(t.ID); out.push(t); }
  });
  return out.sort((a, b) => String(b['完了日時'] || '') < String(a['完了日時'] || '') ? -1 : 1);
}
function doneBox(kind){
  const list = doneList(kind);
  if (!list.length) return '';
  return `<div class="done-wrap"><details class="done-box" data-kind="${kind}" ${doneOpen[kind] ? 'open' : ''}>
    <summary>完了 ${list.length}件</summary>
    <div class="list">${list.map(t => taskItem(t, {showDate: kind !== 'today', brief: kind === 'upcoming', view: kind === 'upcoming'})).join('')}</div>
  </details></div>`;
}
document.addEventListener('toggle', e => {
  const d = e.target;
  if (d.classList && d.classList.contains('done-box')) doneOpen[d.dataset.kind] = d.open;
}, true);

function upcomingHtml(){
  const ups = (state.upcoming || []).filter(t => t['状態'] !== '済');
  const days = Array.from({length: 7}, (_, i) => addDays(state.today, i + 1));
  const rows = days.map((day, n) => {
    const ts = ups.filter(t => t['日付'] === day), es = eventsOn(day);
    const wd = new Date(day + 'T00:00:00Z').getUTCDay();
    const label = (n === 0 || +day.slice(8) === 1 ? `<span class="mo">${+day.slice(5, 7)}/</span>` : '') + +day.slice(8);
    const items = es.map(e => `<div class="cal-ev"><span>${e.start ? esc(e.start) : '終日'}</span>${esc(e.title)}</div>`).join('')
      + ts.map(calTask).join('');
    return `<div class="cal-row ${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''} ${items ? '' : 'empty'}">
      <div class="cal-h"><b>${label}</b><small>${WD[wd]}</small></div>
      <div class="cal-items">${items || '<span class="cal-none">予定・タスクなし</span>'}</div>
    </div>`;
  }).join('');
  return `<section id="cal">
    <h2>これから <span class="n">7日間・タスク${ups.length}件</span><button class="link h-act" data-act="month">月カレンダー</button></h2>
    <div class="cal-rows">${rows}</div>
    ${doneBox('upcoming')}
  </section>`;
}

// 事業を横に並べ、その下に担当している業務（スプシの「業務」タブ）。タップで、その事業で動いているプロジェクトを見る
function bizList(){
  const ps = state.projects || [], ws = state.works || [];
  const list = BIZ.filter(b => ws.some(w => w['事業'] === b.name) || ps.some(p => p['事業'] === b.name));
  if (ps.some(p => bizOrder(p['事業']) === 99)) list.push({name:'事業未設定', v:'--b-self'});
  return list;
}
function worksHtml(){
  const ws = state.works || [], ps = state.projects || [], today = state.today;
  const cols = bizList();
  if (!cols.length) return '';
  return `<section class="works-sec">
    <h2>事業 <span class="n">タップで動いているプロジェクト</span></h2>
    <div class="works">${cols.map(b => {
      const items = ws.filter(w => w['事業'] === b.name);
      const pj = ps.filter(p => b.name === '事業未設定' ? bizOrder(p['事業']) === 99 : p['事業'] === b.name);
      const over = pj.some(p => p['期限'] && p['期限'] < today);
      return `<button class="wcard" data-act="bizview" data-biz="${esc(b.name)}" style="--c:var(${b.v})">
        <h3>${esc(b.name)}</h3>
        <ul>${items.map(w => `<li>${esc(w['業務'])}</li>`).join('')}</ul>
        <div class="wfoot ${over?'due-over':''}">プロジェクト ${pj.length}件${over?'・期限切れあり':''}</div>
      </button>`;
    }).join('')}</div>
  </section>`;
}

function goalsHtml(){
  const gs = state.goals || [];
  const block = (kind) => {
    const list = gs.filter(g => g['種類'] === kind)
      .sort((a,b) => bizOrder(a['事業']) - bizOrder(b['事業']));
    return `<div class="goal-block"><h3>${kind === '自分' ? '自分の目標' : '事業の目標'}</h3>
      ${list.length ? list.map(g => `<div class="goal"${g['事業'] ? ` style="--c:var(${bizVar(g['事業'])})"` : ''}>
        ${g['事業'] ? `<div class="gbiz">${esc(g['事業'])}</div>` : ''}
        <div class="gt">${esc(g['内容'])}</div>
        <dl>
          ${g['期間'] ? `<dt>期間</dt><dd>${esc(g['期間'])}</dd>` : ''}
          ${g['指標'] ? `<dt>指標</dt><dd>${esc(g['指標'])}</dd>` : ''}
          ${g['現状'] ? `<dt>現状</dt><dd>${esc(g['現状'])}</dd>` : ''}
        </dl></div>`).join('')
      : `<div class="meta">まだ書かれていません。</div>`}
    </div>`;
  };
  return `<section><h2>目標</h2><div class="goals">${block('自分')}${block('事業')}</div></section>`;
}

function decisionsHtml(){
  const ds = state.decisions || [];
  if (!ds.length) return '';
  const item = d => {
    const proj = d['プロジェクト名'] || d['プロジェクトID'];
    const url = /^https:\/\//.test(d['チャットURL']) ? d['チャットURL'] : '';
    return `<div class="item dec ${d['状態']==='撤回'?'is-void':''}" style="--c:var(${bizVar(projBiz(d['プロジェクトID']))})"><div class="body">
      <div class="title">${esc(d['内容'])}${d['状態'] ? `<span class="chip st-${esc(d['状態'])}">${esc(d['状態'])}</span>` : ''}</div>
      ${d['理由・却下案'] ? `<div class="why">${esc(d['理由・却下案'])}</div>` : ''}
      <div class="meta">${esc(String(d['日時']).slice(5).replace('-','/'))}${proj ? '　' + esc(proj) : ''}${url ? `　<a href="${esc(url)}" target="_blank" rel="noopener">チャット</a>` : ''}</div>
    </div></div>`;
  };
  const head = ds.slice(0, 5), rest = ds.slice(5);
  return `<section>
    <h2>決定ログ <span class="n">新しい順</span></h2>
    <div class="list">${head.map(item).join('')}</div>
    ${rest.length ? `<details class="more"><summary>さらに${rest.length}件</summary><div class="list">${rest.map(item).join('')}</div></details>` : ''}
  </section>`;
}
const projBiz = id => ((state.projects || []).find(p => p.ID === id) || {})['事業'];

/* ---------- 操作 ---------- */
const allTasks = () => [...state.tasks, ...state.carry, ...(state.upcoming||[]), ...(state.waiting||[]), ...(state.someday||[]), ...(state.projTasks||[]), ...(state.calTasks||[]), ...(state.recentDone||[])];
const findTask = id => allTasks().find(t => t.ID === id) || (state.calTasks || []).find(t => t.ID === id);

async function act(fnLocal, call, okMsg){
  const backup = JSON.parse(JSON.stringify(state));
  fnLocal(); render();
  try { await call(); store.set('board.cache', state); if (okMsg) toast(okMsg); }
  catch(e){ state = backup; render(); toast('保存できませんでした：' + (e.message || e)); }
}

// 書き込んでから読み直す（編集・追加など、画面の複数の欄にまたがる変更用）
async function save(call, okMsg){
  toast('保存しています');
  try { await call(); toast(okMsg); await load(); }
  catch(e){ toast('保存できませんでした：' + (e.message || e)); }
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id;
  switch (b.dataset.act){
    case 'toggle': {
      const t = findTask(id); if (!t) return;
      const prev = t['状態'], completing = prev !== '済', next = completing ? '済' : '未';
      const run = () => act(() => { allTasks().filter(x => x.ID === id).forEach(x => { x['状態'] = next; x['完了日時'] = completing ? nowStr() : ''; }); },
        () => api('status', {id, status: next}));
      const el = b.closest('.item, .cal-task');
      // 完了にしたものは、すっと消えてから一覧を組み直す。しばらく「元に戻す」を出す
      if (completing && el && !el.closest('dialog')){ el.classList.add('leaving'); setTimeout(run, 210); }
      else run();
      if (completing) showUndo(id, prev);
      break;
    }
    case 'keep': {
      act(() => {
        const t = state.carry.find(x => x.ID === id);
        state.carry = state.carry.filter(x => x.ID !== id);
        t['日付'] = state.today; t['状態'] = '未'; state.tasks.push(t);
      }, () => api('keep', {id}), '今日に移しました');
      break;
    }
    case 'drop': {
      act(() => { state.carry = state.carry.filter(x => x.ID !== id); },
        () => api('status', {id, status:'捨'}), 'やめにしました');
      break;
    }
    case 'edit': { const t = findTask(id); if (t) openTask({mode:'edit', task:t}); break; }
    case 'view': openView(id); break;
    case 'sub': {
      const idx = +b.dataset.i;
      const copies = allTasks().filter(x => x.ID === id);
      const flip = () => copies.forEach(x => {
        const lines = String(x['サブタスク'] || '').split(/\r?\n/);
        if (idx < lines.length) lines[idx] = /^✓\s/.test(lines[idx]) ? lines[idx].replace(/^✓\s+/, '') : '✓ ' + lines[idx];
        x['サブタスク'] = lines.join('\n');
      });
      flip(); render();
      api('sub', {id, index: idx}).catch(e => { flip(); render(); toast('保存できませんでした：' + (e.message || e)); });
      break;
    }
    case 'bizview': openBiz(b.dataset.biz); break;
    case 'pedit': { const pr = (state.projects || []).find(x => x.ID === id); if (pr) openProj(pr); break; }
    case 'cand-take': {
      const c = (state.candidates || []).find(x => x['行ID'] === id); if (!c) return;
      openTask({mode:'cand', task:{'内容': String(c['原文']).replace(/^\[[^\]]*\]\s*/, ''), '日付': state.today}, inboxId:id});
      break;
    }
    case 'cand-drop': {
      act(() => { state.candidates = state.candidates.filter(x => x['行ID'] !== id); },
        () => api('cand', {rowId:id}), '不要にしました');
      break;
    }
    case 'check-done': case 'check-later': case 'check-drop': {
      const st = {'check-done':'済', 'check-later':'あとで', 'check-drop':'不要'}[b.dataset.act];
      const label = {'済':'済にしました', 'あとで':'あとでに移しました', '不要':'不要にしました'}[st];
      act(() => {
        if (st === 'あとで') (state.checks || []).forEach(x => { if (x.ID === id) x['状態'] = 'あとで'; });
        else state.checks = (state.checks || []).filter(x => x.ID !== id);
      }, () => api('check', {id, status: st}), label);
      break;
    }
    case 'reload': refreshSite(); break;
    case 'month': openMonth(); break;
    case 'mday': mSel = b.dataset.day; fillMonth(); break;
    case 'madd': openTask({mode:'add', task:{'日付': b.dataset.day}}); break;
    case 'settings': openSettings(); break;
  }
});

/* タスクの追加・編集ダイアログ */
const bizRadios = (name) => BIZ.map(b => `<label style="--c:var(${b.v})"><input type="radio" name="${name}" value="${esc(b.name)}"><span>${esc(b.name)}</span></label>`).join('');
$('#bizPick').innerHTML = bizRadios('事業');
$('#pBizPick').innerHTML = bizRadios('事業');
$('#taskForm')['状態'].innerHTML = TASK_STATUS.map(s => `<option>${s}</option>`).join('');
let taskCtx = null;

// ダイアログのボタンは submit で受ける（close イベントは環境によって遅れたり来なかったりするため）
function onDialog(dlgSel, fn){
  const dlg = $(dlgSel), form = dlg.querySelector('form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = e.submitter ? e.submitter.value : 'ok';
    dlg.close(v);
    if (v !== 'cancel') fn(v);
  });
}

function openTask(ctx){
  taskCtx = ctx;
  const f = $('#taskForm'), t = ctx.task || {};
  f.reset();
  $('#taskTitle').textContent = ctx.mode === 'edit' ? 'タスクを編集' : ctx.mode === 'cand' ? '候補をタスクにする' : 'タスクを追加';
  $('#btnTomorrow').hidden = ctx.mode !== 'edit';
  f['内容'].value = t['内容'] || '';
  const date = ctx.mode === 'edit' ? (t['日付'] || '') : (t['日付'] ?? state.today);
  f['日付'].value = date; f.nodate.checked = !date; f['日付'].disabled = !date;
  const biz = t['事業'] || (ctx.mode === 'edit' ? '' : BIZ[0].name);
  [...f.querySelectorAll('input[name="事業"]')].forEach(r => { r.checked = r.value === biz; });
  const ps = state.projects || [];
  const cur = t['プロジェクトID'] || '';
  f['プロジェクトID'].innerHTML = '<option value="">なし</option>'
    + ps.map(p => `<option value="${esc(p.ID)}">${esc(p['名前'])}</option>`).join('')
    + (cur && !ps.some(p => p.ID === cur) ? `<option value="${esc(cur)}">${esc(cur)}（完了済み）</option>` : '');
  f['プロジェクトID'].value = cur;
  f['状態'].value = t['状態'] || '未';
  f['期限'].value = t['期限'] || '';
  f['見込み分'].value = t['見込み分'] || '';
  f['メモ'].value = ctx.mode === 'edit' ? (t['メモ'] || '') : '';
  f['サブタスク'].value = ctx.mode === 'edit' ? (t['サブタスク'] || '') : '';
  $('#taskDlg').showModal();
}
$('#taskForm').nodate.addEventListener('change', e => {
  const d = $('#taskForm')['日付'];
  d.disabled = e.target.checked;
  if (!e.target.checked && !d.value) d.value = state.today;
});

function taskFields(){
  const f = $('#taskForm'), fd = new FormData(f);
  return {
    '内容': String(fd.get('内容') || '').trim(),
    '日付': f.nodate.checked ? '' : f['日付'].value,
    '事業': fd.get('事業') || '',
    'プロジェクトID': f['プロジェクトID'].value,
    '状態': f['状態'].value,
    '期限': f['期限'].value,
    '見込み分': f['見込み分'].value,
    'メモ': String(fd.get('メモ') || '').trim(),
    'サブタスク': String(fd.get('サブタスク') || '').trim(),
  };
}

onDialog('#taskDlg', rv => {
  const ctx = taskCtx;
  if (!ctx) return;
  if (rv === 'tomorrow'){
    const base = ctx.task['日付'] && ctx.task['日付'] >= state.today ? ctx.task['日付'] : state.today;
    const next = addDays(base, 1);
    save(() => api('update', {id:ctx.task.ID, fields:{'日付':next, '状態': ctx.task['状態'] === '繰越' ? '未' : ctx.task['状態']}}), mdShort(next) + 'に移しました');
    return;
  }
  const fields = taskFields();
  if (!fields['内容']) return;
  if (ctx.mode === 'edit'){
    // 変わった列だけ送る
    const diff = {};
    Object.keys(fields).forEach(k => { if (String(ctx.task[k] ?? '').trim() !== String(fields[k]).trim()) diff[k] = fields[k]; });
    if (!Object.keys(diff).length) return;
    save(() => api('update', {id:ctx.task.ID, fields:diff}), '保存しました');
  } else {
    if (!fields['メモ']) delete fields['メモ'];
    if (!fields['サブタスク']) delete fields['サブタスク'];
    save(() => api('add', {fields, inboxId: ctx.inboxId || ''}), '追加しました');
  }
});

/* ---------- タスクの中身（読むだけ。編集はここから） ---------- */
let viewTask = null;
function openView(id){
  const t = findTask(id); if (!t) return;
  viewTask = t;
  renderView();
  if (!$('#taskView').open) $('#taskView').showModal();
}
function renderView(){
  const t = viewTask; if (!t) return;
  const subs = subsOf(t);
  const pj = (state.projects || []).find(x => x.ID === t['プロジェクトID']);
  const rows = [
    ['日付', t['日付'] ? md(t['日付']) : '日付なし'],
    ['事業', t['事業'] || '事業未設定'],
    ['プロジェクト', pj ? pj['名前'] : ''],
    ['状態', t['状態'] || '未'],
    ['期限', t['期限'] ? md(t['期限']) : ''],
    ['見込み', t['見込み分'] ? t['見込み分'] + '分' : ''],
    ['メモ', t['メモ'] || ''],
  ].filter(r => r[1]);
  $('#tvBody').innerHTML = `<p class="tv-text">${esc(t['内容'])}</p>
    ${subs.length ? `<div class="sub-list">${subs.map(x => `<button class="sub-item ${x.done ? 'is-done' : ''}" data-act="sub" data-id="${esc(t.ID)}" data-i="${x.i}"><span class="sub-chk"></span><span class="sub-text">${esc(x.text)}</span></button>`).join('')}</div>` : ''}
    <dl class="tv-dl">${rows.map(r => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl>`;
}
$('#tvClose').addEventListener('click', () => $('#taskView').close());
$('#tvEdit').addEventListener('click', () => { $('#taskView').close(); if (viewTask) openTask({mode:'edit', task:viewTask}); });

/* ---------- サイトの更新（ボタン・引き下げ） ---------- */
function refreshSite(){
  $('#btnRefresh').classList.add('spin');
  toast('更新しています');
  setTimeout(() => location.reload(), 150);
}
// スマホ：いちばん上で下に引くと更新
(function(){
  const ind = $('#ptr'); let y0 = 0, dy = 0, on = false;
  const reset = () => { on = false; dy = 0; ind.style.opacity = 0; ind.classList.remove('ready'); ind.textContent = '↓ 引いて更新'; };
  addEventListener('touchstart', e => {
    if (window.scrollY > 0 || document.querySelector('dialog[open]') || e.touches.length !== 1) return;
    on = true; y0 = e.touches[0].clientY; dy = 0;
  }, {passive:true});
  addEventListener('touchmove', e => {
    if (!on) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || window.scrollY > 0){ ind.style.opacity = 0; return; }
    ind.style.opacity = Math.min(dy / 60, 1);
    const ready = dy > 70;
    ind.classList.toggle('ready', ready);
    ind.textContent = ready ? '離して更新' : '↓ 引いて更新';
  }, {passive:true});
  addEventListener('touchend', () => { const go = on && dy > 70; reset(); if (go) refreshSite(); });
  addEventListener('touchcancel', reset);
})();

/* ---------- 月カレンダー（前後の月へ送って、全部の月のタスクと予定を簡易表示） ---------- */
let mYM = '', mSel = '';
const evCache = {};
const ymOf = ymd => String(ymd).slice(0, 7);
function openMonth(){
  mYM = ymOf(state.today); mSel = state.today;
  fillMonth();
  $('#monthDlg').showModal();
}
function shiftMonth(n){
  const d = new Date(mYM + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n);
  mYM = d.toISOString().slice(0, 7); mSel = ''; fillMonth();
}
function evListHtml(evs){
  if (!evs.length) return '';
  return `<div class="list ev-list">${evs.map(e => `<div class="item ev">
    <div class="ev-time">${e.start ? esc(e.start) : '終日'}</div>
    <div class="body"><div class="title">${esc(e.title)}</div>${e.start && e.end ? `<div class="meta">〜${esc(e.end)}</div>` : ''}</div>
  </div>`).join('')}</div>`;
}
function fillMonth(){
  const first = mYM + '-01';
  const start = addDays(first, -new Date(first + 'T00:00:00Z').getUTCDay());
  const end = addDays(start, 42);
  const key = start + '_' + end;
  if (!evCache[key]){
    evCache[key] = 'loading';
    const done = r => { evCache[key] = r; if ($('#monthDlg').open) fillMonth(); };
    api('events', {from:start, to:end}).then(done).catch(() => done([]));
  }
  const evs = Array.isArray(evCache[key]) ? evCache[key] : [];
  const byDay = {};
  (state.calTasks || []).forEach(t => { (byDay[t['日付']] = byDay[t['日付']] || []).push(t); });
  const sortT = a => a.slice().sort((x, y) => (x['状態']==='済') - (y['状態']==='済') || bizOrder(x['事業']) - bizOrder(y['事業']));
  const cells = [];
  for (let i = 0; i < 42; i++){
    const day = addDays(start, i), wd = i % 7;
    const ts = sortT(byDay[day] || []), es = evs.filter(e => e.date === day);
    const dots = es.map(() => '<i class="dot ev"></i>').join('')
      + ts.slice(0, 8).map(t => `<i class="dot" style="--c:var(${bizVar(t['事業'])})"></i>`).join('');
    cells.push(`<div class="m-cell ${ymOf(day) !== mYM ? 'dim' : ''} ${day === state.today ? 'today' : ''} ${day === mSel ? 'sel' : ''} ${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}" data-act="mday" data-day="${day}">
      <div class="m-d">${+day.slice(8)}</div>
      <div class="m-full">
        ${es.slice(0, 2).map(e => `<div class="m-ev">${esc(e.title)}</div>`).join('')}
        ${ts.slice(0, 3).map(t => `<button class="m-t ${t['状態']==='済' ? 'is-done' : ''}" data-act="view" data-id="${esc(t.ID)}" style="--c:var(${bizVar(t['事業'])})">${esc(sum(t))}</button>`).join('')}
        ${ts.length > 3 ? `<div class="m-more">ほか${ts.length - 3}件</div>` : ''}
      </div>
      <div class="m-dots">${dots}</div>
    </div>`);
  }
  $('#mTitle').textContent = `${mYM.slice(0, 4)}年${+mYM.slice(5)}月`;
  $('#mGrid').innerHTML = cells.join('');
  const dts = mSel ? sortT(byDay[mSel] || []) : [], des = mSel ? evs.filter(e => e.date === mSel) : [];
  $('#mDetail').innerHTML = mSel ? `
    <div class="day-head">${esc(md(mSel))}</div>
    ${evListHtml(des)}
    ${dts.length ? `<div class="list">${dts.map(t => taskItem(t, {brief:true, view:true})).join('')}</div>`
      : (des.length ? '' : '<p class="empty-note">この日のタスクと予定はありません。</p>')}
    <div class="row-btns" style="margin-top:10px"><button class="btn sec" data-act="madd" data-day="${mSel}">＋ この日にタスクを足す</button></div>` : '';
}
$('#mPrev').addEventListener('click', () => shiftMonth(-1));
$('#mNext').addEventListener('click', () => shiftMonth(1));
$('#mToday').addEventListener('click', () => { mYM = ymOf(state.today); mSel = state.today; fillMonth(); });
$('#mClose').addEventListener('click', () => $('#monthDlg').close());

/* 事業の中身（この事業で動いているプロジェクト） */
let projCtx = null, curBiz = '';
function openBiz(name){
  curBiz = name;
  fillBiz();
  $('#bizView').showModal();
}
function fillBiz(){
  const today = state.today;
  const ps = (state.projects || []).filter(p => curBiz === '事業未設定' ? bizOrder(p['事業']) === 99 : p['事業'] === curBiz);
  const ws = (state.works || []).filter(w => w['事業'] === curBiz);
  $('#bvTitle').textContent = curBiz;
  $('#bvTitle').style.color = `var(${bizVar(curBiz)})`;
  $('#bvBody').innerHTML = `
    <div class="bv-sec">動いているプロジェクト</div>
    ${ps.length ? `<div class="list">${ps.map(p => {
      const over = p['期限'] && p['期限'] < today;
      return `<button class="item proj tap" data-act="pedit" data-id="${esc(p.ID)}" style="--c:var(${bizVar(p['事業'])})"><div class="body">
        <div class="title">${esc(p['名前'])}${p['状態']==='待ち' ? '<span class="chip wait">待ち</span>' : ''}</div>
        ${p['次の一手'] ? `<div class="next">${esc(p['次の一手'])}</div>` : ''}
        ${p['期限'] ? `<div class="meta ${over?'due-over':''}">期限 ${esc(mdShort(p['期限']))}${over?'（過ぎています）':''}</div>` : ''}
      </div></button>`;
    }).join('')}</div>` : '<p class="empty-note">動いているプロジェクトはまだありません。下の「＋ プロジェクトを足す」か、Claudeに伝えて追加します。</p>'}
    ${ws.length ? `<div class="bv-sec">担当している業務</div><div class="bv-works">${ws.map(w => `<span>${esc(w['業務'])}</span>`).join('')}</div>` : ''}`;
}
$('#bvClose').addEventListener('click', () => $('#bizView').close());
$('#bvAdd').addEventListener('click', () => openProj(null, curBiz === '事業未設定' ? '' : curBiz));

function openProj(p, defBiz){
  projCtx = p;
  const f = $('#projForm'); f.reset();
  $('#projTitle').textContent = p ? 'プロジェクトを編集' : 'プロジェクトを追加';
  f['名前'].value = p ? p['名前'] : '';
  const biz = p ? p['事業'] : (defBiz || BIZ[0].name);
  [...f.querySelectorAll('input[name="事業"]')].forEach(r => { r.checked = r.value === biz; });
  f['状態'].value = p ? p['状態'] || '進行中' : '進行中';
  f['期限'].value = p ? p['期限'] || '' : '';
  f['次の一手'].value = p ? p['次の一手'] || '' : '';
  $('#projDlg').showModal();
}
onDialog('#projDlg', () => {
  const f = $('#projForm'), fd = new FormData(f);
  const fields = {'名前': String(fd.get('名前')||'').trim(), '事業': fd.get('事業') || '', '状態': f['状態'].value, '期限': f['期限'].value, '次の一手': String(fd.get('次の一手')||'').trim()};
  if (!fields['名前']) return;
  if (projCtx){
    const diff = {};
    Object.keys(fields).forEach(k => { if (String(projCtx[k] ?? '') !== fields[k]) diff[k] = fields[k]; });
    if (!Object.keys(diff).length) return;
    save(() => api('pupdate', {id:projCtx.ID, fields:diff}), '保存しました');
  } else {
    save(() => api('padd', {fields}), '追加しました');
  }
});

$('#fab').addEventListener('click', () => {
  if (!cfg.url){ openSettings(); return; }
  if (!state) return;
  openTask({mode:'add', task:{'日付': state.today}});
});

/* 定期タスク */
let recRows = [];
function recHtml(){
  if (!recRows.length) return '<p class="empty-note">定期タスクはまだありません。スプシの「定期」タブに行を足します。</p>';
  return recRows.map(r => {
    const on = String(r['有効']).toUpperCase() === 'TRUE';
    const when = r['周期'] === '直売日前日' ? '直売日（カレンダーの「直売事務所」）の前日'
      : `${r['周期']}　開始 ${r['開始日'] || '—'}${r['期限日'] && r['期限日'] !== r['開始日'] ? '／期限 ' + r['期限日'] : ''}`;
    return `<form class="rec" data-id="${esc(r.ID)}" style="--c:var(${bizVar(r['事業'])})">
      <div class="rec-h"><b>${esc(r['名前'])}</b><label class="chk"><input type="checkbox" name="有効" ${on ? 'checked' : ''}> 有効</label></div>
      <div class="meta"><span class="biz">${esc(r['事業'] || '事業未設定')}</span>　${esc(when)}</div>
      <div class="field-row">
        <label class="field narrow"><span>見込み分</span><input type="number" name="見込み分" min="0" step="5" value="${esc(r['見込み分'])}"></label>
      </div>
      <label class="field"><span>手順（1行に1つ）</span><textarea name="手順" class="short">${esc(r['手順'])}</textarea></label>
      <div class="row-btns"><button class="btn sec" type="submit">この行を保存</button></div>
    </form>`;
  }).join('');
}
async function openRecur(){
  $('#setDlg').close();
  $('#recBody').innerHTML = '<p class="empty-note">読み込んでいます…</p>';
  $('#recDlg').showModal();
  try { recRows = (await api('recur')).filter(r => r.ID && r['名前']); $('#recBody').innerHTML = recHtml(); }
  catch(e){ $('#recBody').innerHTML = errBox(e); }
}
$('#btnRecur').addEventListener('click', openRecur);
$('#recClose').addEventListener('click', () => $('#recDlg').close());
$('#recBody').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, id = f.dataset.id, r = recRows.find(x => x.ID === id); if (!r) return;
  const fields = {'有効': f['有効'].checked ? 'TRUE' : 'FALSE', '見込み分': f['見込み分'].value, '手順': f['手順'].value.trim()};
  const diff = {};
  Object.keys(fields).forEach(k => { if (String(r[k] ?? '').toUpperCase() !== String(fields[k]).toUpperCase()) diff[k] = fields[k]; });
  if (!Object.keys(diff).length){ toast('変更はありません'); return; }
  toast('保存しています');
  try { await api('rupdate', {id, fields:diff}); Object.assign(r, fields); toast('保存しました'); }
  catch(err){ toast('保存できませんでした：' + (err.message || err)); }
});

/* 設定 */
function openSettings(){
  const f = $('#setForm'); f.url.value = cfg.url || ''; f.key.value = cfg.key || '';
  $('#setDlg').showModal();
}
onDialog('#setDlg', () => {
  const f = $('#setForm');
  cfg = {url: f.url.value.trim(), key: f.key.value.trim()};
  store.set('board.cfg', cfg); state = null; store.set('board.cache', null);
  render(); load();
});

/* 戻ってきた時に自動更新（ダイアログを開いている間はしない） */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && cfg.url && !document.querySelector('dialog[open]')) load();
});

/* ---------- 見本データ（URLに demo） ---------- */
let demo = null;
function demoApi(action, p){
  const ymd = dt => new Date(dt.getTime() + 9*3600e3).toISOString().slice(0,10);
  const today = ymd(new Date()), day = n => addDays(today, n);
  if (!demo) demo = {
    tasks:[
      {ID:'T1','日付':today,'内容':'週末イベントのスタッフ名簿を送る','事業':'ギガネット（通信）','状態':'未','メモ':'','期限':'','見込み分':'15','サブタスク':'名簿を作る\n✓ 人数を確認する\n担当者に送る'},
      {ID:'T2','日付':today,'内容':'交通費申請の未提出者にリマインド','事業':'ギガネット（通信）','状態':'済','メモ':''},
      {ID:'T3','日付':today,'内容':'新商品の箱 修正版を確認に出す','事業':'円山製麺','状態':'未','メモ':'','プロジェクトID':'P3'},
      {ID:'T5','日付':today,'内容':'メニューPOPの英語表記を確認','事業':'SHEEP GANG','状態':'未','メモ':''},
      {ID:'T0','日付':day(-1),'内容':'インスタ ストーリー投稿','事業':'円山製麺','状態':'未','メモ':''},
      {ID:'T7','日付':day(2),'内容':'売り場の全体デザイン提案','事業':'円山製麺','状態':'未','メモ':'','プロジェクトID':'P3','期限':day(2)},
      {ID:'T8','日付':day(5),'内容':'月初の交通費回収','事業':'エルダイブ','状態':'未','メモ':''},
      {ID:'T9','日付':day(1),'内容':'契約書の返送','事業':'ギガネット（通信）','状態':'待ち','メモ':'先方の確認待ち','期限':day(4)},
      {ID:'T10','日付':'','内容':'経費精算','事業':'エルダイブ','状態':'保留','メモ':'月末にまとめる'},
    ],
    events:[
      {date:today, start:'10:00', end:'18:00', title:'事務所'},
      {date:day(2), start:'', end:'', title:'直売事務所'},
      {date:day(4), start:'09:30', end:'17:00', title:'イベント会場'},
    ],
    works:[
      {ID:'W1','事業':'ギガネット（通信）','業務':'ポスター作製','順番':'1'},
      {ID:'W2','事業':'ギガネット（通信）','業務':'勤怠管理','順番':'2'},
      {ID:'W3','事業':'円山製麺','業務':'物産展企画','順番':'1'},
      {ID:'W4','事業':'円山製麺','業務':'直売所','順番':'2'},
      {ID:'W5','事業':'SHEEP GANG','業務':'印刷物','順番':'1'},
      {ID:'W6','事業':'SHEEP GANG','業務':'名刺','順番':'2'},
      {ID:'W7','事業':'SHEEP GANG','業務':'ポスター','順番':'3'},
      {ID:'W8','事業':'エルダイブ','業務':'ユナイト管理','順番':'1'},
    ],
    recur:[
      {ID:'R1','名前':'スタッフ交通費回収','事業':'エルダイブ','周期':'毎月','開始日':'1','期限日':'1','見込み分':'30','手順':'','有効':'TRUE','メモ':''},
      {ID:'R2','名前':'直売前の印刷業務','事業':'円山製麺','周期':'直売日前日','開始日':'','期限日':'','見込み分':'','手順':'賞味期限ラベル確認・印刷\nちらし印刷','有効':'TRUE','メモ':''},
    ],
    inbox:[{'行ID':'L1','日時':today+' 09:00','原文':'[Todoist] チラシを作るか検討','仕分け先':'候補（未確認）'}],
    checks:[
      {ID:'K1','種類':'返信漏れ','内容':'ご担当者さまからの見積もり依頼に返信していない','出所':'Gmail　山田商店 山田様　10/16','関連ID':'','状態':'未','期限':'','作成日時':today+' 08:00','メモ':''},
      {ID:'K2','種類':'待ち放置','内容':'契約書の返送：待ちのまま3日たっています','出所':'ボード','関連ID':'T9','状態':'未','期限':day(4),'作成日時':today+' 08:00','メモ':''},
      {ID:'K3','種類':'準備不足','内容':'明後日の直売事務所の前に、印刷物の準備タスクがありません','出所':'カレンダー','関連ID':'','状態':'未','期限':day(2),'作成日時':today+' 08:00','メモ':''},
      {ID:'K4','種類':'確認','内容':'経費精算は月末にまとめる、でよいですか？','出所':'AIからの質問','関連ID':'T10','状態':'あとで','期限':'','作成日時':today+' 08:00','メモ':''},
    ],
    projects:[
      {ID:'P1','名前':'ショッピングモール催事','事業':'ギガネット（通信）','状態':'進行中','次の一手':'駐車場の台数を確定','期限':day(12)},
      {ID:'P3','名前':'新商品パッケージ','事業':'円山製麺','状態':'進行中','次の一手':'箱の入稿データ作成','期限':day(-1)},
      {ID:'P5','名前':'社内ToDoアプリ','事業':'エルダイブ','状態':'待ち','次の一手':'3人で公開範囲を決める','期限':''},
    ],
    goals:[
      {ID:'G1','種類':'自分','期間':'月','内容':'週報を記録から自動で作れる状態にする','指標':'週報作成 1時間以内','現状':'ボード運用開始'},
      {ID:'G2','種類':'事業','期間':'週','内容':'店舗 1週間の売上目標を達成','指標':'週の売上','現状':'','事業':'円山製麺'},
    ],
    decisions:[
      {'日時':today+' 11:20','プロジェクトID':'P3','プロジェクト名':'新商品パッケージ','内容':'説明書は箱と別紙にする','状態':'確定','理由・却下案':'箱に印刷すると修正のたびに版代がかかる。却下案：箱の内側に印刷','チャットURL':'https://claude.ai/'},
    ],
  };
  const T = demo.tasks, find = id => T.find(x => x.ID === id);
  const open = s => s === '未' || s === '' || s === '繰越', wait = s => s === '待ち' || s === '保留';
  return new Promise(r => setTimeout(r, 150)).then(() => {
    if (action === 'data'){
      const in7 = day(7);
      return JSON.parse(JSON.stringify({
        today,
        tasks: T.filter(t => t['日付'] === today && t['状態'] !== '捨' && !wait(t['状態'])),
        carry: T.filter(t => t['日付'] && t['日付'] < today && open(t['状態'])),
        upcoming: T.filter(t => t['日付'] > today && t['日付'] <= in7 && (open(t['状態']) || wait(t['状態']))).sort((a,b) => a['日付'] < b['日付'] ? -1 : 1),
        waiting: T.filter(t => wait(t['状態'])),
        someday: T.filter(t => !t['日付'] && open(t['状態'])),
        projTasks: T.filter(t => t['プロジェクトID'] && t['状態'] !== '捨'),
        projects: demo.projects.filter(x => x['状態'] !== '完了'),
        goals: demo.goals, decisions: demo.decisions,
        candidates: demo.inbox.filter(x => x['仕分け先'] === '候補（未確認）'),
        checks: demo.checks.filter(x => x['状態'] === '未' || x['状態'] === 'あとで'),
        events: demo.events,
        works: demo.works,
        calTasks: T.filter(t => t['日付'] && t['状態'] !== '捨'),
        recentDone: T.filter(t => t['状態'] === '済').map(t => ({...t, '完了日時': t['完了日時'] || (today + ' 09:30')})),
        fetchedAt: today + ' ' + new Date().toTimeString().slice(0,5)
      }));
    }
    if (action === 'status'){ const t = find(p.id); if (t) t['状態'] = p.status; return {}; }
    if (action === 'keep'){ const t = find(p.id); if (t){ t['日付'] = today; t['状態'] = '未'; } return {}; }
    if (action === 'add'){
      const id = 'T' + Date.now(); const f = p.fields || {'内容':p.text,'事業':p.biz};
      T.push({ID:id, '日付': '日付' in f ? f['日付'] : today, '状態':'未', 'メモ':'', ...f});
      if (p.inboxId){ const c = demo.inbox.find(x => x['行ID'] === p.inboxId); if (c){ c['仕分け先'] = 'タスク追加'; c['反映先ID'] = id; } }
      return {id};
    }
    if (action === 'update'){ Object.assign(find(p.id), p.fields); return {}; }
    if (action === 'padd'){ const id = 'P' + Date.now(); demo.projects.push({ID:id, ...p.fields}); return {id}; }
    if (action === 'pupdate'){ Object.assign(demo.projects.find(x => x.ID === p.id), p.fields); return {}; }
    if (action === 'recur') return JSON.parse(JSON.stringify(demo.recur));
    if (action === 'events') return JSON.parse(JSON.stringify(demo.events.filter(e => e.date >= p.from && e.date < p.to)));
    if (action === 'rupdate'){ Object.assign(demo.recur.find(x => x.ID === p.id), p.fields); return {}; }
    if (action === 'check'){ const c = demo.checks.find(x => x.ID === p.id); if (c) c['状態'] = p.status; return {}; }
    if (action === 'cand'){ const c = demo.inbox.find(x => x['行ID'] === p.rowId); if (c) c['仕分け先'] = '候補（不要）'; return {}; }
  });
}

/* 起動 */
render();
if (cfg.url) load();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
