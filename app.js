/* app.js — WebPost
 *
 * WebPaper(app.js·app.css)의 문법을 그대로 쓴다: 카드 한 벌, 시트 하나, 검색은 같은
 * 한국어 규칙(조사 제거 + 초성 + 모든 토큰 AND).
 * 다른 것은 셋뿐이다 — ① 분류가 없다 ② 시간은 '연 월 일'까지만 말한다
 * ③ 나만 쓴다(쓰기·수정·삭제는 이 브라우저에 열쇠가 있을 때만 보인다).
 *
 * 저장소는 두 가지. 열쇠(GitHub 설정)가 있으면 저장소의 posts.json 을 읽고 쓰고,
 * 없으면 이 브라우저(localStorage)에만 쓴다. 화면 코드는 둘을 구분하지 않는다.
 */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const K = { posts:'webpost.posts.v1', gh:'webpost.gh.v1', theme:'webpost.theme', draft:'webpost.draft.v1' };
const PAGE = 30;

/* ── localStorage ─────────────────────────────────────────────────── */
function lsGet(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function lsSet(k, v){ try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }

/* ── 날짜 ─────────────────────────────────────────────────────────
   저장은 'YYYY-MM-DD' 문자열 하나. 시각(분·초)은 화면에 절대 나오지 않는다.
   같은 날 여러 글이면 c(만든 시각)로만 순서를 정한다 — 보이지 않는 순서다. */
const pad2 = n => String(n).padStart(2, '0');
function todayStr(){ const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()); }
function dateFull(d){
  const [y, m, dd] = String(d || '').split('-');
  if (!y || !m || !dd) return '';
  return `${y}년 ${+m}월 ${+dd}일`;
}
function dayLabel(d){ const [, , dd] = String(d || '').split('-'); return dd ? (+dd) + '일' : ''; }
function monthLabel(d){ const [y, m] = String(d || '').split('-'); return y && m ? `${y}년 ${+m}월` : ''; }
const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

/* ── 시드 (호스팅 전 첫 화면) ──────────────────────────────────────── */
const SEED = [
  { id:'seed-1', d:'2026-11-24', c: Date.parse('2026-11-24T10:00:00+09:00'), t:'WebPost.',
    b:'여기가 첫 글.\n\nWebPaper 는 세상에서 일어난 일을 모아 두는 종이였고, 이건 내가 겪은 일을 적는 종이. 하루에 한 줄이면 충분하다고 생각한다.' },
  { id:'seed-2', d:'2026-11-20', c: Date.parse('2026-11-20T21:10:00+09:00'), t:'이 글들은 지워도 돼요',
    b:'샘플이다. 오른쪽 위 **쓰기**로 새 글을 쓰고, 글을 눌러 **수정**·**삭제**를 하면 된다.\n\n날짜는 글마다 직접 정할 수 있어서, 오늘 쓴 걸 지난달 자리에 끼워 넣을 수도 있다. 화면에는 연·월·일까지만 나온다.' },
  { id:'seed-3', d:'2026-11-08', c: Date.parse('2026-11-08T14:30:00+09:00'), t:'서식',
    b:'본문에서 쓸 수 있는 것:\n\n- **굵게**, *기울임*, `코드`\n- 줄 앞에 > 를 붙이면 인용\n- 이미지는 주소만 붙여넣기\n\n전부 외울 필요는 없다. 그냥 쓰면 그냥 글이다.' },
  { id:'seed-4', d:'2026-10-29', c: Date.parse('2026-10-29T23:40:00+09:00'), t:'',
    b:'10월의 마지막 장. 제목 없이 쓰는 글도 괜찮다.' }
];

/* ── 저장소 ───────────────────────────────────────────────────────── */
const GH = (() => { const c = lsGet(K.gh, null); return (c && c.token && c.owner && c.repo) ? c : null; })();
const remote = !!GH;
const staticHost = /^https?:$/.test(location.protocol);          // 실제로 배포된 상태인가
const author = remote || !staticHost;                            // 파일로 열었거나 열쇠가 있으면 내 것

