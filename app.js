/* Dispatch: morning world briefing. Plain JS, no build step. */
(() => {
  'use strict';

  const TZ = 'Europe/Athens';
  const EDITION_HOUR = 8;
  const SECTIONS = ['World', 'Tech & Business'];

  /* ---------------- storage (never throws) ---------------- */
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('dispatch.' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (_) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('dispatch.' + key, JSON.stringify(value)); } catch (_) {}
    }
  };

  /* ---------------- state ---------------- */
  const state = {
    latest: null,
    index: null,
    editions: {},
    filter: 'All',
    lastFetch: 0,
    scroll: {},
    route: null,
    fromList: false,
    loadError: false
  };

  const view = document.getElementById('view');
  const tabbar = document.getElementById('tabbar');
  const toastEl = document.getElementById('toast');

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const safeUrl = (u) => {
    try { const p = new URL(u); return p.protocol === 'https:' ? p.href : '#'; } catch (_) { return '#'; }
  };
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };

  const asDate = (iso) => new Date(iso + 'T12:00:00Z');
  const fmt = (iso, opts) => new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: 'UTC' }, opts)).format(asDate(iso));
  const longDate = (iso) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const shortDate = (iso) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
  const weekday = (iso) => fmt(iso, { weekday: 'long' });

  function athensNow() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date());
    const g = (t) => parts.find((p) => p.type === t).value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: +g('hour'), minute: +g('minute') };
  }
  const addDays = (iso, n) => { const d = asDate(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  function publishedTime(ed) {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .format(new Date(ed.published));
    } catch (_) { return ''; }
  }

  const wordCount = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
  function readMinutes(story) {
    const text = [story.dek, ...(story.what || []), ...(story.background || []), story.why, story.say,
      ...(story.terms || []).map((t) => t.term + ' ' + t.def)].join(' ');
    return Math.max(1, Math.ceil(wordCount(text) / 200));
  }

  function editionNumber(date) {
    const list = (state.index && state.index.editions) || [];
    const i = list.findIndex((e) => e.date === date);
    return i === -1 ? null : list.length - i;
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  const icon = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 3.5v11"/><path d="M8 7.5l4-4 4 4"/><path d="M6 11.5H5.5A1.5 1.5 0 0 0 4 13v6a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-6a1.5 1.5 0 0 0-1.5-1.5H18"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></svg>',
    ext: '<svg viewBox="0 0 24 24"><path d="M14 4.5h5.5V10"/><path d="M19.5 4.5L11 13"/><path d="M17.5 13.5v4.5a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4.5"/></svg>'
  };

  /* ---------------- progress tracking ---------------- */
  const readMap = () => store.get('read', {});
  const isRead = (date, id) => (readMap()[date] || []).includes(id);
  function markRead(date, id) {
    const m = readMap();
    const list = m[date] || [];
    if (list.includes(id)) return;
    list.push(id);
    m[date] = list;
    store.set('read', m);
  }
  function readCount(ed) {
    const list = readMap()[ed.date] || [];
    return ed.stories.filter((s) => list.includes(s.id)).length;
  }

  function recordVisit(date) {
    const v = store.get('visits', []);
    if (!v.includes(date)) { v.push(date); v.sort(); store.set('visits', v.slice(-400)); }
  }
  function streak() {
    const v = new Set(store.get('visits', []));
    let day = athensNow().date;
    if (!v.has(day)) day = addDays(day, -1);
    let n = 0;
    while (v.has(day)) { n++; day = addDays(day, -1); }
    return n;
  }

  const quizMap = () => store.get('quiz', {});
  function quizAnswers(date) { return (quizMap()[date] || {}).answers || []; }
  function saveQuizAnswers(ed, answers) {
    const m = quizMap();
    const quiz = ed.quiz || [];
    const entry = { answers };
    if (quiz.length && answers.length >= quiz.length) {
      entry.right = answers.filter((a, i) => a === quiz[i].answer).length;
      entry.total = quiz.length;
    }
    m[ed.date] = entry;
    store.set('quiz', m);
  }

  /* ---------------- data ---------------- */
  async function getJSON(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(path + ' ' + res.status);
    return res.json();
  }

  async function loadLatest() {
    const [latest, index] = await Promise.all([
      getJSON('data/latest.json'),
      getJSON('data/index.json').catch(() => null)
    ]);
    const changed = !state.latest || state.latest.date !== latest.date || state.latest.published !== latest.published;
    state.latest = latest;
    state.editions[latest.date] = latest;
    if (index) state.index = index;
    state.lastFetch = Date.now();
    state.loadError = false;
    return changed;
  }

  async function loadEdition(date) {
    if (state.editions[date]) return state.editions[date];
    const ed = await getJSON(`data/editions/${encodeURIComponent(date)}.json`);
    state.editions[date] = ed;
    return ed;
  }

  /* ---------------- routing ---------------- */
  // #/                      today
  // #/story/<id>            story in today's edition
  // #/quiz                  today's quiz
  // #/archive               past editions
  // #/e/<date>              a past edition
  // #/e/<date>/story/<id>   story in a past edition
  // #/e/<date>/quiz         quiz for a past edition
  function parse(hash) {
    const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    let date = null;
    if (parts[0] === 'e' && parts[1]) { date = parts[1]; parts.splice(0, 2); }
    if (parts[0] === 'story' && parts[1]) return { name: 'story', date, id: parts[1] };
    if (parts[0] === 'quiz') return { name: 'quiz', date };
    if (parts[0] === 'archive') return { name: 'archive' };
    return { name: 'front', date };
  }
  const base = (date) => (!date || (state.latest && date === state.latest.date)) ? '#/' : `#/e/${encodeURIComponent(date)}`;
  const storyHref = (date, id) => (base(date) === '#/' ? '#/' : base(date) + '/') + 'story/' + encodeURIComponent(id);
  const quizHref = (date) => (base(date) === '#/' ? '#/' : base(date) + '/') + 'quiz';

  function routeKey(r) { return JSON.stringify(r); }

  function go(hash, replace) {
    if (replace) { history.replaceState(null, '', hash); render(); }
    else location.hash = hash;
  }

  async function render() {
    const prev = state.route;
    if (prev && (prev.name === 'front' || prev.name === 'archive' || prev.name === 'quiz')) {
      state.scroll[routeKey(prev)] = window.scrollY;
    }
    const r = parse(location.hash);
    state.fromList = !!(prev && prev.name === 'front' && r.name === 'story');
    state.route = r;

    document.querySelectorAll('.tab').forEach((t) => {
      const on = (t.dataset.tab === 'today' && (r.name === 'front' || r.name === 'story')) ||
        (t.dataset.tab === r.name);
      t.classList.toggle('active', on);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    tabbar.classList.toggle('hidden', r.name === 'story');
    view.classList.toggle('storymode', r.name === 'story');

    if (!state.latest) {
      if (state.loadError) return renderError();
      return renderLoading();
    }

    let ed = state.latest;
    if (r.date && r.date !== state.latest.date) {
      try { ed = await loadEdition(r.date); }
      catch (_) { return renderMissing(r.date); }
      if (parse(location.hash).date !== r.date) return; // user moved on
    }

    if (r.name === 'front') renderFront(ed, r);
    else if (r.name === 'story') renderStory(ed, r);
    else if (r.name === 'quiz') renderQuiz(ed);
    else if (r.name === 'archive') renderArchive();

    const y = (r.name !== 'story' && state.scroll[routeKey(r)]) || 0;
    window.scrollTo(0, y);
  }

  function mount(html, animate) {
    view.innerHTML = html;
    if (animate) {
      view.classList.remove('enter');
      void view.offsetWidth;
      view.classList.add('enter');
    }
  }

  /* ---------------- views ---------------- */
  function renderLoading() {
    mount(`
      <div class="masthead">
        <div class="dateline"><span class="label">&nbsp;</span></div>
        <h1>Dispatch</h1>
        <div class="rules"></div>
      </div>
      <div style="margin-top:28px">
        <div class="skel" style="height:12px;width:30%;margin-bottom:14px"></div>
        <div class="skel" style="height:34px;width:95%;margin-bottom:10px"></div>
        <div class="skel" style="height:34px;width:70%;margin-bottom:18px"></div>
        <div class="skel" style="height:16px;width:90%;margin-bottom:8px"></div>
        <div class="skel" style="height:16px;width:80%"></div>
      </div>`);
  }

  function renderError() {
    mount(`
      <div class="empty">
        <h2>Couldn't load the news</h2>
        <p>Check your connection, then try again.</p>
        <button class="btn" id="retry" style="max-width:220px;margin:22px auto 0">Try again</button>
      </div>`, true);
    document.getElementById('retry').onclick = () => boot();
  }

  function renderMissing(date) {
    mount(`
      <div class="empty">
        <h2>Edition not found</h2>
        <p>There's no edition for ${esc(longDate(date))}.</p>
        <a class="btn" href="#/" style="max-width:220px;margin:22px auto 0">Back to today</a>
      </div>`, true);
  }

  function noticeFor(ed) {
    if (ed !== state.latest) return '';
    const now = athensNow();
    if (ed.date >= now.date) return '';
    const day = weekday(ed.date);
    if (now.hour < EDITION_HOUR) {
      return `<div class="notice">Today's edition arrives at 08:00. Until then, here's ${esc(day)}'s.</div>`;
    }
    return `<div class="notice">Today's edition is running late, so you're reading ${esc(day)}'s. <button id="recheck">Check again</button></div>`;
  }

  function storyLink(ed, s, lead) {
    const read = isRead(ed.date, s.id);
    const mins = readMinutes(s);
    const meta = `<div class="meta">${mins} min read${read ? `<span class="dot"></span><span class="check">${icon.check}Read</span>` : ''}</div>`;
    if (lead) {
      return `
        <a class="lead${read ? ' read' : ''}" href="${storyHref(ed.date, s.id)}">
          <div class="tag"><span class="pill">Top story</span><span class="kicker">${esc(s.region)}</span></div>
          <h2>${esc(s.headline)}</h2>
          <p class="dek">${esc(s.dek)}</p>
          ${meta}
        </a>`;
    }
    return `
      <a class="item${read ? ' read' : ''}" href="${storyHref(ed.date, s.id)}">
        <div class="kicker">${esc(s.region)}</div>
        <h4>${esc(s.headline)}</h4>
        <p class="dek">${esc(s.dek)}</p>
        ${meta}
      </a>`;
  }

  function renderFront(ed, r) {
    const isToday = ed === state.latest;
    if (isToday && ed.date === athensNow().date) recordVisit(ed.date);
    const total = ed.stories.length;
    const done = readCount(ed);
    const mins = ed.stories.reduce((a, s) => a + readMinutes(s), 0);
    const no = editionNumber(ed.date);
    const f = state.filter;
    const lead = ed.stories[0];

    const counts = {};
    SECTIONS.forEach((sec) => { counts[sec] = ed.stories.filter((s) => s.section === sec).length; });

    let body = '';
    if (f === 'All') {
      body += storyLink(ed, lead, true);
      SECTIONS.forEach((sec) => {
        const items = ed.stories.slice(1).filter((s) => s.section === sec);
        if (!items.length) return;
        body += `<div class="section-head"><h3>${esc(sec)}</h3><span class="label">${counts[sec]} ${counts[sec] === 1 ? 'story' : 'stories'}</span></div>`;
        body += items.map((s) => storyLink(ed, s)).join('');
      });
    } else {
      const items = ed.stories.filter((s) => s.section === f);
      body += items.map((s, i) => storyLink(ed, s, i === 0 && s === lead)).join('');
    }

    const briefs = (f === 'All' && ed.briefs && ed.briefs.length) ? `
      <section class="briefs">
        <h3 class="label">In brief</h3>
        <ul>${ed.briefs.map((b) => `<li>${esc(b.text)}<a class="src" href="${esc(safeUrl(b.source.url))}" target="_blank" rel="noopener">${esc(b.source.name)}</a></li>`).join('')}</ul>
      </section>` : '';

    const answers = quizAnswers(ed.date);
    const qn = (ed.quiz || []).length;
    const qDone = qn && answers.length >= qn;
    const score = qDone ? answers.filter((a, i) => a === ed.quiz[i].answer).length : 0;
    const promo = qn ? `
      <a class="promo" href="${quizHref(ed.date)}">
        <div>
          <div class="label">Test yourself</div>
          <h3>${qDone ? `You scored ${score} of ${qn}` : `${qn} questions on ${isToday ? "today's" : esc(weekday(ed.date) + "'s")} news`}</h3>
          <p>${qDone ? 'Review your answers' : answers.length ? `Carry on from question ${answers.length + 1}` : 'About two minutes'}</p>
        </div>
        <span class="go">${icon.arrow}</span>
      </a>` : '';

    const banner = isToday ? '' : `<div class="banner"><span>${esc(longDate(ed.date))}</span><a href="#/">Back to today</a></div>`;

    mount(`
      ${banner}
      <header class="masthead">
        <div class="dateline">
          <span class="label">${esc(longDate(ed.date))}</span>
          <span class="label">${no ? 'No. ' + no : ''}</span>
        </div>
        <h1>Dispatch</h1>
        <div class="rules"></div>
        <p class="summary">${esc(ed.summary)}</p>
      </header>
      ${noticeFor(ed)}
      <div class="status">
        <div class="progress" aria-hidden="true"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div>
        <span class="meta">${done} of ${total} read<span class="dot"></span>${mins} min</span>
      </div>
      <div class="chips" role="group" aria-label="Filter stories">
        ${['All', ...SECTIONS].map((c) => `<button class="chip" data-f="${esc(c)}" aria-pressed="${c === f}">${esc(c)}${c !== 'All' ? ` <span style="opacity:.6">${counts[c]}</span>` : ''}</button>`).join('')}
      </div>
      ${body}
      ${briefs}
      ${promo}
      <footer class="footer">
        <div class="orn">* * *</div>
        <p>${isToday ? 'Next edition tomorrow at 08:00, Athens time.' : 'From the archive.'}${publishedTime(ed) && isToday ? `<br>Updated today at ${esc(publishedTime(ed))}.` : ''}</p>
        <p style="margin-top:6px">Written by Claude from the sources linked in each story.</p>
      </footer>
    `, !state.scroll[routeKey(r)]);

    view.querySelectorAll('.chip').forEach((b) => {
      b.onclick = () => { state.filter = b.dataset.f; state.scroll[routeKey(r)] = 0; renderFront(ed, r); };
    });
    const re = document.getElementById('recheck');
    if (re) re.onclick = () => refresh(true);
  }

  function renderStory(ed, r, direction) {
    const i = ed.stories.findIndex((s) => s.id === r.id);
    if (i === -1) { go(base(ed.date), true); return; }
    const s = ed.stories[i];
    const prev = ed.stories[i - 1];
    const next = ed.stories[i + 1];
    const mins = readMinutes(s);
    const hasQuiz = (ed.quiz || []).length > 0;

    const para = (arr, first) => (arr || []).map((p, j) =>
      `<p class="body${first && j === 0 ? ' dropcap' : ''}">${esc(p)}</p>`).join('');

    const nextCard = next ? `
      <a class="next" href="${storyHref(ed.date, next.id)}" data-nav="next">
        <div class="label"><span>Next story</span><span>${i + 2} of ${ed.stories.length}</span></div>
        <h3>${esc(next.headline)}</h3>
      </a>` : hasQuiz ? `
      <a class="next" href="${quizHref(ed.date)}">
        <div class="label"><span>You've reached the end</span><span>Quiz</span></div>
        <h3>Test yourself on ${ed === state.latest ? "today's" : esc(weekday(ed.date) + "'s")} news</h3>
      </a>` : `
      <a class="next" href="${base(ed.date)}">
        <div class="label"><span>You've reached the end</span></div>
        <h3>Back to the front page</h3>
      </a>`;

    mount(`
      <div class="story-top" id="storyTop">
        <button class="iconbtn" id="back" aria-label="Back to front page">${icon.back}</button>
        <span class="count">${i + 1} / ${ed.stories.length}</span>
        <div class="right">
          <button class="iconbtn" id="size" aria-label="Change text size"><span class="aa">Aa</span></button>
          <button class="iconbtn" id="share" aria-label="Share">${icon.share}</button>
        </div>
        <i class="readbar" id="readbar"></i>
      </div>
      <article class="article${direction ? ' in-' + direction : ''}" id="article">
        <div class="kicker">${esc(s.region)}<span class="dot" style="color:var(--faint)"></span><span style="color:var(--muted)">${esc(s.section)}</span></div>
        <h1>${esc(s.headline)}</h1>
        <p class="dek">${esc(s.dek)}</p>
        <div class="byline meta">${esc(shortDate(ed.date))}<span class="dot"></span>${mins} min read<span class="dot"></span>${(s.sources || []).length} sources</div>

        <h2 class="sub">What happened</h2>
        ${para(s.what, true)}

        <h2 class="sub">The background</h2>
        ${para(s.background)}

        <div class="why" id="why">
          <div class="label">Why it matters</div>
          <p>${esc(s.why)}</p>
        </div>

        <div class="say">
          <div class="label">Say it like this</div>
          <blockquote>${esc(s.say)}</blockquote>
          <button class="copy" id="copy">${icon.copy}Copy</button>
        </div>

        ${(s.terms && s.terms.length) ? `
          <h2 class="sub">Key terms</h2>
          <dl class="terms">${s.terms.map((t) => `<div><dt>${esc(t.term)}</dt><dd>${esc(t.def)}</dd></div>`).join('')}</dl>` : ''}

        <h2 class="sub">Sources</h2>
        <ol class="sources">${(s.sources || []).map((src) => `
          <li><a href="${esc(safeUrl(src.url))}" target="_blank" rel="noopener">${esc(src.name)}<span>${esc(host(src.url))}</span></a>${icon.ext}</li>`).join('')}
        </ol>

        ${nextCard}
        <p class="swipehint meta">${prev || next ? 'Swipe left or right to change story' : ''}</p>
      </article>
    `);

    const back = () => {
      if (state.fromList && history.length > 1) history.back();
      else go(base(ed.date), true);
    };
    document.getElementById('back').onclick = back;

    document.getElementById('size').onclick = () => {
      const order = ['m', 'l', 's'];
      const cur = store.get('size', 'm');
      const nxt = order[(order.indexOf(cur) + 1) % order.length];
      store.set('size', nxt);
      applySize();
      toast({ s: 'Small text', m: 'Medium text', l: 'Large text' }[nxt]);
    };

    document.getElementById('share').onclick = async () => {
      const text = `${s.headline}\n\n${s.say}`;
      try {
        if (navigator.share) { await navigator.share({ title: s.headline, text, url: location.href }); return; }
        await navigator.clipboard.writeText(text + '\n' + location.href);
        toast('Copied to clipboard');
      } catch (_) {}
    };

    document.getElementById('copy').onclick = async () => {
      try { await navigator.clipboard.writeText(s.say); toast('Copied'); }
      catch (_) { toast("Couldn't copy"); }
    };

    // story-to-story moves replace history, so Back always returns to the list
    view.querySelectorAll('a[data-nav="next"]').forEach((a) => {
      a.onclick = (e) => { e.preventDefault(); markRead(ed.date, s.id); move(ed, i + 1, 'left'); };
    });

    // mark as read once "Why it matters" has been seen
    const why = document.getElementById('why');
    if ('IntersectionObserver' in window && why) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) { markRead(ed.date, s.id); io.disconnect(); }
      }, { threshold: 0.6 });
      io.observe(why);
      cleanup.push(() => io.disconnect());
    }

    // reading progress bar + header rule
    const top = document.getElementById('storyTop');
    const bar = document.getElementById('readbar');
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? Math.min(1, window.scrollY / h) * 100 : 0) + '%';
      top.classList.toggle('scrolled', window.scrollY > 4);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    cleanup.push(() => window.removeEventListener('scroll', onScroll));
    onScroll();

    // horizontal swipe between stories
    const art = document.getElementById('article');
    let sx = 0, sy = 0, st = 0, tracking = false;
    const ts = (e) => {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); tracking = true;
    };
    const te = (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Date.now() - st > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
      if (window.getSelection && String(window.getSelection())) return;
      if (dx < 0 && next) { markRead(ed.date, s.id); move(ed, i + 1, 'left'); }
      else if (dx > 0 && prev) move(ed, i - 1, 'right');
    };
    art.addEventListener('touchstart', ts, { passive: true });
    art.addEventListener('touchend', te, { passive: true });

    // keyboard on desktop
    const kd = (e) => {
      if (e.key === 'ArrowRight' && next) move(ed, i + 1, 'left');
      else if (e.key === 'ArrowLeft' && prev) move(ed, i - 1, 'right');
      else if (e.key === 'Escape') back();
    };
    document.addEventListener('keydown', kd);
    cleanup.push(() => document.removeEventListener('keydown', kd));
  }

  function move(ed, idx, direction) {
    const target = ed.stories[idx];
    if (!target) return;
    const art = document.getElementById('article');
    const doIt = () => {
      runCleanup();
      history.replaceState(null, '', storyHref(ed.date, target.id));
      state.route = parse(location.hash);
      renderStory(ed, state.route, direction);
      window.scrollTo(0, 0);
    };
    if (art && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      art.classList.add(direction === 'left' ? 'out-left' : 'out-right');
      setTimeout(doIt, 170);
    } else doIt();
  }

  function renderQuiz(ed) {
    const quiz = ed.quiz || [];
    const isToday = ed === state.latest;
    const dayName = isToday ? "today's" : weekday(ed.date) + "'s";
    const head = `
      ${isToday ? '' : `<div class="banner"><span>${esc(longDate(ed.date))}</span><a href="#/quiz">Today's quiz</a></div>`}
      <header class="pagehead">
        <div class="label">Test yourself</div>
        <h1>Daily quiz</h1>
        <p>${quiz.length} questions on ${esc(dayName)} edition.</p>
      </header>`;

    if (!quiz.length) {
      mount(head + `<div class="empty"><p>No quiz for this edition.</p></div>`, true);
      return;
    }

    const answers = quizAnswers(ed.date);
    const prog = (cur) => `<div class="qprog">${quiz.map((q, i) => {
      const a = answers[i];
      const cls = a == null ? (i === cur ? 'done' : '') : (a === q.answer ? 'right' : 'wrong');
      return `<i class="${cls}"></i>`;
    }).join('')}</div>`;

    if (answers.length >= quiz.length) {
      const score = answers.filter((a, i) => a === quiz[i].answer).length;
      const line = score === quiz.length ? 'A perfect score. You know the news.'
        : score >= quiz.length - 1 ? 'Sharp. Nearly all of it stuck.'
        : score >= Math.ceil(quiz.length / 2) ? 'Solid. Reread the ones you missed.'
        : 'Worth another read of the front page.';
      mount(head + `
        ${prog(-1)}
        <div class="score">
          <div class="big">${score}<small>/${quiz.length}</small></div>
          <p>${esc(line)}</p>
        </div>
        <div class="review"><ul>${quiz.map((q, i) => {
          const ok = answers[i] === q.answer;
          return `<li><span class="mk ${ok ? 'r' : 'w'}">${ok ? '&#10003;' : '&#10005;'}</span><div>${esc(q.q)}<small>${esc(q.options[q.answer])}</small></div></li>`;
        }).join('')}</ul></div>
        <a class="btn" href="${base(ed.date)}">Back to the front page</a>
        <button class="btn ghost" id="retake">Retake quiz</button>
      `, true);
      document.getElementById('retake').onclick = () => { saveQuizAnswers(ed, []); renderQuiz(ed); window.scrollTo(0, 0); };
      return;
    }

    const qi = answers.length;
    const q = quiz[qi];
    mount(head + `
      ${prog(qi)}
      <section class="question">
        <div class="label">Question ${qi + 1} of ${quiz.length}</div>
        <h2>${esc(q.q)}</h2>
        <div class="opts">${q.options.map((o, j) => `
          <button class="opt" data-j="${j}"><span class="key">${'ABCD'[j]}</span><span>${esc(o)}</span></button>`).join('')}
        </div>
        <div id="after"></div>
      </section>
    `, qi === 0);

    view.querySelectorAll('.opt').forEach((b) => {
      b.onclick = () => {
        const j = +b.dataset.j;
        const ok = j === q.answer;
        view.querySelectorAll('.opt').forEach((x) => {
          const k = +x.dataset.j;
          x.disabled = true;
          if (k === q.answer) x.classList.add('right');
          else if (k === j) x.classList.add('wrong');
          else x.classList.add('dim');
        });
        const next = answers.concat(j);
        saveQuizAnswers(ed, next);
        const last = next.length >= quiz.length;
        document.getElementById('after').innerHTML = `
          <div class="explain">
            <div class="verdict ${ok ? 'r' : 'w'}">${ok ? 'Correct.' : 'Not quite.'}</div>
            <p>${esc(q.explain)}</p>
            ${q.story ? `<a href="${storyHref(ed.date, q.story)}">Read the story</a>` : ''}
          </div>
          <button class="btn" id="nextq">${last ? 'See your score' : 'Next question'}</button>`;
        document.getElementById('nextq').onclick = () => { renderQuiz(ed); window.scrollTo(0, 0); };
        const bars = view.querySelectorAll('.qprog i');
        if (bars[qi]) bars[qi].className = ok ? 'right' : 'wrong';
      };
    });
  }

  function renderArchive() {
    const list = (state.index && state.index.editions) || (state.latest ? [{
      date: state.latest.date, summary: state.latest.summary,
      stories: state.latest.stories.length, lead: state.latest.stories[0].headline
    }] : []);
    const reads = readMap();
    const totalRead = Object.values(reads).reduce((a, l) => a + l.length, 0);
    const qm = quizMap();
    let right = 0, asked = 0;
    Object.values(qm).forEach((q) => {
      if (!q.total) return;
      asked += q.total;
      right += q.right;
    });
    const st = streak();

    mount(`
      <header class="pagehead">
        <div class="label">Archive</div>
        <h1>Past editions</h1>
        <p>Every morning's edition, kept in one place.</p>
      </header>
      <div class="stats">
        <div><b>${st}</b><span>Day streak</span></div>
        <div><b>${totalRead}</b><span>Stories read</span></div>
        <div><b>${asked ? Math.round((right / asked) * 100) + '%' : '–'}</b><span>Quiz score</span></div>
      </div>
      ${list.map((e) => {
        const n = (reads[e.date] || []).length;
        const no = editionNumber(e.date);
        return `
          <a class="ed${state.latest && e.date === state.latest.date ? ' current' : ''}" href="${base(e.date)}">
            <div class="when"><span class="kicker">${esc(shortDate(e.date))}</span><span class="meta">${no ? 'No. ' + no + ' · ' : ''}${n ? `${n} of ${e.stories} read` : `${e.stories} stories`}</span></div>
            <h4>${esc(e.lead)}</h4>
            <p>${esc(e.summary)}</p>
          </a>`;
      }).join('')}
    `, !state.scroll[routeKey(state.route)]);
  }

  /* ---------------- lifecycle ---------------- */
  const cleanup = [];
  function runCleanup() { while (cleanup.length) { try { cleanup.pop()(); } catch (_) {} } }

  function applySize() {
    const s = store.get('size', 'm');
    if (s === 'm') document.documentElement.removeAttribute('data-size');
    else document.documentElement.setAttribute('data-size', s);
  }

  async function refresh(manual) {
    try {
      const before = state.latest && state.latest.date;
      const changed = await loadLatest();
      if (changed) {
        const r = parse(location.hash);
        if (before && state.latest.date !== before) toast(`${weekday(state.latest.date)}'s edition is here`);
        if (r.name !== 'story') { runCleanup(); render(); }
      } else if (manual) {
        toast('No new edition yet');
      }
    } catch (_) {
      if (manual) toast("Couldn't reach the server");
    }
  }

  async function boot() {
    applySize();
    renderLoading();
    try {
      await loadLatest();
    } catch (_) {
      state.loadError = true;
    }
    runCleanup();
    render();
  }

  window.addEventListener('hashchange', () => { runCleanup(); render(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.lastFetch > 60 * 1000) refresh(false);
  });
  // while the app stays open, look for the new edition every 10 minutes
  setInterval(() => {
    if (document.visibilityState !== 'visible' || !state.latest) return;
    const now = athensNow();
    if (state.latest.date < now.date && now.hour >= EDITION_HOUR) refresh(false);
  }, 10 * 60 * 1000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').catch(() => {});
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloaded) return;
        reloaded = true;
        location.reload();
      });
    });
  }

  boot();
})();
