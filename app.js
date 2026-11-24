/* app.js — WebPost (UI 재설계판)
 *
 * 화면은 셋뿐이다: 목록(feed) · 글(post view) · 쓰기(editor).
 * 시트를 없앴다. 글은 오른쪽에서 페이지로 들어오고, 뒤로 가면 빠져나간다.
 * 안드로이드 뒤로가기도 같은 길로 동작한다(history).
 *
 * 저장소·검색·본문 렌더는 검증된 코드 그대로 가져왔다.
 */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const VERSION = 'v2.0';
const K = { posts:'webpost.posts.v1', gh:'webpost.gh.v1', theme:'webpost.theme', draft:'webpost.draft.v1' };
const PAGE = 30;

/* ── 저장소 ─────────────────────────────────────────────────────── */
function lsGet(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function lsSet(k, v){ try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }

const pad2 = n => String(n).padStart(2, '0');
function todayStr(){ const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
function dateFull(d){
  const [y, m, dd] = String(d || '').split('-');
  return (y && m && dd) ? `${y}년 ${+m}월 ${+dd}일` : '';
}
function dayLabel(d){ const [, , dd] = String(d || '').split('-'); return dd ? (+dd) + '일' : ''; }
function monthLabel(d){ const [y, m] = String(d || '').split('-'); return (y && m) ? `${y}년 ${+m}월` : ''; }

const SEED = [
  { id:'seed-1', d:'2026-11-24', c: Date.parse('2026-11-24T10:00:00+09:00'), t:'WebPost.',
    b:'여기가 첫 글.\n\nWebPaper 는 세상에서 일어난 일을 모아 두는 종이였고, 이건 내가 겪은 일을 적는 종이. 하루에 한 줄이면 충분하다고 생각한다.' },
  { id:'seed-2', d:'2026-11-20', c: Date.parse('2026-11-20T21:10:00+09:00'), t:'이 글들은 지워도 돼요',
    b:'샘플이다. 오른쪽 위 **+** 로 새 글을 쓰고, 글을 눌러 오른쪽 위 **⋯** 에서 수정·삭제한다.\n\n날짜는 글마다 직접 정할 수 있어서, 오늘 쓴 걸 지난달 자리에 끼워 넣을 수도 있다.' },
  { id:'seed-3', d:'2026-11-08', c: Date.parse('2026-11-08T14:30:00+09:00'), t:'서식',
    b:'본문에서 쓸 수 있는 것:\n\n- **굵게**, *기울임*, `코드`\n- 줄 앞에 > 를 붙이면 인용\n- 사진은 쓰기 화면의 사진 버튼으로\n\n전부 외울 필요는 없다. 그냥 쓰면 그냥 글이다.' },
  { id:'seed-4', d:'2026-10-29', c: Date.parse('2026-10-29T23:40:00+09:00'), t:'',
    b:'10월의 마지막 장. 제목 없이 쓰는 글도 괜찮다.' }
];

const GH = (() => { const c = lsGet(K.gh, null); return (c && c.token && c.owner && c.repo) ? c : null; })();
const remote = !!GH;
const staticHost = /^https?:$/.test(location.protocol);
const author = remote || !staticHost;

const state = { posts: [], q: '', shown: 0, openedId: null };
let ghError = null;

function normalize(list){
  return (Array.isArray(list) ? list : [])
    .filter(p => p && p.b !== undefined)
    .map(p => ({
      id: p.id || ('p' + Math.random().toString(36).slice(2, 9)),
      d: validDate(p.d) ? p.d : todayStr(),
      t: (p.t || '').trim(),
      b: String(p.b || ''),
      c: Number(p.c) || (validDate(p.d) ? Date.parse(p.d + 'T12:00:00+09:00') : Date.now()),
      u: Number(p.u) || 0
    }))
    .sort(sortNewest);
}
const sortNewest = (a, b) => b.d.localeCompare(a.d) || (b.c - a.c);

const b64 = str => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const b64Bytes = bytes => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const unb64 = s => new TextDecoder().decode(
  Uint8Array.from(atob(String(s).replace(/\s/g, '')), c => c.charCodeAt(0)));

const contentsUrl = () => `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.path || 'posts.json'}`;

function shortErr(text){
  try { const j = JSON.parse(text); return (j.message || '').slice(0, 90); }
  catch { return String(text || '').slice(0, 90); }
}

async function readStatic(){
  const r = await fetch('./posts.json?ts=' + Date.now(), { cache:'no-store' });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  return Array.isArray(d) ? d : (d && d.posts) || [];
}

async function ghRead(){
  const branch = GH.branch || 'main';
  const r = await fetch(contentsUrl() + '?ref=' + encodeURIComponent(branch) + '&cb=' + Date.now(), {
    headers: { Authorization:'Bearer ' + GH.token, Accept:'application/vnd.github+json' },
    cache:'no-store'
  });
  if (r.status === 404) return { posts: [], sha: null };
  if (!r.ok) throw new Error('GitHub ' + r.status + ' ' + shortErr(await r.text()));
  const d = await r.json();
  try {
    const json = JSON.parse(unb64(d.content));
    return { posts: Array.isArray(json) ? json : json.posts || [], sha: d.sha };
  } catch { return { posts: [], sha: d.sha }; }
}

async function ghCommit(posts, message, sha){
  const body = {
    message: message || 'WebPost: 글 저장',
    branch: GH.branch || 'main',
    content: b64(JSON.stringify(posts, null, 2) + '\n')
  };
  if (sha) body.sha = sha;
  const r = await fetch(contentsUrl(), {
    method:'PUT',
    headers: { Authorization:'Bearer ' + GH.token, Accept:'application/vnd.github+json',
               'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('GitHub ' + r.status + ' ' + shortErr(await r.text()));
}

/* 파일을 새로 읽고 → 한 동작만 얹고 → 쓴다(화면 상태를 덮어쓰지 않는다) */
async function change(apply, message){
  if (remote){
    const { posts, sha } = await ghRead();
    const next = apply(normalize(posts)).sort(sortNewest);
    await ghCommit(next, message, sha);
    ghError = null;
    return next;
  }
  const base = normalize(lsGet(K.posts, null) || SEED);
  const next = apply(base).sort(sortNewest);
  lsSet(K.posts, next);
  return next;
}
const addOp = p => list => list.concat([p]);
const editOp = p => list => list.map(x => (x.id === p.id ? { ...x, ...p } : x));
const dropOp = id => list => list.filter(x => x.id !== id);

async function loadPosts(){
  if (remote){
    try { return normalize((await ghRead()).posts); }
    catch (e){
      ghError = e.message;
      try { return normalize(await readStatic()); } catch { return []; }
    }
  }
  if (staticHost){
    try { return normalize(await readStatic()); }
    catch (e){ toast('글을 불러오지 못했어요 — ' + e.message); return []; }
  }
  return normalize(lsGet(K.posts, null) || SEED);
}

/* ── 검색 ───────────────────────────────────────────────────────── */
const JOSA = ['으로서','으로써','에서는','에게서','이라고','라는','이라는','에서','에게','까지','부터',
              '보다','처럼','이랑','한테','으로','로','을','를','이','가','은','는','의','에','와','과','도','만','랑','께'];
const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const isJamo = s => /^[ㄱ-ㅎ]+$/.test(s);
function stripJosa(tok){
  if (tok.length <= 2) return tok;
  for (const j of JOSA) if (tok.length - j.length >= 2 && tok.endsWith(j)) return tok.slice(0, -j.length);
  return tok;
}
function chosung(str){
  let out = '';
  for (const ch of str){
    const c = ch.codePointAt(0);
    out += (c >= 0xAC00 && c <= 0xD7A3) ? CHOSEONG[Math.floor((c - 0xAC00) / 588)] : ch.toLowerCase();
  }
  return out;
}
const parseQuery = q => (q || '').trim().split(/\s+/).filter(Boolean)
  .map(t => stripJosa(t.toLowerCase())).filter(Boolean)
  .filter((t, i, a) => a.indexOf(t) === i);
const haystack = p => [p.t, p.b, dateFull(p.d)].join(' ').toLowerCase();
function matches(p, tokens){
  if (!tokens.length) return true;
  const hay = haystack(p), cho = chosung(hay);
  return tokens.every(t => isJamo(t) ? cho.includes(t) : hay.includes(t));
}

/* ── 본문 → HTML ────────────────────────────────────────────────── */
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const isImageUrl = s => /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif)(\?\S*)?$/i.test(String(s).trim());

function inlineMd(s){
  let h = escHtml(s);
  const held = [];
  const hold = html => { held.push(html); return '\u0000' + (held.length - 1) + '\u0000'; };

  h = h.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (m, alt, src) => hold(
    isImageUrl(src) ? `<img src="${src}" alt="${alt}" loading="lazy">`
                    : `<a href="${src}" target="_blank" rel="noopener noreferrer">${alt || src}</a>`));
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, text, href) =>
    hold(`<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`));
  h = h.replace(/(https?:\/\/[^\s<]+)/g, (u) => {
    const cut = u.replace(/[.,;:!?)\]]+$/, '');
    return `<a href="${cut}" target="_blank" rel="noopener noreferrer">${cut}</a>${u.slice(cut.length)}`;
  });
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  return h.replace(/\u0000(\d+)\u0000/g, (m, i) => held[+i] || '');
}