const state = { posts: [], q: '', shown: 0, loading: true, openedId: null };

/* 토큰이 막혔을 때 조용히 실패하지 않는다 — 화면 위에 계속 말해 둔다 */
let ghError = null;
function showBanner(msg){
  const b = $('#banner'), t = $('#bannerText');
  if (!b || !t) return;
  t.textContent = msg;
  b.hidden = false;
}
function hideBanner(){ const b = $('#banner'); if (b) b.hidden = true; }

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
function sortNewest(a, b){ return b.d.localeCompare(a.d) || (b.c - a.c); }

async function loadPosts(){
  // 배포된 사이트: 독자는 posts.json(CDN)을, 글쓴이는 GitHub API 를 읽는다.
  // API 를 쓰는 이유는 하나다 — CDN 은 방금 쓴 글을 40~60초 동안 옛 것으로 준다.
  // 옛 목록을 읽고 그 위에 덮어쓰면 방금 지운 글이 되살아난다(실제로 그랬다).
  if (remote){
    try {
      const { posts } = await ghRead();
      return normalize(posts);
    } catch (e) {
      ghError = e.message;
      showBanner('GitHub 연결에 문제가 있어요 — ' + e.message);
      // 열쇠가 막혀도 읽기는 되게: 캐시된 목록으로 물러선다
      try { return normalize(await readStatic()); } catch { return []; }
    }
  }
  if (staticHost){
    try {
      return normalize(await readStatic());
    } catch (e) {
      toast('글을 불러오지 못했어요 — ' + e.message);
      return [];
    }
  }
  const local = lsGet(K.posts, null);
  return normalize(local || SEED);        // [] 는 '다 지웠다'는 뜻이지 '없음'이 아니다
}

async function readStatic(){
  const r = await fetch('./posts.json?ts=' + Date.now(), { cache:'no-store' });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  return Array.isArray(d) ? d : (d && d.posts) || [];
}

/* ── GitHub 쓰기 ───────────────────────────────────────────────────
   규칙: **파일을 새로 읽고 → 그 위에 한 가지 동작만 적용하고 → 쓴다.**
   화면이 들고 있는 목록을 파일에 덮어쓰지 않는다. 그래야 캐시된 옛 화면에서
   지운 글이 되살아나지 않는다. */
const b64 = str => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const unb64 = s => new TextDecoder().decode(
  Uint8Array.from(atob(String(s).replace(/\s/g, '')), c => c.charCodeAt(0)));

const contentsUrl = () =>
  `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.path || 'posts.json'}`;

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
  } catch {
    return { posts: [], sha: d.sha };          // 파일이 깨졌으면 덮어쓰지 않고 멈춘다
  }
}

async function ghCommit(posts, message, sha){
  const branch = GH.branch || 'main';
  const body = {
    message: message || 'WebPost: 글 저장',
    branch,
    content: b64(JSON.stringify(posts, null, 2) + '\n')
  };
  if (sha) body.sha = sha;
  const r = await fetch(contentsUrl(), {
    method:'PUT',
    headers: {
      Authorization:'Bearer ' + GH.token,
      Accept:'application/vnd.github+json',
      'Content-Type':'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('GitHub ' + r.status + ' ' + shortErr(await r.text()));
}

function shortErr(text){
  try { const j = JSON.parse(text); return (j.message || '').slice(0, 90); }
  catch { return String(text || '').slice(0, 90); }
}

/* apply: 목록 → 새 목록. 원격이면 최신 파일 위에서 적용한다. */
async function change(apply, message){
  if (remote){
    const { posts, sha } = await ghRead();          // 방금 것을 읽고
    const next = apply(normalize(posts)).sort(sortNewest);   // 한 동작만 얹고
    await ghCommit(next, message, sha);              // 쓴다
    ghError = null; hideBanner();
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

/* ── 한국어 친화 검색 (WebPaper search.html 과 같은 규칙) ────────────
   ① 모든 토큰이 들어가야 한다 ② 조사를 떼고 본다 ③ 초성만 쳐도 찾는다 */
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
function parseQuery(q){
  return (q || '').trim().split(/\s+/).filter(Boolean)
    .map(t => stripJosa(t.toLowerCase())).filter(Boolean)
    .filter((t, i, a) => a.indexOf(t) === i);
}
function haystack(p){ return [p.t, p.b, dateFull(p.d)].join(' ').toLowerCase(); }
function matches(p, tokens){
  if (!tokens.length) return true;
  const hay = haystack(p), cho = chosung(hay);
  return tokens.every(t => isJamo(t) ? cho.includes(t) : hay.includes(t));
}

/* ── 본문 → HTML (아주 작은 마크다운) ───────────────────────────────
   지원: 문단, 줄바꿈, **굵게**, *기울임*, `코드`, > 인용, - 목록, 이미지 주소, 링크 */
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const isImageUrl = s => /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif)(\?\S*)?$/i.test(s.trim());

function inlineMd(s){
  let h = escHtml(s);
  const held = [];
  const hold = html => { held.push(html); return '\u0000' + (held.length - 1) + '\u0000'; };

  // 1) 이미지![]() — 진짜 이미지 주소면 그림, 아니면 링크
  h = h.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (m, alt, src) => hold(
    isImageUrl(src)
      ? `<img src="${src}" alt="${alt}" loading="lazy">`
      : `<a href="${src}" target="_blank" rel="noopener noreferrer">${alt || src}</a>`));

  // 2) 링크 []() — 밖에 있는 주소부터 먼저 링크로 바꾸면 href 안까지 건드리므로
  //    링크는 먼저 떼어 놓고(placeholder), 맨 끝에 되돌린다.
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, text, href) =>
    hold(`<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`));

  // 3) 맨 주소
  h = h.replace(/(https?:\/\/[^\s<]+)/g, (u) => {
    const cut = u.replace(/[.,;:!?)\]]+$/, '');
    const tail = u.slice(cut.length);
    return `<a href="${cut}" target="_blank" rel="noopener noreferrer">${cut}</a>${tail}`;
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

    /* 이미지 주소는 '그 줄 하나'만 떼어내 그림으로 만든다. 같은 문단에 설명이
       붙어 있어도(주소 다음 줄에 캡션을 쓴 경우) 그림이 살아남는다. */
    let buf = [];
    const flush = () => {
      if (buf.length) out.push('<p>' + buf.map(inlineMd).join('<br>') + '</p>');
      buf = [];
    };
    for (const line of lines){
      const t = line.trim();
      if (isImageUrl(t)){ flush(); out.push(`<figure><img src="${t}" alt="" loading="lazy"></figure>`); }
      else buf.push(line);
    }
    flush();
  }
  return out.join('');
}

/* 글에서 첫 그림 주소 하나 — 피드 카드의 미리보기에 쓴다 */
function firstImage(body){
  for (const line of String(body || '').split('\n')){
    const t = line.trim();
    const m = t.match(/^!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)$/);
    const u = m ? m[1] : t;
    if (isImageUrl(u)) return u;
  }
  return '';
}

/* 카드에 쓰는 한 줄 미리보기 — 일정 길이를 넘으면 무조건 …으로 끊는다.
   CSS 의 line-clamp 는 줄 수만 자르고, 폰트·폭에 따라 몇 글자가 남을지 달라진다.
   여기서 글자 수로 한 번 더 자르면 어떤 화면에서도 카드 높이가 같다. */
const CARD_CHARS = 120;
function preview(body){
  const s = plain(body);
  return s.length > CARD_CHARS ? s.slice(0, CARD_CHARS).trimEnd() + '…' : s;
}

/* 카드에 쓰는 한 줄 미리보기 — 마크다운 기호는 지우고 주소는 도메인만 남긴다 */
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

/* ── 검색어 하이라이트 ──────────────────────────────────────────────
   본문이 HTML 로 그려지므로 텍스트 노드만 훑어 mark 로 감싼다.
   초성 질의는 원문 위치를 되짚을 수 없어서 표시하지 않는다(WebPaper 와 같다). */