function renderBody(body){
  const blocks = String(body || '').replace(/\r/g, '').split(/\n{2,}/);
  const out = [];
  for (const raw of blocks){
    const block = raw.replace(/\s+$/, '');
    if (!block.trim()) continue;
    const lines = block.split('\n');

    if (lines.every(l => /^>\s?/.test(l))){
      out.push('<blockquote>' + lines.map(l => inlineMd(l.replace(/^>\s?/, ''))).join('<br>') + '</blockquote>');
      continue;
    }
    if (lines.every(l => /^[-*]\s+/.test(l))){
      out.push('<ul>' + lines.map(l => '<li>' + inlineMd(l.replace(/^[-*]\s+/, '')) + '</li>').join('') + '</ul>');
      continue;
    }
    let buf = [];
    const flush = () => { if (buf.length) out.push('<p>' + buf.map(inlineMd).join('<br>') + '</p>'); buf = []; };
    for (const line of lines){
      const t = line.trim();
      if (isImageUrl(t)){ flush(); out.push(`<figure><img src="${t}" alt="" loading="lazy"></figure>`); }
      else buf.push(line);
    }
    flush();
  }
  return out.join('');
}

function plain(b){
  return String(b || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif)\S*/gi, ' ')
    .replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/\]\(/g, ' ')
    .replace(/[[\]]/g, '')
    .replace(/https?:\/\/([^\s/)]+)\S*/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n+/g, ' ')
    .trim();
}