function markIn(root, tokens){
  const toks = (tokens || []).filter(t => t && !isJamo(t));
  if (!toks.length || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n){
      if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const tag = n.parentNode && n.parentNode.nodeName;
      if (tag === 'A' || tag === 'CODE' || tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
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

/* ── 피드 ─────────────────────────────────────────────────────────── */
const feedEl = $('#feed'), footCount = $('#footCount');
const searchInfo = $('#searchInfo');

function monthNode(label){
  const el = document.createElement('div');
  el.className = 'month';
  el.setAttribute('role', 'separator');
  const s = document.createElement('span');
  s.textContent = label;
  el.append(s);
  return el;
}

function postNode(p, tokens){
  const el = document.createElement('article');
  el.className = 'post' + (p.t ? '' : ' post--notitle');
  el.tabIndex = 0;
  el.dataset.id = p.id;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', dateFull(p.d) + ' ' + (p.t || plain(p.b).slice(0, 40)));

  const meta = document.createElement('div');
  meta.className = 'post__meta';

  const date = document.createElement('time');
  date.className = 'post__date';
  date.dateTime = p.d;
  date.textContent = dayLabel(p.d);
  date.title = dateFull(p.d);
  meta.append(date);

  if (p.d === todayStr()){
    const flag = document.createElement('span');
    flag.className = 'post__flag';
    flag.textContent = '오늘';
    meta.append(flag);
  }

  if (p.t){
    const h = document.createElement('h2');
    h.className = 'post__title';
    h.textContent = p.t;
    el.append(meta, h);
  } else {
    el.append(meta);
  }

  const body = document.createElement('p');
  body.className = 'post__body';
  body.textContent = preview(p.b);
  el.append(body);

  const thumbSrc = firstImage(p.b);
  if (thumbSrc){
    const img = document.createElement('img');
    img.className = 'post__thumb';
    img.src = thumbSrc;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.remove());
    el.append(img);
    el.style.containIntrinsicSize = 'auto 400px';   // 그림이 있는 카드는 높다(스크롤 튐 방지)
  }

  el.addEventListener('click', () => openPost(p.id, true));
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openPost(p.id, true); }
  });
  return el;
}

function visiblePosts(){
  const tokens = parseQuery(state.q);
  return tokens.length ? state.posts.filter(p => matches(p, tokens)) : state.posts;
}

function render(reset){
  state.loading = false;
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
      if (author) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = '첫 글 쓰기';
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
    let lastMonth = '';
    for (const p of slice){
      const m = monthLabel(p.d);
      if (m !== lastMonth){ lastMonth = m; nodes.push(monthNode(m)); }
      const n = postNode(p, tokens);
      nodes.push(n);
    }
    if (reset) feedEl.replaceChildren(...nodes);
    else {
      $('.more', feedEl)?.remove();
      feedEl.append(...nodes);
    }
    state.shown = next;

    if (state.shown < list.length){
      const more = document.createElement('div');
      more.className = 'more';
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `더 보기 (${list.length - state.shown}편)`;
      b.style.cssText = 'justify-self:center;min-height:44px;padding:0 22px;border:1px solid var(--line);' +
        'border-radius:22px;background:var(--bg);color:var(--muted);font-size:13px;cursor:pointer';
      b.addEventListener('click', () => render(false));
      more.append(b);
      feedEl.append(more);
    }
    if (state.q){
      searchInfo.hidden = false;
      searchInfo.textContent = list.length + '편';
      markIn(feedEl, tokens);
    } else {
      searchInfo.hidden = true;
    }
  }

  footCount.textContent = state.posts.length ? `글 ${state.posts.length}편` : 'WebPost';
  $('#setCount').textContent = String(state.posts.length);
}

/* ── 상세 시트 ─────────────────────────────────────────────────────── */
const sheet = $('#sheet');
const sheetWhen = $('#sheetWhen'), sheetTitle = $('#sheetTitle'), sheetBody = $('#sheetBody');
let armedDel = false;

function openPost(id, hash){
  const p = state.posts.find(x => x.id === id);
  if (!p) return;
  state.openedId = id;
  armedDel = false;
  sheetWhen.textContent = dateFull(p.d);
  sheetTitle.textContent = p.t;
  sheetBody.innerHTML = renderBody(p.b);
  sheetBody.querySelectorAll('img').forEach(img => {
    img.addEventListener('error', () => {
      const a = document.createElement('a');
      a.href = img.getAttribute('src');
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = img.getAttribute('src');
      img.replaceWith(a);
    });
  });

  const acts = $('#sheetActions');
  acts.hidden = false;
  $$('[data-author]', acts).forEach(b => { b.hidden = !author; });
  const del = $('[data-act="del"]', acts);
  del.classList.remove('is-armed');
  del.textContent = '삭제';
  del.disabled = false;          // 지난번 삭제에서 꺼진 채로 남아 있으면 다음 글이 안 지워진다

  if (!sheet.open){
    sheet.showModal();
    requestAnimationFrame(() => sheet.classList.add('is-open'));
  }
  $('.sheet__inner', sheet).scrollTop = 0;
  document.documentElement.style.overflow = 'hidden';
  if (hash) setHash('p/' + id);
}

function closePost(){
  state.openedId = null;
  sheet.classList.remove('is-open');
  document.documentElement.style.overflow = editor.hidden ? '' : 'hidden';
  setTimeout(() => { if (!sheet.classList.contains('is-open') && sheet.open) sheet.close(); }, 260);
  setHash('');
}
sheet.addEventListener('close', () => {
  sheet.classList.remove('is-open');
  document.documentElement.style.overflow = editor.hidden ? '' : 'hidden';
});
sheet.addEventListener('click', e => { if (e.target === sheet) closePost(); });

$('#sheetActions').addEventListener('click', async e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const act = btn.dataset.act;
  const p = state.posts.find(x => x.id === state.openedId);
  if (!p) return;

  if (act === 'copy'){
    const url = location.href.split('#')[0] + '#p/' + p.id;
    try { await navigator.clipboard.writeText(url); toast('링크를 복사했어요'); }
    catch { toast(url); }
    return;
  }
  if (act === 'edit'){
    closePost();
    setTimeout(() => openEditor(p), 120);
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
    closePost();
    render(true);
    try {
      state.posts = await change(dropOp(p.id), 'WebPost: 글 삭제 — ' + (p.t || p.d));
      render(true);
      toast('삭제했어요');
    } catch (err) {
      state.posts = before; render(true); toast('삭제하지 못했어요 — ' + err.message);
    }
  }
});

/* 시트 드래그로 닫기 (WebPaper 와 같은 손맛) */
let y0 = 0, dy = 0, dragging = false;
sheet.addEventListener('touchstart', e => {
  if ($('.sheet__inner', sheet).scrollTop > 0) return;
  y0 = e.touches[0].clientY; dy = 0; dragging = true; sheet.style.transition = 'none';
}, { passive:true });
sheet.addEventListener('touchmove', e => {
  if (!dragging) return;
  dy = Math.max(0, e.touches[0].clientY - y0);
  sheet.style.transform = `translateY(${dy}px)`;
}, { passive:true });
sheet.addEventListener('touchend', () => {
  if (!dragging) return;
  dragging = false;
  sheet.style.transition = ''; sheet.style.transform = '';
  if (dy > 90) closePost();
});

/* ── 글쓰기 ────────────────────────────────────────────────────────── */
const editor = $('#editor');
const titleInput = $('#titleInput'), bodyInput = $('#bodyInput'), dateInput = $('#dateInput');
const countEl = $('#count'), draftNote = $('#draftNote'), saveBtn = $('#saveBtn');
let editing = null;          // 수정 중인 글 (없으면 새 글)

const chars = s => [...String(s || '')].length;

function paintCount(){ countEl.textContent = chars(titleInput.value) + chars(bodyInput.value) + '자'; }