const CARD_CHARS = 120;
function preview(body){
  const s = plain(body);
  return s.length > CARD_CHARS ? s.slice(0, CARD_CHARS).trimEnd() + '…' : s;
}

function firstImage(body){
  for (const line of String(body || '').split('\n')){
    const t = line.trim();
    const m = t.match(/^!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)$/);
    const u = m ? m[1] : t;
    if (isImageUrl(u)) return u;
  }
  return '';
}

function markIn(root, tokens){
  const toks = (tokens || []).filter(t => t && !isJamo(t));
  if (!toks.length || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n){
      if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const tag = n.parentNode && n.parentNode.nodeName;
      if (tag === 'A' || tag === 'CODE') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes){
    const text = node.nodeValue, lower = text.toLowerCase();
    const ranges = [];
    for (const t of toks){
      let i = lower.indexOf(t);
      while (i !== -1){ ranges.push([i, i + t.length]); i = lower.indexOf(t, i + t.length); }
    }
    if (!ranges.length) continue;
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of ranges){
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r.slice());
    }
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const [a, b] of merged){
      if (a > pos) frag.appendChild(document.createTextNode(text.slice(pos, a)));
      const m = document.createElement('mark');
      m.textContent = text.slice(a, b);
      frag.appendChild(m);
      pos = b;
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    node.parentNode.replaceChild(frag, node);
  }
}

/* ── 목록 ───────────────────────────────────────────────────────── */
const feedEl = $('#feed');
const searchInfo = $('#searchInfo');

function monthNode(label){
  const el = document.createElement('div');
  el.className = 'month';
  el.setAttribute('role', 'separator');
  el.innerHTML = `<b>${escHtml(label)}</b>`;
  return el;
}