function autoGrow(){
  bodyInput.style.height = 'auto';
  bodyInput.style.height = Math.max(bodyInput.scrollHeight, Math.round(window.innerHeight * 0.3)) + 'px';
}
/* 제목도 입력한 만큼 늘어난다 — 긴 제목이 한 줄에 갇혀 옆으로 밀리지 않게 */
function autoGrowTitle(){
  titleInput.style.height = 'auto';
  titleInput.style.height = titleInput.scrollHeight + 'px';
}

let draftTimer = null;
function saveDraft(){
  clearTimeout(draftTimer);
  if (editing) return;                        // 수정 중인 글은 초안을 따로 두지 않는다
  draftTimer = setTimeout(() => {
    const v = { t: titleInput.value, b: bodyInput.value, d: dateInput.value };
    lsSet(K.draft, (v.t.trim() || v.b.trim()) ? v : undefined);
  }, 350);
}

function openEditor(post, prefill){
  editing = post || null;
  armedDel = false;
  titleInput.value = prefill ? prefill.t : (post ? post.t : '');
  bodyInput.value = prefill ? prefill.b : (post ? post.b : '');
  dateInput.value = prefill ? prefill.d : (post ? post.d : todayStr());
  draftNote.hidden = true;

  if (!post && !prefill){
    const draft = lsGet(K.draft, null);
    if (draft && ((draft.t || '').trim() || (draft.b || '').trim())){
      titleInput.value = draft.t || '';
      bodyInput.value = draft.b || '';
      dateInput.value = validDate(draft.d) ? draft.d : todayStr();
      draftNote.hidden = false;
    }
  }

  saveBtn.textContent = post ? '고치기' : '올리기';
  editor.hidden = false;
  document.documentElement.style.overflow = 'hidden';
  paintCount();
  autoGrowTitle();
  autoGrow();
  (post || titleInput.value ? bodyInput : titleInput).focus({ preventScroll:true });
}

function closeEditor(keepDraft){
  editor.hidden = true;
  document.documentElement.style.overflow = sheet.open ? 'hidden' : '';
  editing = null;
  titleInput.blur(); bodyInput.blur();
  if (!keepDraft) lsSet(K.draft, undefined);
}

async function savePost(){
  const t = titleInput.value.trim();
  const b = bodyInput.value.replace(/\s+$/, '');
  const d = validDate(dateInput.value) ? dateInput.value : todayStr();
  if (!t && !b.trim()){ toast('내용을 적어 주세요'); titleInput.focus(); return; }

  const now = Date.now();
  const wasEditing = editing;
  const before = state.posts;

  // 저장할 내용 한 벌. 새 글이면 id 를 새로 만들고, 고치는 글이면 같은 id 로 덮는다.
  const entry = wasEditing
    ? { ...wasEditing, t, b, d, u: now }
    : { id:'p' + now.toString(36), t, b, d, c: now, u: 0 };
  const op = wasEditing ? editOp(entry) : addOp(entry);

  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중…';
  state.posts = op(state.posts).sort(sortNewest);   // 먼저 화면에 (즉시 반응)
  render(true);
  closeEditor(false);

  try {
    state.posts = await change(op, wasEditing ? 'WebPost: 글 수정 — ' + (t || d)
                                              : 'WebPost: 새 글 — ' + (t || d));
    render(true);
    toast(remote ? '저장했어요 — 남들 화면엔 1분쯤 뒤' : '저장했어요');
  } catch (e) {
    state.posts = before; render(true);
    toast('저장하지 못했어요 — ' + e.message, 6000);
    if (remote) showBanner('저장하지 못했어요 — ' + e.message);
    setTimeout(() => openEditor(wasEditing, { t, b, d }), 200);   // 쓴 글을 잃지 않는다
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = wasEditing ? '고치기' : '올리기';
  }
}

/* ── 사진 ──────────────────────────────────────────────────────────
   기기에서 고른 사진을 줄여서 저장소 img/ 에 올리고, 본문에 주소를 넣는다.
   남의 이미지 호스트에 기대지 않는다 — 주소가 죽으면 글이 같이 죽는다. */
function b64Bytes(bytes){
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH){
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

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
    autoGrow();
    toast('사진을 올렸어요');
  } catch (e) {
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
/* 붙여넣기로도 — 데스크톱에서 캡처를 그냥 붙이는 쪽이 빠르다 */
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

$('#writeBtn').addEventListener('click', () => openEditor(null));
$('#cancelBtn').addEventListener('click', () => closeEditor(false));
$('#clearDraft').addEventListener('click', () => {
  titleInput.value = ''; bodyInput.value = ''; dateInput.value = todayStr();
  draftNote.hidden = true; lsSet(K.draft, undefined); paintCount(); autoGrowTitle(); autoGrow(); titleInput.focus();
});
$('#todayBtn').addEventListener('click', () => { dateInput.value = todayStr(); });
saveBtn.addEventListener('click', savePost);
titleInput.addEventListener('input', () => { paintCount(); autoGrowTitle(); saveDraft(); });
bodyInput.addEventListener('input', () => { paintCount(); autoGrow(); saveDraft(); });
dateInput.addEventListener('change', saveDraft);
titleInput.addEventListener('keydown', e => {
  if (e.key === 'Enter'){ e.preventDefault(); bodyInput.focus(); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !editor.hidden && !sheet.open){ e.preventDefault(); closeEditor(false); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !editor.hidden){ e.preventDefault(); savePost(); }
});

/* ── 검색 ─────────────────────────────────────────────────────────── */
const searchbar = $('#searchbar'), qEl = $('#q'), searchBtn = $('#searchBtn');
let qTimer = null, composing = false;

function setSearch(on){
  searchbar.hidden = !on;
  searchBtn.setAttribute('aria-pressed', String(on));
  if (on){
    qEl.focus();
  } else {
    qEl.value = ''; state.q = ''; render(true); setHash('');
  }
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
  qTimer = setTimeout(() => {
    state.q = (v || '').trim();
    render(true);
    setHash(state.q ? 'q=' + encodeURIComponent(state.q) : '');
  }, 120);
}

/* ── 해시 ─────────────────────────────────────────────────────────── */
function setHash(h){
  try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch {}
}
function readHash(){
  const h = location.hash.replace(/^#/, '');
  if (!h) return null;
  if (h.startsWith('p/')) return { post: h.slice(2) };
  if (h.startsWith('q=')) return { q: decodeURIComponent(h.slice(2)) };
  return null;
}

/* ── 설정 ─────────────────────────────────────────────────────────── */
const setDlg = $('#settings');
const activeTheme = () => document.documentElement.dataset.theme
  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const SUN = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>';
const MOON = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z"/></svg>';

function paintTheme(){
  const dark = activeTheme() === 'dark';
  $('#themeBtn').innerHTML = dark ? SUN : MOON;
  $('#themeBtn').title = dark ? '밝은 화면으로' : '어두운 화면으로';
  $('#setTheme').textContent = dark ? '밝게' : '어둡게';
}
function toggleTheme(){
  const next = activeTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(K.theme, next); } catch {}   // 인라인 스크립트가 raw 로 읽는다
  paintTheme();
}
$('#themeBtn').addEventListener('click', toggleTheme);
$('#setTheme').addEventListener('click', toggleTheme);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', paintTheme);

$('#setBtn').addEventListener('click', () => {
  $('#ghOwner').value = GH ? GH.owner : '';
  $('#ghRepo').value = GH ? GH.repo : '';
  $('#ghToken').value = GH ? GH.token : '';
  $('#setMode').textContent = remote
    ? `지금은 GitHub(${GH.owner}/${GH.repo})의 글을 읽고 있어요.`
    : '지금은 이 기기에만 저장하고 있어요.';
  setDlg.showModal();
  requestAnimationFrame(() => setDlg.classList.add('is-open'));
});
function closeSet(){
  setDlg.classList.remove('is-open');
  setTimeout(() => { if (!setDlg.classList.contains('is-open') && setDlg.open) setDlg.close(); }, 260);
}
setDlg.addEventListener('close', () => setDlg.classList.remove('is-open'));
setDlg.addEventListener('click', e => { if (e.target === setDlg) closeSet(); });
$('#setClose').addEventListener('click', closeSet);

/* 연결 확인 — 읽기와 쓰기 권한을 따로 본다. 글을 건드리지 않고 확인만 한다. */
$('#ghTest').addEventListener('click', async () => {
  const btn = $('#ghTest');
  const owner = $('#ghOwner').value.trim();
  const repo = $('#ghRepo').value.trim();
  const token = $('#ghToken').value.trim();
  if (!owner || !repo || !token){ toast('아이디·저장소·토큰을 먼저 넣어 주세요'); return; }
  const H = { Authorization:'Bearer ' + token, Accept:'application/vnd.github+json' };
  btn.disabled = true; btn.textContent = '확인 중…';
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}?cb=${Date.now()}`,
      { headers: H, cache:'no-store' });
    if (!r.ok) throw new Error('저장소를 못 열었어요 (GitHub ' + r.status + ' ' + shortErr(await r.text()) + ')');
    const info = await r.json();
    const canWrite = !!(info.permissions && info.permissions.push);
    const c = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/posts.json?ref=main&cb=${Date.now()}`,
      { headers: H, cache:'no-store' });
    let n = 0;
    if (c.ok){
      const d = await c.json();
      try { const j = JSON.parse(unb64(d.content)); n = (Array.isArray(j) ? j : j.posts || []).length; } catch {}
    }
    if (!canWrite){
      toast('읽기는 되는데 쓰기 권한이 없어요 — 토큰의 Contents 를 Read and write 로 바꿔 주세요', 8000);
    } else if (!c.ok && c.status !== 404){
      toast('저장소는 열리는데 posts.json 을 못 읽어요 (GitHub ' + c.status + ')', 6000);
    } else {
      toast(`연결됐어요 — ${owner}/${repo} · 글 ${n}편 · 쓰기 권한 있음`, 5000);
    }
  } catch (e) {
    toast('연결 실패 — ' + e.message, 8000);
  } finally {
    btn.disabled = false; btn.textContent = '연결 확인';
  }
});