function cardNode(p){
  const el = document.createElement('article');
  el.className = 'card' + (p.t ? '' : ' card--plain');
  el.tabIndex = 0;
  el.dataset.id = p.id;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', dateFull(p.d) + ' ' + (p.t || ''));

  const when = document.createElement('div');
  when.className = 'card__when';
  const t = document.createElement('time');
  t.dateTime = p.d;
  t.textContent = dayLabel(p.d);
  when.append(t);
  if (p.d === todayStr()){
    const b = document.createElement('b');
    b.className = 'card__today';
    b.textContent = '오늘';
    when.append(b);
  }
  el.append(when);

  if (p.t){
    const h = document.createElement('h2');
    h.className = 'card__title';
    h.textContent = p.t;
    el.append(h);
  }
  const body = document.createElement('p');
  body.className = 'card__body';
  body.textContent = preview(p.b);
  el.append(body);

  const thumb = firstImage(p.b);
  if (thumb){
    const img = document.createElement('img');
    img.className = 'card__thumb';
    img.src = thumb;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.remove());
    el.append(img);
    el.style.containIntrinsicSize = 'auto 380px';
  }

  el.addEventListener('click', () => openPost(p.id, { push:true }));
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openPost(p.id, { push:true }); }
  });
  return el;
}

function visiblePosts(){
  const tokens = parseQuery(state.q);
  return tokens.length ? state.posts.filter(p => matches(p, tokens)) : state.posts;
}

function renderFeed(reset){
  const tokens = parseQuery(state.q);
  const list = visiblePosts();

  if (!list.length){
    state.shown = 0;
    if (state.q){
      feedEl.innerHTML = '<p class="empty"><strong>찾는 글이 없어요</strong>다른 단어로 찾아 보세요.</p>';
      searchInfo.hidden = false;
      searchInfo.textContent = '0편';
    } else {
      feedEl.innerHTML = '<p class="empty"><strong>아직 글이 없어요</strong>' +
        (author ? '첫 글을 남겨 보세요.' : '조금 있으면 채워질 거예요.') + '</p>';
      if (author){
        const b = document.createElement('button');
        b.className = 'chipbtn';
        b.type = 'button';
        b.textContent = '첫 글 쓰기';
        b.addEventListener('click', () => openEditor(null));
        $('.empty', feedEl).append(b);
      }
      searchInfo.hidden = true;
    }
  } else {
    if (reset) state.shown = 0;
    const from = reset ? 0 : state.shown;
    const next = Math.min(list.length, from + PAGE);
    const slice = list.slice(from, next);
    const nodes = [];
    let last = '';
    for (const p of slice){
      const m = monthLabel(p.d);
      if (m !== last){ last = m; nodes.push(monthNode(m)); }
      nodes.push(cardNode(p));
    }
    if (reset) feedEl.replaceChildren(...nodes);
    else feedEl.append(...nodes);
    state.shown = next;

    if (state.shown < list.length){
      const wrap = document.createElement('div');
      wrap.className = 'more';
      const b = document.createElement('button');
      b.className = 'chipbtn';
      b.type = 'button';
      b.textContent = `더 보기 (${list.length - state.shown}편)`;
      b.addEventListener('click', () => renderFeed(false));
      wrap.append(b);
      feedEl.append(wrap);
    }
    if (state.q){
      searchInfo.hidden = false;
      searchInfo.textContent = list.length + '편';
      markIn(feedEl, tokens);
    } else searchInfo.hidden = true;
  }

  $('#footCount').textContent = state.posts.length ? `글 ${state.posts.length}편` : 'WebPost';
  $('#setCount').textContent = String(state.posts.length);
}

/* ── 화면 전환 ──────────────────────────────────────────────────── */
const postView = $('#postView'), editor = $('#editor');
const baseUrl = () => location.pathname + location.search;
let viewKind = null;        // 'post' | 'editor' | null
let historyOwned = false;   // 이 화면을 열면서 history 를 밀었나

function lockBody(on){ document.body.classList.toggle('lock', on); }

function showEl(el){
  el.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => el.classList.add('is-open'));
}
function hideEl(el){
  el.classList.remove('is-open');
  el.setAttribute('aria-hidden', 'true');
}

/* ── 글 화면 ───────────────────────────────────────────────────── */
const postMenu = $('#postMenu');
let armedDel = false;

function openPost(id, opts = {}){
  const p = state.posts.find(x => x.id === id);
  if (!p) return;
  state.openedId = id;
  armedDel = false;
  closeMenu();

  $('#postDate').textContent = dateFull(p.d);
  $('#postTitle').textContent = p.t;
  const bodyEl = $('#postBody');
  bodyEl.innerHTML = renderBody(p.b);
  bodyEl.querySelectorAll('img').forEach(img => {
    img.addEventListener('error', () => {
      const a = document.createElement('a');
      a.href = img.getAttribute('src');
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = img.getAttribute('src');
      img.replaceWith(a);
    });
  });

  $$('[data-author]', postMenu).forEach(b => { b.hidden = !author; });
  const del = $('[data-act="del"]', postMenu);
  del.classList.remove('is-armed');
  del.textContent = '삭제';

  if (viewKind !== 'post'){
    $('#postScroll').scrollTop = 0;
    hideEl(editor);
    showEl(postView);
    lockBody(true);
  }
  viewKind = 'post';

  if (opts.push){
    history.pushState({ wp:'post', id }, '', '#p/' + id);
    historyOwned = true;
  } else if (!opts.fromPop){
    history.replaceState({ wp:'post', id }, '', '#p/' + id);
    historyOwned = false;
  }
}

function hidePost(){
  hideEl(postView);
  if (viewKind === 'post') viewKind = null;
  lockBody(false);
}

function closePost(){
  if (viewKind === 'post' && historyOwned){ history.back(); return; }
  hidePost();
  history.replaceState(null, '', baseUrl());
  historyOwned = false;
}

function closeMenu(){
  postMenu.hidden = true;
  $('#moreBtn').setAttribute('aria-expanded', 'false');
}

$('#backBtn').addEventListener('click', closePost);
$('#moreBtn').addEventListener('click', e => {
  e.stopPropagation();
  const open = postMenu.hidden;
  postMenu.hidden = !open;
  $('#moreBtn').setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', e => {
  if (!postMenu.hidden && !postMenu.contains(e.target) && !e.target.closest('#moreBtn')) closeMenu();
});

postMenu.addEventListener('click', async e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const act = btn.dataset.act;
  const p = state.posts.find(x => x.id === state.openedId);
  if (!p) return;

  if (act === 'copy'){
    const url = location.href.split('#')[0] + '#p/' + p.id;
    try { await navigator.clipboard.writeText(url); toast('링크를 복사했어요'); }
    catch { toast(url); }
    closeMenu();
    return;
  }
  if (act === 'edit'){
    closeMenu();
    hidePost();
    openEditor(p);
    return;
  }
  if (act === 'del'){
    if (!armedDel){
      armedDel = true;
      btn.classList.add('is-armed');
      btn.textContent = '정말 삭제할까요?';
      setTimeout(() => {
        if (!armedDel) return;
        armedDel = false; btn.classList.remove('is-armed'); btn.textContent = '삭제';
      }, 4000);
      return;
    }
    armedDel = false;
    btn.disabled = true;
    btn.textContent = '삭제 중…';
    const before = state.posts;
    state.posts = dropOp(p.id)(state.posts);
    renderFeed(true);
    closeMenu();
    closePost();
    try {
      state.posts = await change(dropOp(p.id), 'WebPost: 글 삭제 — ' + (p.t || p.d));
      renderFeed(true);
      toast('삭제했어요');
    } catch (err){
      state.posts = before; renderFeed(true);
      toast('삭제하지 못했어요 — ' + err.message, 6000);
    }
  }
});

/* ── 쓰기 화면 ─────────────────────────────────────────────────── */
const titleInput = $('#titleInput'), bodyInput = $('#bodyInput'), dateInput = $('#dateInput');
const countEl = $('#count'), saveBtn = $('#saveBtn'), draftNote = $('#draftNote');
let editing = null;

const chars = s => [...String(s || '')].length;
function paintCount(){
  const n = chars(titleInput.value) + chars(bodyInput.value);
  countEl.textContent = n ? n + '자' : '';
}

function autoGrowTitle(reset){
  if (reset) titleInput.style.height = 'auto';
  const need = titleInput.scrollHeight;
  if (need > titleInput.clientHeight + 1) titleInput.style.height = need + 'px';
}

let draftTimer = null;
function saveDraft(){
  clearTimeout(draftTimer);
  if (editing) return;
  draftTimer = setTimeout(() => {
    const v = { t: titleInput.value, b: bodyInput.value, d: dateInput.value };
    lsSet(K.draft, (v.t.trim() || v.b.trim()) ? v : undefined);
  }, 350);
}