$('#ghSave').addEventListener('click', () => {
  const owner = $('#ghOwner').value.trim();
  const repo = $('#ghRepo').value.trim();
  const token = $('#ghToken').value.trim();
  if (!owner || !repo || !token){
    lsSet(K.gh, undefined);
    toast('로컬 저장으로 바꿨어요');
  } else {
    lsSet(K.gh, { owner, repo, token, branch:'main', path:'posts.json' });
    toast('저장소를 연결했어요');
  }
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
    const before = state.posts;
    state.posts = merge(state.posts).sort(sortNewest); render(true);
    try {
      state.posts = await change(merge, 'WebPost: JSON 가져오기');
      render(true);
      toast(incoming.length + '편을 가져왔어요');
    }
    catch (err){ state.posts = before; render(true); toast('가져오지 못했어요 — ' + err.message); }
  } catch {
    toast('JSON 을 읽을 수 없어요');
  } finally { e.target.value = ''; }
});

/* ── 토스트 ───────────────────────────────────────────────────────── */
let toastTimer = null;
function toast(msg, ms = 2600){
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ── 시작 ─────────────────────────────────────────────────────────── */
$('#bannerBtn')?.addEventListener('click', () => $('#setBtn').click());

async function init(){
  paintTheme();
  if (author) $('#writeBtn').hidden = false;

  state.posts = await loadPosts();
  render(true);

  const h = readHash();
  if (h && h.q){
    searchbar.hidden = false;
    searchBtn.setAttribute('aria-pressed', 'true');
    qEl.value = h.q;
    state.q = h.q;
    render(true);
  }
  if (h && h.post) openPost(h.post, false);
}
init();

addEventListener('hashchange', () => {
  const h = readHash();
  if (!h && state.openedId && sheet.open) closePost();
});