function openEditor(post, opts = {}){
  editing = post || null;
  titleInput.value = post ? post.t : '';
  bodyInput.value = post ? post.b : '';
  dateInput.value = post ? post.d : todayStr();
  draftNote.hidden = true;

  if (!post){
    const draft = lsGet(K.draft, null);
    if (draft && ((draft.t || '').trim() || (draft.b || '').trim())){
      titleInput.value = draft.t || '';
      bodyInput.value = draft.b || '';
      dateInput.value = validDate(draft.d) ? draft.d : todayStr();
      draftNote.hidden = false;
    }
  }

  saveBtn.textContent = post ? '고치기' : '저장';
  saveBtn.disabled = false;          // 지난번 저장에서 꺼진 채로 남으면 아무것도 안 된다
  paintCount();
  showEl(editor);
  lockBody(true);
  viewKind = 'editor';

  if (opts.replace){
    history.replaceState({ wp:'edit' }, '', '#write');
  } else {
    history.pushState({ wp:'edit' }, '', '#write');
  }
  historyOwned = true;

  setTimeout(() => {
    autoGrowTitle(true);
    (post || titleInput.value ? bodyInput : titleInput).focus({ preventScroll:true });
  }, 120);
}

function hideEditor(){
  hideEl(editor);
  if (viewKind === 'editor') viewKind = null;
  titleInput.blur(); bodyInput.blur();
  lockBody(false);
}

function closeEditor(){
  if (viewKind === 'editor' && historyOwned){ history.back(); return; }
  hideEditor();
  history.replaceState(null, '', baseUrl());
  historyOwned = false;
}

async function savePost(){
  const t = titleInput.value.trim();
  const b = bodyInput.value.replace(/\s+$/, '');
  const d = validDate(dateInput.value) ? dateInput.value : todayStr();
  if (!t && !b.trim()){ toast('내용을 적어 주세요'); titleInput.focus(); return; }

  const now = Date.now();
  const wasEditing = editing;
  const before = state.posts;
  const entry = wasEditing
    ? { ...wasEditing, t, b, d, u: now }
    : { id:'p' + now.toString(36), t, b, d, c: now, u: 0 };
  const op = wasEditing ? editOp(entry) : addOp(entry);

  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중…';
  lsSet(K.draft, undefined);

  try {
    state.posts = await change(op, wasEditing ? 'WebPost: 글 수정 — ' + (t || d) : 'WebPost: 새 글 — ' + (t || d));
    renderFeed(true);
    editing = null;
    closeEditor();
    toast('저장했어요');
  } catch (e){
    state.posts = before; renderFeed(true);
    toast('저장하지 못했어요 — ' + e.message, 6000);
    // 쓴 글은 화면에 그대로 남긴다 — 잃지 않게
    titleInput.value = t; bodyInput.value = b; dateInput.value = d; editing = wasEditing;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = editing ? '고치기' : '저장';
  }
}

$('#writeBtn').addEventListener('click', () => openEditor(null));
$('#cancelBtn').addEventListener('click', closeEditor);
$('#todayBtn').addEventListener('click', () => { dateInput.value = todayStr(); });
$('#clearDraft').addEventListener('click', () => {
  titleInput.value = ''; bodyInput.value = ''; dateInput.value = todayStr();
  draftNote.hidden = true; lsSet(K.draft, undefined);
  paintCount(); autoGrowTitle(true); titleInput.focus();
});
saveBtn.addEventListener('click', savePost);
titleInput.addEventListener('input', () => { paintCount(); autoGrowTitle(false); saveDraft(); });
bodyInput.addEventListener('input', () => { paintCount(); saveDraft(); });
dateInput.addEventListener('change', saveDraft);
titleInput.addEventListener('keydown', e => {
  if (e.key === 'Enter'){ e.preventDefault(); bodyInput.focus(); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && viewKind === 'editor'){ e.preventDefault(); closeEditor(); }
  if (e.key === 'Escape' && viewKind === 'post' && postMenu.hidden){ e.preventDefault(); closePost(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && viewKind === 'editor'){ e.preventDefault(); savePost(); }
});

/* ── 사진 ──────────────────────────────────────────────────────── */
function shrink(file, max = 1600, q = 0.85){
  return new Promise((res, rej) => {
    if (file.size > 25 * 1024 * 1024) return rej(new Error('사진이 너무 커요(25MB 이하)'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? res(b) : rej(new Error('변환 실패')), 'image/jpeg', q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지를 읽을 수 없어요')); };
    img.src = url;
  });
}

function insertAtCursor(el, text){
  const a = el.selectionStart ?? el.value.length;
  const b = el.selectionEnd ?? a;
  el.value = el.value.slice(0, a) + text + el.value.slice(b);
  el.selectionStart = el.selectionEnd = a + text.length;
  el.dispatchEvent(new Event('input', { bubbles:true }));
}

async function addPhoto(file){
  if (!file) return;
  if (!remote){ toast('사진 올리기는 저장소 연결(토큰)이 필요해요', 4000); return; }
  const btn = $('#photoBtn');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = '올리는 중…';
  try {
    const blob = await shrink(file);
    const name = 'img/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6) + '.jpg';
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const r = await fetch(`https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${name}`, {
      method:'PUT',
      headers: { Authorization:'Bearer ' + GH.token, Accept:'application/vnd.github+json',
                 'Content-Type':'application/json' },
      body: JSON.stringify({ message:'WebPost: 사진 ' + name, branch: GH.branch || 'main',
                             content: b64Bytes(bytes) })
    });
    if (!r.ok) throw new Error('GitHub ' + r.status + ' ' + shortErr(await r.text()));
    const url = `https://raw.githubusercontent.com/${GH.owner}/${GH.repo}/${GH.branch || 'main'}/${name}`;
    insertAtCursor(bodyInput, (bodyInput.value.trim() ? '\n\n' : '') + url + '\n\n');
    toast('사진을 올렸어요');
  } catch (e){
    toast('사진을 올리지 못했어요 — ' + e.message, 6000);
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}
$('#photoBtn').addEventListener('click', () => $('#photoFile').click());
$('#photoFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  await addPhoto(f);
});
bodyInput.addEventListener('paste', e => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const it of items){
    if (it.kind === 'file' && it.type.startsWith('image/')){
      e.preventDefault();
      addPhoto(it.getAsFile());
      return;
    }
  }
});

/* ── 검색 ──────────────────────────────────────────────────────── */
const searchbar = $('#search'), qEl = $('#q'), searchBtn = $('#searchBtn');
let qTimer = null, composing = false;

function setSearch(on){
  searchbar.hidden = !on;
  searchBtn.setAttribute('aria-pressed', String(on));
  if (on) qEl.focus();
  else { qEl.value = ''; state.q = ''; renderFeed(true); }
}
searchBtn.addEventListener('click', () => setSearch(searchbar.hidden));
$('#searchClose').addEventListener('click', () => { setSearch(false); qEl.blur(); });
$('#searchForm').addEventListener('submit', e => e.preventDefault());
qEl.addEventListener('compositionstart', () => { composing = true; });
qEl.addEventListener('compositionend', () => { composing = false; applyQuery(qEl.value); });
qEl.addEventListener('input', e => { if (!e.isComposing && !composing) applyQuery(e.target.value); });
qEl.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.preventDefault(); setSearch(false); qEl.blur(); } });
function applyQuery(v){
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { state.q = (v || '').trim(); renderFeed(true); }, 120);
}

/* ── 설정 ──────────────────────────────────────────────────────── */
const setDlg = $('#settings');
const activeTheme = () => document.documentElement.dataset.theme
  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function paintTheme(){
  const dark = activeTheme() === 'dark';
  $('#setTheme').textContent = dark ? '밝게' : '어둡게';
  $('#setTheme').dataset.dark = String(dark);
}
function toggleTheme(){
  const next = activeTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(K.theme, next); } catch {}
  paintTheme();
}
$('#setTheme').addEventListener('click', toggleTheme);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', paintTheme);

$('#setBtn').addEventListener('click', () => {
  $('#ghOwner').value = GH ? GH.owner : '';
  $('#ghRepo').value = GH ? GH.repo : '';
  $('#ghToken').value = GH ? GH.token : '';
  $('#setMode').textContent = (remote
    ? `지금은 GitHub(${GH.owner}/${GH.repo})에서 읽고 써요.`
    : '지금은 이 기기에만 저장해요.') + ` WebPost ${VERSION}`;
  setDlg.showModal();
  requestAnimationFrame(() => setDlg.classList.add('is-open'));
});
function closeSet(){
  setDlg.classList.remove('is-open');
  setTimeout(() => { if (!setDlg.classList.contains('is-open') && setDlg.open) setDlg.close(); }, 180);
}
setDlg.addEventListener('close', () => setDlg.classList.remove('is-open'));
setDlg.addEventListener('click', e => { if (e.target === setDlg) closeSet(); });
$('#setClose').addEventListener('click', closeSet);

$('#ghTest').addEventListener('click', async () => {
  const btn = $('#ghTest');
  const owner = $('#ghOwner').value.trim();
  const repo = $('#ghRepo').value.trim();
  const token = $('#ghToken').value.trim();
  if (!owner || !repo || !token){ toast('아이디·저장소·토큰을 먼저 넣어 주세요'); return; }
  const H = { Authorization:'Bearer ' + token, Accept:'application/vnd.github+json' };
  btn.disabled = true; btn.textContent = '확인 중…';
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}?cb=${Date.now()}`, { headers:H, cache:'no-store' });
    if (!r.ok) throw new Error('저장소를 못 열었어요 (GitHub ' + r.status + ' ' + shortErr(await r.text()) + ')');
    const info = await r.json();
    const canWrite = !!(info.permissions && info.permissions.push);
    const c = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/posts.json?ref=main&cb=${Date.now()}`,
      { headers:H, cache:'no-store' });
    let n = 0;
    if (c.ok){
      const d = await c.json();
      try { const j = JSON.parse(unb64(d.content)); n = (Array.isArray(j) ? j : j.posts || []).length; } catch {}
    }
    if (!canWrite) toast('읽기는 되는데 쓰기 권한이 없어요 — Contents 를 Read and write 로 바꿔 주세요', 8000);
    else toast(`연결됐어요 — ${owner}/${repo} · 글 ${n}편 · 쓰기 권한 있음`, 5000);
  } catch (e){
    toast('연결 실패 — ' + e.message, 8000);
  } finally {
    btn.disabled = false; btn.textContent = '연결 확인';
  }
});

$('#ghSave').addEventListener('click', () => {
  const owner = $('#ghOwner').value.trim();
  const repo = $('#ghRepo').value.trim();
  const token = $('#ghToken').value.trim();
  if (!owner || !repo || !token) lsSet(K.gh, undefined);
  else lsSet(K.gh, { owner, repo, token, branch:'main', path:'posts.json' });
  toast(token ? '저장소를 연결했어요' : '로컬 저장으로 바꿨어요');
  setTimeout(() => location.reload(), 700);
});

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.posts, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'webpost-' + todayStr() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    const incoming = normalize(Array.isArray(d) ? d : d.posts || []);
    const merge = list => {
      const byId = new Map(list.map(p => [p.id, p]));
      for (const p of incoming) byId.set(p.id, p);
      return Array.from(byId.values());
    };
    state.posts = merge(state.posts).sort(sortNewest);
    renderFeed(true);
    try { state.posts = await change(merge, 'WebPost: JSON 가져오기'); renderFeed(true); toast(incoming.length + '편을 가져왔어요'); }
    catch (err){ toast('가져오지 못했어요 — ' + err.message); }
  } catch { toast('JSON 을 읽을 수 없어요'); }
  finally { e.target.value = ''; }
});

/* ── 토스트 ───────────────────────────────────────────────────── */
let toastTimer = null;
function toast(msg, ms = 2600){
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ── 뒤로가기 ─────────────────────────────────────────────────── */
addEventListener('popstate', e => {
  const st = e.state;
  if (st && st.wp === 'post'){ openPost(st.id, { fromPop:true }); return; }
  if (st && st.wp === 'edit'){ openEditor(editing, { replace:true }); return; }
  // 상태 없음 → 열려 있던 화면을 닫는다
  hideEditor();
  hidePost();
  closeMenu();
  viewKind = null;
  historyOwned = false;
});

/* ── 시작 ─────────────────────────────────────────────────────── */
async function init(){
  paintTheme();
  if (author) $('#writeBtn').hidden = false;

  state.posts = await loadPosts();
  renderFeed(true);

  if (ghError) toast('GitHub 연결에 문제가 있어요 — ' + ghError, 6000);

  const m = location.hash.match(/^#p\/(.+)$/);
  if (m){
    const id = decodeURIComponent(m[1]);
    if (state.posts.some(p => p.id === id)) openPost(id, {});
  }
}
init();
