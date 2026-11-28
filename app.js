/* KhoScore - web / desktop version.
 *
 * Everything lives in this browser. Nothing is sent anywhere, there is no account and
 * no server: teams and matches are held in localStorage under the same key names the
 * Android app uses ("teams", "matches", "liveMatchDraft"), so the two stay conceptually
 * identical. Two devices therefore never see each other's data, and clearing the
 * browser's site data wipes it exactly like uninstalling the app.
 */

/* ============================================================
   STORAGE
   ============================================================ */

const DB = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) {
      console.warn('unreadable', key, e);
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      toast('Storage is full or blocked - the change was not saved');
      return false;
    }
  },
  remove(key) { try { localStorage.removeItem(key); } catch (e) {} }
};

/**
 * Permanent tags.
 *
 * A record's place in the list is not its identity. Two phones both have a third
 * match and they are different matches, so anything that has to survive leaving
 * this device carries a tag of its own instead. The tag is never shown to anyone;
 * it only lets two devices agree on which record they are both talking about.
 */
const Ids = {

  make(prefix) {
    const r = () => Math.random().toString(36).slice(2, 7);
    return prefix + '-' + Date.now().toString(36) + '-' + r() + r();
  },

  /** Tags anything in the list that has none, and hands the list back. */
  stamp(list, prefix) {
    if (Array.isArray(list)) {
      for (const rec of list) {
        if (rec && typeof rec === 'object' && !rec.id) rec.id = Ids.make(prefix);
      }
    }
    return list;
  },

  /** True when at least one record is still untagged. */
  untagged(list) {
    return Array.isArray(list) && list.some(r => r && typeof r === 'object' && !r.id);
  }
};

/**
 * A team is identified by its name together with its side and age group, not by the
 * name alone: one club fields a men's and a women's side, and one per age group, all
 * under the same name.
 */
function sameTeam(a, b) {
  return (a.teamName || '').toLowerCase() === (b.teamName || '').toLowerCase()
      && (a.teamType || '') === (b.teamType || '')
      && (a.category || '') === (b.category || '');
}

const Teams = {
  all: () => DB.read('teams', []),
  save: list => DB.write('teams', Ids.stamp(list, 't')),

  /**
   * Looks a team up for matches saved before squads were stored. Names repeat, so
   * pass the side and age group where they are known and the right one is picked.
   */
  byName(name, teamType, category) {
    if (!name) return null;

    const named = this.all()
      .filter(t => (t.teamName || '').toLowerCase() === name.toLowerCase());

    if (!named.length) return null;

    const exact = named.find(t =>
      (!teamType || (t.teamType || '') === teamType) &&
      (!category || (t.category || '') === category));

    return exact || named[0];
  }
};

const Matches = {
  all: () => DB.read('matches', []),
  save: list => DB.write('matches', Ids.stamp(list, 'm')),
  add(m) { const l = this.all(); l.push(m); this.save(l); },
  byId(id) { return id ? this.all().find(m => m.id === id) || null : null; }
};

/**
 * Tournament draws. Each carries an id of its own, because two draws can easily
 * share a tournament name, a date, a side and an age group.
 */
const Draws = {
  all: () => DB.read('draws', []),
  save: list => DB.write('draws', Ids.stamp(list, 'd')),
  byId(id) { return this.all().find(d => d.id === id) || null; }
};

/**
 * Teams and score sheets saved before tags existed are tagged once, here, the
 * first time the app opens after the update. Nothing else about them changes and
 * nothing is lost. Draws have carried a tag since the day they were added.
 */
(function tagOlderRecords() {
  const teams = Teams.all();
  if (Ids.untagged(teams)) Teams.save(teams);

  const matches = Matches.all();
  if (Ids.untagged(matches)) Matches.save(matches);

  const draws = Draws.all();
  if (Ids.untagged(draws)) Draws.save(draws);
})();

/* ============================================================
   SMALL UI HELPERS
   ============================================================ */

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

let toastTimer = null;

/**
 * A short message at the bottom of the screen. With an action it becomes a
 * snackbar - "Wicket recorded  Undo" - and stays tappable while it shows.
 */
function toast(msg, ms = 2400, action = null) {
  const el = $('#toast');
  el.textContent = '';

  const text = document.createElement('span');
  text.textContent = msg;
  el.appendChild(text);

  el.classList.toggle('actionable', !!action);

  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.onclick = () => {
      el.classList.remove('show', 'actionable');
      clearTimeout(toastTimer);
      action.run();
    };
    el.appendChild(b);
  }

  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show', 'actionable'), ms);
}

/** Promise-based confirm. Resolves 'yes' | 'no' | 'alt'. */
function ask(title, body, { yes = 'OK', no = 'Cancel', alt = null } = {}) {
  return new Promise(resolve => {
    const dlg = $('#dlgConfirm');
    $('#cfTitle').textContent = title;
    $('#cfBody').textContent = body || '';
    $('#cfYes').textContent = yes;
    $('#cfNo').textContent = no;

    const altBtn = $('#cfAlt');
    altBtn.style.display = alt ? '' : 'none';
    if (alt) altBtn.textContent = alt;

    const done = v => { dlg.close(); cleanup(); resolve(v); };
    const onYes = () => done('yes');
    const onNo = () => done('no');
    const onAlt = () => done('alt');
    const onCancel = () => { cleanup(); resolve('no'); };

    function cleanup() {
      $('#cfYes').removeEventListener('click', onYes);
      $('#cfNo').removeEventListener('click', onNo);
      altBtn.removeEventListener('click', onAlt);
      dlg.removeEventListener('cancel', onCancel);
    }

    $('#cfYes').addEventListener('click', onYes);
    $('#cfNo').addEventListener('click', onNo);
    altBtn.addEventListener('click', onAlt);
    dlg.addEventListener('cancel', onCancel);
    dlg.showModal();
  });
}

/** Promise-based list of choices. Resolves the chosen value, or null. */
function choose(title, body, options) {
  return new Promise(resolve => {
    const dlg = $('#dlgChoice');
    $('#chTitle').textContent = title;
    $('#chBody').textContent = body || '';

    const box = $('#chActions');
    box.innerHTML = '';

    options.forEach(o => {
      const b = document.createElement('button');
      b.textContent = o.label;
      if (o.cls) b.className = o.cls;
      b.onclick = () => { dlg.close(); resolve(o.value); };
      box.appendChild(b);
    });

    dlg.addEventListener('cancel', () => resolve(null), { once: true });
    dlg.showModal();
  });
}

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
       + '-' + String(d.getDate()).padStart(2, '0');
}

/** Stored in the same shape the Android app writes, e.g. "23 / 9 / 2026". */
function isoToDisplay(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return Number(d) + ' / ' + Number(m) + ' / ' + y;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ============================================================
   NAVIGATION
   ============================================================ */

/* The tab bar belongs to browsing. Registering a team, starting a match and
   scoring one are flows with a beginning and an end, so it steps aside for
   them. A screen under a tab lights that tab: a match opened from anywhere is
   still a score sheet. */
const TAB_OF = {
  home: 'home', account: 'account',
  teams: 'teams', teamdetail: 'teams',
  draws: 'draws', drawdetail: 'draws',
  sheets: 'sheets', detail: 'sheets'
};

function markTab(name) {
  const tab = TAB_OF[name] || null;

  document.body.dataset.screen = name;
  document.body.classList.toggle('no-tabs', !tab);

  $$('#tabbar [data-tab]').forEach(b => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

const history_ = [];
let current = 'home';

function go(name, push = true, reset = false) {
  if (reset) {
    // leaving for good: the screen behind must not be reachable again, or a back
    // press would land on a match that is no longer being scored
    history_.length = 0;
    history.replaceState({ screen: name }, '');

  } else if (push && name !== current) {
    history_.push(current);

    // mirror the move into the browser's own history, so a phone's back button
    // or gesture steps back through the app instead of leaving it
    history.pushState({ screen: name }, '');
  }
  current = name;
  $$('.screen').forEach(s => s.classList.remove('active'));
  $('#s-' + name).classList.add('active');
  markTab(name);
  window.scrollTo(0, 0);
  if (SCREEN_ENTER[name]) SCREEN_ENTER[name]();
}

/* The on-screen Back hands over to the browser rather than moving screens itself,
   so it and the phone's back button take exactly the same path. */
function back() {
  if (history_.length) history.back();
}

window.addEventListener('popstate', () => {

  // a live match must not be dropped by an accidental back press, so put the
  // entry the browser just removed back and let confirmExit decide
  if (current === 'scoring' && Scoring.isLive()) {
    history.pushState({ screen: 'scoring' }, '');
    Scoring.confirmExit();
    return;
  }

  let prev = history_.pop();

  // never step back into the scoring screen once the match behind it has gone
  while (prev === 'scoring' && !Scoring.isLive()) prev = history_.pop();

  // nothing left to unwind means we are on the home screen; let the back press
  // leave the app as it normally would
  if (prev) go(prev, false);
});

const SCREEN_ENTER = {
  home: renderHome,
  teams: renderTeams,
  draws: renderDraws,
  sheets: renderSheets,
  account: renderAccount
};

document.addEventListener('click', e => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    // the tab you are already on takes you back to its top
    if (tabBtn.dataset.tab === current) window.scrollTo({ top: 0, behavior: 'smooth' });
    else go(tabBtn.dataset.tab);
    return;
  }

  if (e.target.closest('.sunbtn')) { toggleSunlight(); return; }

  const goBtn = e.target.closest('[data-go]');
  if (goBtn) {
    // reaching registration from the menu is always a new team, never the one
    // that happened to be open in the editor
    if (goBtn.dataset.go === 'register' && editingTeam) regClear();
    go(goBtn.dataset.go);
    return;
  }
  if (e.target.closest('[data-back]')) back();
});

markTab(current);

/* ---------------- Sunlight ----------------
   A high-contrast palette for scoring outdoors at midday. Remembered on this
   device only, and applied in the page head before anything paints. */

function setSunlight(on) {
  if (on) document.documentElement.dataset.sun = 'on';
  else delete document.documentElement.dataset.sun;

  try { localStorage.setItem('sunlight', on ? '1' : '0'); } catch (e) {}

  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = on ? '#F4F7FB' : '#0F172A';
}

function toggleSunlight() {
  const on = document.documentElement.dataset.sun !== 'on';
  setSunlight(on);
  toast(on ? 'Sunlight on - high contrast for outdoors' : 'Back to the night palette');
}

/* ============================================================
   HOME
   ============================================================ */

/** The three letters a team is known by at a glance: Satara is SAT. */
function teamCode(name) {
  const letters = String(name || '').replace(/[^A-Za-z]/g, '');
  return (letters.slice(0, 3) || '?').toUpperCase();
}

/** "2nd Inning · 1st Half" for a phase number. */
function phaseName(p) {
  return ({
    1: '1st Inning · 1st Half', 2: '1st Inning · 2nd Half',
    3: '2nd Inning · 1st Half', 4: '2nd Inning · 2nd Half',
    5: '3rd Inning · 1st Half', 6: '3rd Inning · 2nd Half',
    7: 'Sudden Death · 1st Half', 8: 'Sudden Death · 2nd Half'
  })[p] || '';
}

/** Today in the same form dateKey gives any stored date. */
function todayKey() {
  return dateKey(isoToDisplay(todayIso()));
}

/** A day key as a number that sorts, or NaN for a date that cannot be read. */
function keyTime(key) {
  const p = String(key).split('-').map(n => parseInt(n, 10));
  return p.length === 3 && p.every(n => !isNaN(n)) ? Date.UTC(p[2], p[1] - 1, p[0]) : NaN;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "28 Nov" for a day key. */
function dayLabel(key) {
  const p = String(key).split('-').map(n => parseInt(n, 10));
  return p.length === 3 && !isNaN(p[0]) && p[1] >= 1 && p[1] <= 12
    ? p[0] + ' ' + MONTHS[p[1] - 1]
    : String(key);
}

/** True for a score sheet that was settled in sudden death. */
function wentToSuddenDeath(m) {
  return (m.halfTitles || []).some(h => String(h).startsWith('Sudden Death'));
}

/**
 * The line that says whether this phone is sharing, and whether it can.
 * Everything is saved on the phone either way; the line is there so that a bad
 * signal at a ground is something you are told, not something you find out.
 */
function renderSyncStrip(sel) {
  const strip = $(sel);
  if (!strip) return;

  const rooms = (typeof Room === 'undefined') ? []
    : Draws.all().map(d => Room.forDraw(d.id)).filter(Boolean);

  const offline = navigator.onLine === false;

  if (!rooms.length && !offline) { strip.hidden = true; return; }

  strip.hidden = false;
  strip.classList.toggle('off', offline);

  if (offline) {
    strip.innerHTML = '<span class="dot"></span> No signal &mdash; everything is saved on this phone'
      + (rooms.length ? '<span class="push">sheets send when you are back</span>' : '');
    return;
  }

  const hosting = rooms.filter(r => r.host).length;
  const joined = rooms.length - hosting;
  const parts = [];
  if (hosting) parts.push('Hosting ' + hosting + (hosting === 1 ? ' tournament' : ' tournaments'));
  if (joined) parts.push('Joined ' + joined);

  strip.innerHTML = '<svg width="16" height="16" aria-hidden="true"><use href="#i-cloud"/></svg> '
    + esc(parts.join(' · '));
}

window.addEventListener('online', () => { if (current === 'home') renderHome(); });
window.addEventListener('offline', () => { if (current === 'home') renderHome(); });

/** A tappable row: name, a line under it, and something on the right. */
function infoRow(name, meta, right, onTap) {
  const row = document.createElement('div');
  row.className = 'listrow' + (onTap ? ' pick' : '');
  row.innerHTML = `<div class="grow"><div class="name">${name}</div>`
    + (meta ? `<div class="meta">${meta}</div>` : '') + `</div>` + (right || '');
  if (onTap) row.onclick = onTap;
  return row;
}

/**
 * Today.
 *
 * The home screen says what is happening rather than offering six doors: an
 * unfinished match first, then today's matches with their results and the ties
 * still to play, then the way into a new one.
 */
function renderHome() {
  renderSyncStrip('#syncStrip');

  // ---- the unfinished match ----
  const draft = DB.read('liveMatchDraft', null);
  const live = $('#homeLive');

  if (draft && draft.team1 && draft.team2) {
    live.hidden = false;
    $('#hlName1').textContent = draft.team1.teamName;
    $('#hlName2').textContent = draft.team2.teamName;
    $('#hlCode1').textContent = teamCode(draft.team1.teamName);
    $('#hlCode2').textContent = teamCode(draft.team2.teamName);
    $('#hlScore1').textContent = draft.team1Score || 0;
    $('#hlScore2').textContent = draft.team2Score || 0;
    $('#hlPhase').textContent = phaseName(draft.currentPhase);
    $('#hlTime').textContent = typeof draft.timeLeft === 'number'
      ? fmtTime(draft.timeLeft) + ' left' : '';
  } else {
    live.hidden = true;
  }

  // ---- today ----
  const today = todayKey();
  const all = Matches.all();
  const draws = Draws.all();

  const played = [];
  all.forEach((m, i) => { if (dateKey(m.date) === today) played.push({ m, i }); });

  const drawsToday = draws.filter(d => drawDates(d).map(dateKey).includes(today));

  const toPlay = [];
  drawsToday.forEach(d => (d.bracket || []).forEach(tie => {
    if (tie.b && !tieWinner(d, tie)) toPlay.push({ draw: d, tie });
  }));

  const box = $('#homeToday');
  box.innerHTML = `<p class="eyebrow">Today &middot; ${esc(dayLabel(today))}</p>`;

  const card = document.createElement('div');
  card.className = 'card tight';

  toPlay.forEach(({ draw, tie }) => {
    card.appendChild(infoRow(
      `${esc(tie.a)} v ${esc(tie.b)}`,
      esc(draw.tournament || 'Tournament'),
      '<span class="chip next">To play</span>',
      () => { showDraw(draw); showDrawTab('draw'); }));
  });

  played.slice().reverse().forEach(({ m, i }) => {
    const sd = wentToSuddenDeath(m);
    card.appendChild(infoRow(
      `${esc(m.team1Name)} v ${esc(m.team2Name)}`,
      `${esc((m.teamType || 'Men') + ' ' + (m.category || 'Open'))} &middot; `
        + (isDraw(m) ? 'Draw' : 'won by ' + esc(m.winner)) + (sd ? ' &middot; sudden death' : ''),
      `<span class="score">${m.team1Score}&ndash;${m.team2Score}</span>`,
      () => showDetail(m, i)));
  });

  if (!card.children.length) {
    card.innerHTML = '<div class="empty">Nothing scored today yet</div>';
  }
  box.appendChild(card);

  // ---- today's tournaments ----
  const tBox = $('#homeTournaments');
  tBox.innerHTML = '';
  drawsToday.forEach(d => {
    const b = document.createElement('button');
    b.className = 'grey big';
    b.textContent = 'Open ' + (d.tournament || 'tournament');
    b.onclick = () => showDraw(d);
    tBox.appendChild(b);
  });

  // ---- what is on this phone ----
  const teams = Teams.all();
  const sides = [...new Set(teams.map(t => (t.teamType || 'Men') + ' ' + (t.category || 'Open')))];

  const counts = $('#homeCounts');
  counts.innerHTML = '';

  counts.appendChild(teams.length
    ? infoRow(`${teams.length} ${teams.length === 1 ? 'team' : 'teams'} registered`,
        esc(sides.slice(0, 3).join(', ') + (sides.length > 3 ? ' and more' : '')),
        '<span class="chip">Teams</span>', () => go('teams'))
    : infoRow('Register your first team', 'Squads are typed once and used in every match',
        '<span class="chip next">Register</span>', () => go('register')));

  counts.appendChild(infoRow(
    `${all.length} score ${all.length === 1 ? 'sheet' : 'sheets'}`,
    played.length ? `${played.length} today` : 'none today',
    '<span class="chip">Sheets</span>', () => go('sheets')));

  counts.appendChild(infoRow(
    `${draws.length} ${draws.length === 1 ? 'tournament' : 'tournaments'}`,
    drawsToday.length ? `${drawsToday.length} on today` : 'none on today',
    '<span class="chip">Draws</span>', () => go('draws')));
}

$('#resumeBtn').onclick = () => {
  const draft = DB.read('liveMatchDraft', null);
  if (!draft) { toast('No unfinished match'); renderHome(); return; }
  Scoring.resume(draft);
};

$('#startMatchBtn').onclick = async () => {
  const draft = DB.read('liveMatchDraft', null);

  if (draft && draft.team1) {
    const r = await ask('Match in Progress',
      'A match is still being scored. Starting a new one will discard it.',
      { yes: 'Discard & Start New', no: 'Cancel', alt: 'Resume it' });

    if (r === 'no') return;
    if (r === 'alt') { Scoring.resume(draft); return; }
    DB.remove('liveMatchDraft');
  }

  go('select');
  renderSelect();
};

/* ============================================================
   TEAM REGISTRATION
   ============================================================ */

(function buildPlayerInputs() {
  const box = $('#playerInputs');
  for (let i = 1; i <= TeamShare.MAX_PLAYERS; i++) {
    const d = document.createElement('div');
    d.className = 'field';
    d.innerHTML = `<input type="text" id="p${i}" placeholder="Player ${i}">`;
    box.appendChild(d);
  }
})();

/* Enter jumps to the next box so a whole squad can be typed without reaching for the
   mouse; Shift+Enter steps back to fix a typo. The last player hands focus to SAVE TEAM
   rather than saving outright, so a stray extra Enter cannot store a half-filled team. */
(function enterMovesOn() {
  const chain = ['#regTeam', '#regCoach'];
  for (let i = 1; i <= TeamShare.MAX_PLAYERS; i++) chain.push('#p' + i);

  chain.forEach((sel, i) => {
    $(sel).addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;

      e.preventDefault();

      const target = e.shiftKey ? chain[i - 1] : chain[i + 1];

      if (target) {
        const el = $(target);
        el.focus();
        el.select();
      } else if (!e.shiftKey) {
        $('#saveTeamBtn').focus();
      }
    });
  });
})();

function regClear() {
  $('#regTeam').value = '';
  $('#regCoach').value = '';
  $$('input[name=regType]').forEach(r => r.checked = false);
  $$('input[name=regCat]').forEach(r => r.checked = false);
  for (let i = 1; i <= TeamShare.MAX_PLAYERS; i++) $('#p' + i).value = '';

  editingTeam = null;
  setRegMode();
}

function regFill(parsed) {
  $('#regTeam').value = parsed.teamName || '';
  $('#regCoach').value = parsed.coachName || '';

  $$('input[name=regType]').forEach(r => r.checked = (r.value === parsed.teamType));
  $$('input[name=regCat]').forEach(r => r.checked = (r.value === parsed.category));

  for (let i = 1; i <= TeamShare.MAX_PLAYERS; i++) {
    $('#p' + i).value = parsed.players[i - 1] || '';
  }

  const missing = [];
  if (!parsed.teamName) missing.push('team name');
  if (!parsed.coachName) missing.push('coach');
  if (!parsed.teamType) missing.push('type');
  if (!parsed.category) missing.push('category');

  toast(missing.length
    ? 'Still missing: ' + missing.join(', ')
    : parsed.players.length + ' players read - check and tap SAVE TEAM', 4000);
}

$('#inviteBtn').onclick = async () => {
  const text = TeamShare.buildTemplate();

  if (navigator.share) {
    try { await navigator.share({ title: 'Kho Kho team registration', text }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }

  try {
    await navigator.clipboard.writeText(text);
    toast('Blank form copied - paste it into WhatsApp', 4000);
  } catch (e) {
    // clipboard blocked: show it so it can be copied by hand
    $('#pasteText').value = text;
    $('#dlgPaste').showModal();
  }
};

$('#pasteBtn').onclick = async () => {
  let clip = '';
  try { clip = await navigator.clipboard.readText(); } catch (e) { /* needs permission */ }

  const parsed = TeamShare.parse(clip);
  if (parsed) { regFill(parsed); return; }

  $('#pasteText').value = clip || '';
  $('#dlgPaste').showModal();
};

$('#pasteCancel').onclick = () => $('#dlgPaste').close();

$('#pasteOk').onclick = () => {
  const parsed = TeamShare.parse($('#pasteText').value);
  if (!parsed) { toast('Could not read a team from that message'); return; }
  $('#dlgPaste').close();
  regFill(parsed);
};

$('#saveTeamBtn').onclick = () => {
  const name = $('#regTeam').value.trim();
  const coach = $('#regCoach').value.trim();

  const players = [];
  for (let i = 1; i <= TeamShare.MAX_PLAYERS; i++) {
    const v = $('#p' + i).value.trim();
    if (v) players.push(v);
  }

  if (!name || !coach) { toast('Enter team & coach name'); return; }

  if (players.length < 9) {
    toast('Enter at least 9 players (' + players.length + ' entered)', 3500);
    return;
  }

  const type = $('input[name=regType]:checked');
  if (!type) { toast('Select team type'); return; }

  const cat = $('input[name=regCat]:checked');
  if (!cat) { toast('Select category'); return; }

  const entry = {
    teamName: name, coachName: coach,
    teamType: type.value, category: cat.value,
    players
  };

  const list = Teams.all();

  // the same name is fine for another side or age group; only an exact repeat
  // clashes, and a team being edited never clashes with itself
  const clash = list.some(t =>
    sameTeam(t, entry) && !(editingTeam && sameTeam(t, editingTeam)));

  if (clash) {
    toast('A ' + type.value + ' ' + cat.value + ' team named "' + name
      + '" already exists', 4000);
    return;
  }

  if (editingTeam) {
    const i = list.findIndex(t => sameTeam(t, editingTeam));

    if (i === -1) { toast('That team is no longer registered', 3500); return; }

    // an edited team is the same team: it keeps its tag, or another device would
    // read the rename as a second team rather than a change to this one
    entry.id = list[i].id || editingTeam.id;

    list[i] = entry;
    Teams.save(list);

    toast('Team Updated (' + players.length + ' players)');
    regClear();

    // back to the list with the form and the detail screen dropped from the way
    // back, so a back press goes home rather than reopening the edit form
    history_.length = 0;
    current = 'home';
    go('teams');
    return;
  }

  list.push(entry);
  Teams.save(list);

  toast('Team Saved (' + players.length + ' players)');
  regClear();
  back();
};

/* ============================================================
   REGISTERED TEAMS
   ============================================================ */

/* Which category sections are expanded, keyed "Men|U14". Collapsed to start with:
   five age groups on each side is mostly headings otherwise. */
const openCats = new Set();

function renderTeams() {
  const q = $('#teamSearch').value.trim().toLowerCase();
  const all = Teams.all();

  const match = t => !q
    || (t.teamName || '').toLowerCase().includes(q)
    || (t.coachName || '').toLowerCase().includes(q);

  const box = $('#teamGroups');
  box.innerHTML = '';

  let shown = 0, menShown = 0;

  [['Men', 'Men', ''], ['Women', 'Women', '']]
    .forEach(([type, title, colour]) => {

      const sideTeams = all.filter(t => (t.teamType || 'Men') === type);
      let sideShown = 0;

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<h2>${title}</h2>`;

      ['U14', 'U17', 'U18', 'U19', 'Open'].forEach(cat => {
        const list = sideTeams.filter(t => (t.category || 'Open') === cat).filter(match);
        if (q && !list.length) return; // hide empty sections while searching

        const key = type + '|' + cat;

        // a search has to show what it found, so matches open regardless
        const open = q ? true : openCats.has(key);

        const h = document.createElement('h3');
        h.className = 'cathead';
        h.style.color = colour;
        h.innerHTML = `<span class="arrow">${open ? '▾' : '▸'}</span>`
                    + `<span class="catname">${cat}</span>`
                    + `<span class="catcount">${list.length}</span>`;

        h.onclick = () => {
          if (openCats.has(key)) openCats.delete(key); else openCats.add(key);
          renderTeams();
        };

        card.appendChild(h);

        const body = document.createElement('div');
        body.hidden = !open;

        if (!list.length) {
          const e = document.createElement('div');
          e.className = 'empty';
          e.textContent = 'None';
          body.appendChild(e);
        } else {
          list.forEach(t => {
            sideShown++;
            body.appendChild(teamRow(t));
          });
        }

        card.appendChild(body);
      });

      if (q && !sideShown) return; // hide the whole side when nothing matches

      shown += sideShown;
      if (type === 'Men') menShown = sideShown;
      box.appendChild(card);
    });

  const info = $('#teamSearchInfo');

  if (!q) {
    info.style.display = 'none';
  } else {
    info.style.display = '';
    info.textContent = shown === 0
      ? `No team matches "${$('#teamSearch').value}"`
      : `${shown} of ${all.length} teams   •   ${menShown} men, ${shown - menShown} women`;
  }

  if (!all.length) {
    box.innerHTML = '<div class="card empty">No teams registered yet. '
      + 'Tap <b>+</b> at the top to register one.</div>';
  }
}

/** Whether a team is playing in any tournament of its own side and age group. */
function teamInAnyDraw(team) {
  return Draws.all().some(d =>
    (d.teamType || 'Men') === (team.teamType || 'Men')
    && (d.category || 'Open') === (team.category || 'Open')
    && teamsInDraw(d).some(t => sameName(t.teamName, team.teamName)));
}

/** A small trash button for the end of a row. */
function trashButton(label) {
  const b = document.createElement('button');
  b.className = 'iconbtn danger';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = '<svg><use href="#i-trash"/></svg>';
  return b;
}

function teamRow(team) {
  const row = document.createElement('div');
  row.className = 'listrow';

  row.innerHTML = `
    <span class="crest">${esc(teamCode(team.teamName))}</span>
    <div class="grow pick">
      <div class="name">${esc(team.teamName)}</div>
      <div class="meta">${team.players.length} players • Coach: ${esc(team.coachName)}</div>
    </div>`
    + (teamInAnyDraw(team) ? '<span class="chip done">In draw</span>' : '');

  row.querySelector('.grow').onclick = () => showTeamDetail(team);

  const del = trashButton('Delete ' + team.teamName);
  del.onclick = async () => {
    if (await ask('Delete Team',
      `Delete ${team.teamName} (${team.teamType} ${team.category})?`,
      { yes: 'Delete' }) !== 'yes') return;

    // match on the whole identity: a side sharing this name must not go with it
    Teams.save(Teams.all().filter(t => !sameTeam(t, team)));
    toast('Team Deleted');
    renderTeams();
  };
  row.appendChild(del);

  return row;
}

$('#teamSearch').addEventListener('input', renderTeams);

function showTeamDetail(team) {
  $('#tdName').textContent = team.teamName;
  $('#tdMeta').textContent = `Coach: ${team.coachName}  •  ${team.teamType} ${team.category}`
                           + `  •  ${team.players.length} players`;
  $('#tdPlayers').innerHTML = team.players
    .map((p, i) => `<div class="listrow"><span class="rank">${i + 1}</span>`
      + `<div class="grow">${esc(p)}</div></div>`)
    .join('');

  $('#tdEditBtn').onclick = () => editTeam(team);

  go('teamdetail');
}

/* ============================================================
   EDITING A REGISTERED TEAM

   The registration screen is reused rather than duplicated: it already has the
   player boxes, the Enter-to-next behaviour and every check. editingTeam holds
   the team as it was, so the save knows to replace it instead of adding one.
   ============================================================ */

let editingTeam = null;

function editTeam(team) {
  editingTeam = team;

  $('#regTeam').value = team.teamName;
  $('#regCoach').value = team.coachName;

  for (let i = 1; i <= TeamShare.MAX_PLAYERS; i++) {
    $('#p' + i).value = team.players[i - 1] || '';
  }

  const type = document.querySelector(`input[name=regType][value="${team.teamType}"]`);
  if (type) type.checked = true;

  const cat = document.querySelector(`input[name=regCat][value="${team.category}"]`);
  if (cat) cat.checked = true;

  setRegMode();
  go('register');
}

/** Puts the registration screen into add or edit wording. */
function setRegMode() {
  $('#regTitle').textContent = editingTeam ? 'Edit team' : 'Register a team';
  $('#saveTeamBtn').textContent = editingTeam ? 'Update team' : 'Save team';

  // importing a WhatsApp reply over a team being edited would be confusing
  $('#regInviteRow').style.display = editingTeam ? 'none' : '';
}

/* ============================================================
   MATCH SELECTION
   ============================================================ */

let selPool = [];       // teams of the chosen type + category
let selPicked = [];     // chosen teams, held by object not index

function renderSelect() {
  const type = $('input[name=selType]:checked').value;
  const cat = $('input[name=selCat]:checked').value;

  selPool = Teams.all().filter(t =>
    (t.teamType || 'Men') === type && (t.category || 'Open') === cat);

  selPicked = selPicked.filter(t => selPool.includes(t));

  applySelSearch();
}

function applySelSearch() {
  const q = $('#selSearch').value.trim().toLowerCase();

  const visible = selPool.filter(t => !q
    || (t.teamName || '').toLowerCase().includes(q)
    || (t.coachName || '').toLowerCase().includes(q));

  const box = $('#selList');
  box.innerHTML = '';

  if (!visible.length) {
    box.innerHTML = '<div class="empty">'
      + (selPool.length ? 'No team matches that search'
                        : 'No teams registered in this type and category')
      + '</div>';
  }

  visible.forEach(t => {
    const row = document.createElement('div');
    row.className = 'listrow pick' + (selPicked.includes(t) ? ' sel' : '');
    row.innerHTML = `<div class="grow">
        <div class="name">${selPicked.includes(t) ? '✅ ' : ''}${esc(t.teamName)}</div>
        <div class="meta">${t.players.length} players • Coach: ${esc(t.coachName)}</div>
      </div>`;

    row.onclick = () => {
      const i = selPicked.indexOf(t);
      if (i >= 0) selPicked.splice(i, 1);
      else if (selPicked.length < 2) selPicked.push(t);
      else { toast('Two teams already selected - tap one to remove it'); return; }
      applySelSearch();
    };

    box.appendChild(row);
  });

  // a picked team hidden by the search still counts, so say so
  let info;
  if (!selPicked.length) {
    info = 'Select 2 teams';
  } else {
    info = 'Selected: ' + selPicked.map(t => t.teamName).join('  vs  ');
    if (selPicked.length === 1) info += '   (pick 1 more)';
  }

  if (q) {
    const hidden = selPicked.filter(t => !visible.includes(t)).length;
    info += `\n${visible.length} of ${selPool.length} shown`;
    if (hidden) info += `   •   ${hidden} selected not shown`;
  }

  $('#selInfo').style.whiteSpace = 'pre-line';
  $('#selInfo').textContent = info;
}

$$('input[name=selType], input[name=selCat]').forEach(r => r.addEventListener('change', renderSelect));
$('#selSearch').addEventListener('input', applySelSearch);

$('#toTossBtn').onclick = () => {
  if (selPicked.length !== 2) { toast('Select exactly 2 teams'); return; }
  openToss(selPicked[0], selPicked[1]);
};

/* ============================================================
   TOSS
   ============================================================ */

let tossTeams = null;

function openToss(t1, t2) {
  tossTeams = [t1, t2];

  $('#tossDate').value = todayIso();

  // a fresh toss starts as a full match, whatever the last one was
  const full = $('input[name=matchKind][value=full]');
  if (full) full.checked = true;

  $('#tossTeams').textContent = t1.teamName + '   vs   ' + t2.teamName;

  $('#tossAttack').innerHTML = [t1, t2].map((t, i) =>
    `<label class="opt"><input type="radio" name="tossAtk" value="${i}"${i === 0 ? ' checked' : ''}>
     ${esc(t.teamName)}</label>`).join('');

  go('toss');
}

$$('input[name=dreamRun]').forEach(r => r.addEventListener('change', () => {
  $('#bonusField').style.display = $('input[name=dreamRun]:checked').value === '0' ? 'none' : '';
}));

$('#toPlayersBtn').onclick = () => {
  const iso = $('#tossDate').value;
  if (!iso) { toast('Pick a match date'); return; }

  const atkIndex = Number($('input[name=tossAtk]:checked').value);
  const minutes = Number($('input[name=halfTime]:checked').value);
  const dreamRun = Number($('input[name=dreamRun]:checked').value);

  if (dreamRun > 0 && dreamRun >= minutes) {
    toast(`Dream Run (${dreamRun} min) must be shorter than the ${minutes} min half`, 4000);
    return;
  }

  pendingSetup = {
    attacking: tossTeams[atkIndex],
    defending: tossTeams[1 - atkIndex],
    matchDate: isoToDisplay(iso),
    suddenDeath: ($('input[name=matchKind]:checked') || {}).value === 'sd',
    minutesPerHalf: minutes,
    attackPlayers: Number($('input[name=attackSize]:checked').value),
    wicketPoints: Number($('input[name=wicketPts]:checked').value),
    dreamRunMinutes: dreamRun,
    bonusIntervalSeconds: Number($('input[name=bonusEvery]:checked').value)
  };

  openPlayerSelection();
};

/* ============================================================
   PERMANENT SUBS
   ============================================================ */

let pendingSetup = null;
let perm1 = [], perm2 = [];

function openPlayerSelection() {
  perm1 = []; perm2 = [];

  $('#ps1Title').textContent = pendingSetup.attacking.teamName;
  $('#ps2Title').textContent = pendingSetup.defending.teamName;

  renderPermList('#ps1List', pendingSetup.attacking, perm1);
  renderPermList('#ps2List', pendingSetup.defending, perm2);

  go('players');
}

function renderPermList(sel, team, store) {
  const box = $(sel);
  box.innerHTML = '';

  team.players.forEach((name, i) => {
    const num = String(i + 1);

    const row = document.createElement('div');
    row.className = 'listrow pick' + (store.includes(num) ? ' sel' : '');
    row.innerHTML = `<div class="grow"><div class="name">${store.includes(num) ? '🔴 ' : ''}${num}. ${esc(name)}</div></div>`;

    row.onclick = () => {
      const at = store.indexOf(num);
      if (at >= 0) store.splice(at, 1);
      else if (store.length < 3) store.push(num);
      else { toast('Max 3 permanent subs'); return; }
      renderPermList(sel, team, store);
    };

    box.appendChild(row);
  });
}

$('#toScoringBtn').onclick = () => {
  const playing1 = pendingSetup.attacking.players.length - perm1.length;
  const playing2 = pendingSetup.defending.players.length - perm2.length;

  if (playing1 < 3 || playing2 < 3) {
    toast('Each team needs at least 3 players left after the permanent subs', 4000);
    return;
  }

  Scoring.start(pendingSetup, perm1.slice(), perm2.slice());
};

/* ============================================================
   DRAWS

   A draw is a tournament's bracket. For now it holds only what identifies it —
   the date, the side, the age group and the tournament name — and opens onto a
   screen of its own.
   ============================================================ */

/**
 * The days a tournament runs over. Draws saved when one date was all a draw could
 * hold still read correctly.
 */
function drawDates(draw) {
  if (Array.isArray(draw.dates) && draw.dates.length) return draw.dates;
  return draw.date ? [draw.date] : [];
}

/** "3 / 12 / 2026" and "03/12/2026" are the same day. */
function dateKey(value) {
  const parts = String(value == null ? '' : value).split('/').map(p => parseInt(p, 10));

  return parts.length === 3 && parts.every(n => !isNaN(n))
    ? parts.join('-')
    : String(value == null ? '' : value).trim();
}

/* Dates being collected on the New Draw form, before it is saved. */
let pendingDates = [];

function renderPendingDates() {
  const box = $('#drawDateList');
  box.innerHTML = '';

  if (!pendingDates.length) {
    box.innerHTML = '<span class="muted">No dates added yet</span>';
    return;
  }

  pendingDates.forEach((d, i) => {
    const chip = document.createElement('span');
    chip.className = 'datechip';
    chip.innerHTML = `${esc(d)} <b>✕</b>`;

    chip.querySelector('b').onclick = () => {
      pendingDates.splice(i, 1);
      renderPendingDates();
    };

    box.appendChild(chip);
  });
}

$('#addDateBtn').onclick = () => {
  const iso = $('#drawDate').value;
  if (!iso) { toast('Pick a date first'); return; }

  const shown = isoToDisplay(iso);

  if (pendingDates.some(d => dateKey(d) === dateKey(shown))) {
    toast('That date is already on the list');
    return;
  }

  pendingDates.push(shown);
  pendingDates.sort((a, b) => new Date(dateKey(a).split('-').reverse().join('-'))
    - new Date(dateKey(b).split('-').reverse().join('-')));

  $('#drawDate').value = '';
  renderPendingDates();
};

function renderDraws() {
  renderPendingDates();

  const all = Draws.all();
  const box = $('#drawList');

  $('#drawTotal').textContent = `${all.length} ${all.length === 1 ? 'tournament' : 'tournaments'}`;

  box.innerHTML = '';

  if (!all.length) {
    // nothing to list, so the form is the whole screen
    $('#newDrawCard').hidden = false;
    box.innerHTML = '<div class="card empty">No tournaments yet</div>';
    return;
  }

  const card = document.createElement('div');
  card.className = 'card tight';

  const today = todayKey();

  // newest first, the same way the score sheets are listed
  for (let i = all.length - 1; i >= 0; i--) {
    const d = all[i];
    const member = (typeof Room === 'undefined') ? null : Room.forDraw(d.id);
    const onToday = drawDates(d).map(dateKey).includes(today);

    const row = document.createElement('div');
    row.className = 'listrow';
    row.innerHTML = `
      <div class="grow pick">
        <div class="name">${esc(d.tournament)}</div>
        <div class="meta">${esc(drawDates(d).join(',  ') || 'No Date')} • ${esc(d.teamType)} ${esc(d.category)}</div>
      </div>`
      + (onToday ? '<span class="chip live">Today</span>' : '')
      + (member ? `<span class="chip next">${member.host ? 'Hosting' : 'Joined'}</span>` : '');

    row.querySelector('.grow').onclick = () => showDraw(d);

    const del = trashButton('Delete ' + (d.tournament || 'tournament'));
    del.onclick = async () => {
      if (await ask('Delete Draw', `Delete ${d.tournament}?`, { yes: 'Delete' }) !== 'yes') return;
      Draws.save(Draws.all().filter(x => x.id !== d.id));
      toast('Draw Deleted');
      renderDraws();
    };

    row.appendChild(del);
    card.appendChild(row);
  }

  box.appendChild(card);
}

$('#saveDrawBtn').onclick = () => {

  // a date left sitting in the picker is almost certainly meant to be included
  if ($('#drawDate').value) $('#addDateBtn').onclick();

  if (!pendingDates.length) { toast('Add at least one date'); return; }

  const name = $('#drawName').value.trim();
  if (!name) { toast('Enter the tournament name'); return; }

  const list = Draws.all();

  list.push({
    id: 'd' + Date.now() + Math.random().toString(36).slice(2, 7),
    dates: pendingDates.slice(),
    teamType: $('input[name=drawType]:checked').value,
    category: $('input[name=drawCat]:checked').value,
    tournament: name
  });

  Draws.save(list);

  pendingDates = [];
  $('#drawName').value = '';
  $('#drawDate').value = '';

  $('#newDrawCard').hidden = true;
  toast('Tournament saved');
  renderDraws();
};

$('#newDrawToggle').onclick = () => {
  const card = $('#newDrawCard');
  card.hidden = !card.hidden;
  if (!card.hidden) $('#drawName').focus();
};

/* ---------------- one draw: groups and the bracket ---------------- */

let openDrawId = null;

function showDraw(draw) {
  openDrawId = draw.id;

  // if this tournament is shared, pick the room back up so changes from the
  // other devices start arriving again
  reopenRoomFor(draw.id);
  renderDrawTabButtons(draw.id);

  $('#ddName').textContent = draw.tournament;
  $('#ddMeta').textContent =
    `${drawDates(draw).join(',  ')}   •   ${draw.teamType} ${draw.category}`;

  showDrawTab('groups');
  go('drawdetail');
}

/** The tabs on a tournament: which button, which panel, and what fills it. */
const DD_TABS = {
  groups:  ['#ddGroupsTab', '#ddGroupsView', () => renderGroups()],
  draw:    ['#ddDrawTab', '#ddDrawView', () => renderDrawTab()],
  days:    ['#ddDaysTab', '#ddDaysView', () => renderDays()],
  leaders: ['#ddLeadersTab', '#ddLeadersView', () => renderLeaders()],
  share:   ['#ddShareTab', '#ddShareView', () => renderShare()]
};

function showDrawTab(which) {
  ddTab = which;

  Object.entries(DD_TABS).forEach(([key, [tab, view]]) => {
    $(view).style.display = key === which ? '' : 'none';
    $(tab).className = key === which ? 'green' : 'grey';
  });

  DD_TABS[which][2]();
}

/** The teams ticked in each group, in group order. */
/**
 * The field: every team that is in this draw.
 *
 * Two ways in, because not every tournament has a group stage. A team can be
 * ticked through from a group, or picked straight from the registered list on
 * the Draw tab for a straight knockout. Either way it reaches the bracket the
 * same, and a team that arrives by both routes is still one team.
 */
function qualifiedTeams(draw) {

  const out = [];
  const seen = new Set();

  (draw.groups || []).forEach((g, gi) => {
    (g.teams || []).forEach(name => {
      if (!(g.qualified || []).includes(name)) return;
      if (seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      out.push({ group: groupName(gi), name });
    });
  });

  (draw.picked || []).forEach(name => {
    if (seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    out.push({ group: '', name });
  });

  return out;
}

/** The registered teams eligible for this draw: its own side and age group. */
function teamsForDraw(draw) {
  return Teams.all()
    .filter(t => (t.teamType || '') === draw.teamType
              && (t.category || '') === draw.category)
    .sort((a, b) => (a.teamName || '').localeCompare(b.teamName || ''));
}

/** Whether this device has joined somebody else's tournament. */
function isGuestDraw(drawId) {
  const m = Room.forDraw(drawId);
  return !!m && !m.host;
}

/**
 * The teams actually in this draw: placed in a group, picked straight in, or
 * already drawn in the bracket. A joined device sees only these. The teams
 * registered on that device are its own business and have nothing to do with
 * the host's tournament, so they must never appear here.
 */
function teamsInDraw(draw) {

  const names = new Set();

  qualifiedTeams(draw).forEach(t => names.add(t.name));
  (draw.groups || []).forEach(g => (g.teams || []).forEach(n => names.add(n)));

  (draw.bracket || []).forEach(tie => {
    if (tie.a) names.add(tie.a);
    if (tie.b) names.add(tie.b);
  });

  return [...names]
    .sort((a, b) => (a || '').localeCompare(b || ''))
    .map(name => ({ teamName: name }));
}

/** The group a team came through, if it came through one. */
function groupOf(draw, name) {

  const groups = draw.groups || [];

  for (let i = 0; i < groups.length; i++) {
    if ((groups[i].qualified || []).includes(name)) return groupName(i);
  }

  return '';
}

/** Whether a team has already been drawn against somebody. */
function isPaired(draw, name) {
  return (draw.bracket || []).some(t => sameName(t.a, name) || sameName(t.b, name));
}

/**
 * Picking teams straight into the draw, for a tournament with no group stage.
 * Same tick box and same row as a group, so the two read alike.
 */
function teamPickCard(draw) {

  const card = document.createElement('div');
  card.className = 'card';

  const guest = isGuestDraw(draw.id);

  // Once there are groups, the field is settled on the Groups tab: the Draw
  // shows the teams that came through and nobody else. With no groups the
  // teams are picked straight in here, so the whole register is offered.
  const grouped = (draw.groups || []).some(g => (g.teams || []).length);

  const registered = grouped
    ? qualifiedTeams(draw).map(t => ({ teamName: t.name }))
    : (guest ? teamsInDraw(draw) : teamsForDraw(draw));

  card.innerHTML = `<h2>Teams in this draw</h2>`;

  if (!registered.length) {
    card.insertAdjacentHTML('beforeend',
      grouped
        ? `<div class="empty">No team has come through yet - tick them through `
          + `on the Groups tab</div>`
        : guest
          ? `<div class="empty">The host has not put any teams in this draw yet</div>`
          : `<div class="empty">No ${esc(draw.teamType)} ${esc(draw.category)} teams `
            + `are registered yet</div>`);
    return card;
  }

  registered.forEach(team => {

    const name = team.teamName;
    const from = groupOf(draw, name);
    const wins = winsFor(draw, name);

    const row = document.createElement('div');
    row.className = 'listrow';

    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.className = 'qual';
    tick.checked = !!from || (draw.picked || []).includes(name);

    // a team that came through a group is managed on the Groups tab, not here,
    // a joined device changes nothing at all, and once there are groups this
    // list is a record of who came through rather than something to edit
    tick.disabled = !!from || guest || grouped;
    tick.title = from ? 'Came through ' + from : 'In the draw';

    tick.onchange = () => {

      const d = openDraw();
      if (!d) return;

      if (!tick.checked && isPaired(d, name)) {
        tick.checked = true;
        toast('Remove the tie on the Draw first', 3500);
        return;
      }

      const on = new Set(d.picked || []);

      if (tick.checked) on.add(name); else on.delete(name);

      d.picked = [...on];

      if (saveOpenDraw(d)) renderDrawTab();
      else tick.checked = !tick.checked;
    };

    row.appendChild(tick);

    row.insertAdjacentHTML('beforeend',
      `<div class="grow">${esc(name)}`
      + (from ? ` <span class="muted">${esc(from)}</span>` : '')
      + `</div>`
      + (wins ? `<span class="wins" title="Matches won">${wins}</span>` : ''));

    card.appendChild(row);
  });

  return card;
}

/* ---------------- the knockout bracket ---------------- */

const sameName = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

/**
 * The result that settles a tie, taken from the score sheets: the latest match
 * between the two, on one of the tournament's days and in its own side and age
 * group. Null while they have not played.
 */
function matchBetween(draw, a, b) {
  const days = new Set(drawDates(draw).map(dateKey));

  const played = Matches.all().filter(m =>
    days.has(dateKey(m.date))
    && (m.teamType || 'Men') === draw.teamType
    && (m.category || 'Open') === draw.category
    && !isDraw(m)
    && ((sameName(m.team1Name, a) && sameName(m.team2Name, b))
      || (sameName(m.team1Name, b) && sameName(m.team2Name, a))));

  return played.length ? played[played.length - 1] : null;
}

/**
 * Who goes through from one tie: the bye, the winner, or nobody yet.
 *
 * A score sheet on this device settles it. Failing that, the result the host
 * stamped onto the draw does - which is what lets a joined device show a
 * correct bracket without holding every other device's score sheets.
 */
function tieWinner(draw, tie) {
  if (!tie.b) return tie.a;                       // a bye walks through

  const m = matchBetween(draw, tie.a, tie.b);
  if (m) return m.winner;

  return tie.winner || null;
}

/**
 * Writes each decided tie's result onto the draw itself.
 *
 * Only the device that owns the draw does this, because the draw is its to
 * change. It is what carries results out to everybody: the sheets go up to the
 * host, the host settles the ties, and the draw - one small record - goes back
 * out to every device. Nobody else needs anybody else's score sheets to see a
 * correct bracket.
 */
function stampDrawResults(drawId) {

  const draw = Draws.byId(drawId);
  if (!draw || !Room.canEdit(drawId)) return false;

  let changed = false;

  (draw.bracket || []).forEach(tie => {

    if (!tie.b) return;

    const m = matchBetween(draw, tie.a, tie.b);
    const won = m ? m.winner : null;

    if (won) {
      if (tie.winner !== won) { tie.winner = won; changed = true; }

    } else if (tie.winner) {
      // the sheet that settled this has gone, so the tie is open again
      delete tie.winner;
      changed = true;
    }
  });

  if (!changed) return false;

  const list = Draws.all();
  const i = list.findIndex(d => d.id === draw.id);

  if (i < 0) return false;

  list[i] = draw;
  Draws.save(list);        // which sends the draw up to everybody

  return true;
}

/** The same for every tournament this device is sharing. */
function stampSharedDraws() {
  let any = false;
  Object.keys(DB.read('rooms', {})).forEach(id => {
    try { if (stampDrawResults(id)) any = true; } catch (e) {}
  });
  return any;
}

/**
 * Every round. The first is the one the referee made by hand; each round after
 * is paired from the winners in order, so the top two meet, then the next two,
 * and an odd team left over takes a bye.
 */
function bracketRounds(draw) {
  const rounds = [];

  let ties = (draw.bracket || []).slice();
  if (!ties.length) return rounds;

  rounds.push(ties);

  for (let guard = 0; guard < 12; guard++) {

    const winners = ties.map(t => tieWinner(draw, t));

    if (winners.some(w => !w)) break;             // this round is still being played
    if (winners.length <= 1) break;               // somebody has won the thing

    const next = [];
    for (let i = 0; i < winners.length; i += 2) {
      next.push({ a: winners[i], b: winners[i + 1] || null });
    }

    rounds.push(next);
    ties = next;
  }

  return rounds;
}

/**
 * Named by how many teams are in it, which is how a tournament reads. While the
 * first round is still being built, `teamsOverride` keeps it named for the whole
 * field rather than the handful paired up so far.
 */
function roundTitle(ties, index, teamsOverride) {
  const teams = teamsOverride != null
    ? teamsOverride
    : ties.reduce((n, t) => n + (t.b ? 2 : 1), 0);

  if (teams <= 2) return 'Final';
  if (teams <= 4) return 'Semi Final';
  if (teams <= 8) return 'Quarter Final';
  if (teams <= 16) return 'Pre-Quarter';

  return 'Round ' + (index + 1);
}

/**
 * Draw numbers.
 *
 * The first round fixes them: 1, 2, 3 ... in the order the referee pairs the
 * teams up, so the sheet reads 1 vs 2, then 3 vs 4. A team keeps its number for
 * the whole tournament, so the quarter final reads "1. Mumbai vs 4. Thane" and
 * anyone can follow a side through the rounds by its number alone.
 */
function drawNumbers(draw) {
  const numbers = new Map();
  let next = 0;

  (draw.bracket || []).forEach(tie => {
    if (tie.a && !numbers.has(tie.a)) numbers.set(tie.a, ++next);
    if (tie.b && !numbers.has(tie.b)) numbers.set(tie.b, ++next);
  });

  return numbers;
}

/**
 * "1. Mumbai", or the bare name while a team is still waiting to be paired and
 * has no number yet. Escaped, so it can go straight into the page.
 */
function numbered(numbers, name) {
  const n = numbers.get(name);
  return (n ? `<span class="seed">${n}</span>` : '') + esc(name);
}

/** The team picked first while building a tie, if any. */
let pairPick = null;

function renderDrawTab() {
  const draw = openDraw();
  const box = $('#ddDrawView');

  box.innerHTML = '';
  if (!draw) return;

  const through = qualifiedTeams(draw).map(t => t.name);

  // the field is picked here, so this card comes first whether or not any team
  // is in it yet
  box.appendChild(teamPickCard(draw));

  if (!through.length) return;

  // anyone not yet placed in a tie
  const placed = new Set();
  (draw.bracket || []).forEach(t => { placed.add(t.a); if (t.b) placed.add(t.b); });

  const waiting = through.filter(n => !placed.has(n));

  // Later rounds and a champion only make sense once the whole field is drawn.
  // Half a first round would otherwise crown whoever happened to get a bye.
  const rounds = waiting.length ? [(draw.bracket || [])] : bracketRounds(draw);

  const numbers = drawNumbers(draw);

  rounds.forEach((ties, r) => {
    if (!ties.length) return;
    box.appendChild(roundCard(draw, ties, r, r === 0 ? through.length : null, numbers));
  });

  if (waiting.length) {
    box.appendChild(pairingCard(draw, waiting));
    return;
  }

  // the champion, once the last round has one winner left
  const last = rounds[rounds.length - 1];

  if (last && last.length === 1) {
    const champion = tieWinner(draw, last[0]);

    if (champion) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<h2>Champion</h2>`
        + `<div class="listrow"><div class="grow">`
        + `<div class="name">${numbered(numbers, champion)}</div></div></div>`;
      box.appendChild(card);
    }
  }
}

function roundCard(draw, ties, index, teamsOverride, numbers) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>${roundTitle(ties, index, teamsOverride)}</h2>`;

  ties.forEach((tie, ti) => {
    const won = tieWinner(draw, tie);
    const m = tie.b ? matchBetween(draw, tie.a, tie.b) : null;

    const row = document.createElement('div');
    row.className = 'tie';

    const side = (name, right) => {
      const isWinner = won && sameName(won, name);
      return `<div class="side${right ? ' right' : ''}">`
        + `<span class="crest">${esc(teamCode(name))}</span>`
        + `<span class="nm${isWinner ? ' won' : ''}">${numbered(numbers, name)}</span></div>`;
    };

    let middle = '<span class="sep">v</span>';

    if (m) {
      // the score in the tie's own order, whichever side the sheet put first
      const aFirst = sameName(m.team1Name, tie.a);
      middle = `<span class="num">${aFirst ? m.team1Score : m.team2Score}</span>`
        + `<span class="sep">&ndash;</span>`
        + `<span class="num">${aFirst ? m.team2Score : m.team1Score}</span>`;
    }

    const status = !tie.b
      ? '<span class="chip">Bye</span>'
      : won
        ? `<span class="chip done">${esc(won)} through</span>`
        : '<span class="chip next">To play</span>';

    row.innerHTML = `<div class="scoreline">${side(tie.a, false)}`
      + (tie.b ? middle + side(tie.b, true) : '') + `</div>`
      + `<div class="statusline">${status}<span class="spacer"></span></div>`;

    // a tie that has been played opens its score sheet
    if (m) {
      const t = row.querySelector('.scoreline');
      t.style.cursor = 'pointer';
      t.title = 'Open the score sheet';
      t.onclick = () => showDetail(m, Matches.all().findIndex(x => x.id === m.id));
    }

    // only the round the referee made by hand can be unpicked
    if (index === 0) {
      const undo = document.createElement('button');
      undo.className = 'iconbtn danger';
      undo.title = 'Take this tie out';
      undo.setAttribute('aria-label', 'Take this tie out');
      undo.innerHTML = '<svg><use href="#i-x"/></svg>';
      undo.onclick = () => {
        const d = openDraw();
        if (!d) return;

        d.bracket.splice(ti, 1);
        if (saveOpenDraw(d)) renderDrawTab();
      };
      row.querySelector('.statusline').appendChild(undo);
    }

    card.appendChild(row);
  });

  return card;
}

function pairingCard(draw, waiting) {
  const card = document.createElement('div');
  card.className = 'card';

  card.innerHTML = `<h2>Teams to pair</h2>`;

  waiting.forEach(name => {
    const row = document.createElement('div');
    row.className = 'listrow';

    const pick = document.createElement('div');
    pick.className = 'grow pick';
    pick.innerHTML = `<div class="name">${esc(name)}</div>`;

    if (pairPick === name) pick.classList.add('picked');

    pick.onclick = () => {
      if (pairPick === name) { pairPick = null; renderDrawTab(); return; }

      if (!pairPick) { pairPick = name; renderDrawTab(); return; }

      const d = openDraw();
      if (!d) return;

      d.bracket = (d.bracket || []).concat({ a: pairPick, b: name });
      pairPick = null;

      if (saveOpenDraw(d)) renderDrawTab();
    };

    const bye = document.createElement('button');
    bye.className = 'grey';
    bye.textContent = 'Bye';
    bye.onclick = () => {
      const d = openDraw();
      if (!d) return;

      d.bracket = (d.bracket || []).concat({ a: name, b: null });
      pairPick = null;

      if (saveOpenDraw(d)) renderDrawTab();
    };

    row.appendChild(pick);
    row.appendChild(bye);
    card.appendChild(row);
  });

  return card;
}

$('#ddGroupsTab').onclick = () => showDrawTab('groups');
$('#ddDrawTab').onclick = () => showDrawTab('draw');
$('#ddDaysTab').onclick = () => showDrawTab('days');
$('#ddLeadersTab').onclick = () => showDrawTab('leaders');

/* ---------------- the tournament, day by day ---------------- */

/**
 * Each of the tournament's days with the matches scored on it, and the ties
 * still waiting for a result. The app never schedules a tie to a day, so they
 * are shown once, on today if the tournament is on today, otherwise on its next
 * day - nothing is invented about when they will be played.
 */
function renderDays() {
  const draw = openDraw();
  const box = $('#ddDaysView');

  box.innerHTML = '';
  if (!draw) return;

  const keys = drawDates(draw).map(dateKey);
  const today = todayKey();
  const now = keyTime(today);

  const sheets = [];
  Matches.all().forEach((m, i) => {
    if ((m.teamType || 'Men') !== draw.teamType || (m.category || 'Open') !== draw.category) return;
    const k = dateKey(m.date);
    if (keys.includes(k)) sheets.push({ m, i, k });
  });

  const toPlay = (draw.bracket || []).filter(tie => tie.b && !tieWinner(draw, tie));

  const ordered = keys.slice().sort((a, b) => (keyTime(a) || 0) - (keyTime(b) || 0));

  const playDay = ordered.includes(today) ? today
    : ordered.find(k => keyTime(k) > now) || null;

  if (!ordered.length) {
    box.innerHTML = '<div class="card empty">This tournament has no dates</div>';
    return;
  }

  ordered.forEach(k => {
    const day = document.createElement('div');
    day.className = 'day';

    const [d, mon] = dayLabel(k).split(' ');
    day.innerHTML = `<div class="daymark${k === today ? ' today' : ''}">`
      + `<div class="d">${esc(d)}</div><div class="m">${esc(mon || '')}</div></div>`;

    const card = document.createElement('div');
    card.className = 'card tight';

    if (k === playDay) {
      toPlay.forEach(tie => card.appendChild(infoRow(
        `${esc(tie.a)} v ${esc(tie.b)}`, 'Still to play',
        '<span class="chip next">To play</span>', () => showDrawTab('draw'))));
    }

    sheets.filter(s => s.k === k).forEach(({ m, i }) => {
      card.appendChild(infoRow(
        `${esc(m.team1Name)} v ${esc(m.team2Name)}`,
        (isDraw(m) ? 'Draw' : 'won by ' + esc(m.winner))
          + (wentToSuddenDeath(m) ? ' &middot; sudden death' : ''),
        `<span class="score">${m.team1Score}&ndash;${m.team2Score}</span>`,
        () => showDetail(m, i)));
    });

    if (!card.children.length) {
      const past = keyTime(k) < now;
      card.innerHTML = `<div class="empty">${past ? 'No score sheets from this day' : 'Nothing yet'}</div>`;
    }

    day.appendChild(card);
    box.appendChild(day);
  });

  // a tournament that has finished its days with ties still open
  if (!playDay && toPlay.length) {
    box.insertAdjacentHTML('beforeend', '<p class="eyebrow">Still to play</p>');
    const card = document.createElement('div');
    card.className = 'card tight';
    toPlay.forEach(tie => card.appendChild(infoRow(
      `${esc(tie.a)} v ${esc(tie.b)}`, '', '<span class="chip next">To play</span>',
      () => showDrawTab('draw'))));
    box.appendChild(card);
  }
}

/* ---------------- the tournament's leaders ---------------- */

let leadersBy = 'wickets';

/**
 * Attackers ranked by what the score sheets already hold: wickets taken, and how
 * many of them were dives. Nothing extra is entered and nothing is estimated -
 * these are counts. A jersey is only ever compared within its own team, since 5
 * on one side is a different player from 5 on the other.
 */
function renderLeaders() {
  const draw = openDraw();
  const box = $('#ddLeadersView');

  box.innerHTML = '';
  if (!draw) return;

  const keys = new Set(drawDates(draw).map(dateKey));
  const stats = new Map();
  let sheetsCounted = 0;

  Matches.all().forEach(m => {
    if (!keys.has(dateKey(m.date))) return;
    if ((m.teamType || 'Men') !== draw.teamType || (m.category || 'Open') !== draw.category) return;

    sheetsCounted++;

    sheetRows(m).forEach(r => {
      if (r.notOut || !r.attNo) return;

      const team = wasTeam1Attacking(m, r.halfIndex) ? m.team1Name : m.team2Name;
      const key = String(team).toLowerCase() + '|' + r.attNo;

      const s = stats.get(key)
        || { team, jersey: r.attNo, name: '', wickets: 0, dives: 0, games: new Set() };

      s.wickets++;
      if (r.type === 'Pole Dive' || r.type === 'Sky Dive') s.dives++;
      if (!s.name && r.attName) s.name = r.attName;
      s.games.add(m.id || (m.team1Name + m.team2Name + m.date));

      stats.set(key, s);
    });
  });

  const strip = document.createElement('div');
  strip.className = 'strip';
  [['wickets', 'Wickets'], ['dives', 'Dives']].forEach(([key, label]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.setAttribute('aria-pressed', String(leadersBy === key));
    b.onclick = () => { leadersBy = key; renderLeaders(); };
    strip.appendChild(b);
  });
  box.appendChild(strip);

  if (!stats.size) {
    box.insertAdjacentHTML('beforeend',
      '<div class="card empty">No wickets recorded in this tournament yet. '
      + 'Leaders appear as score sheets come in.</div>');
    return;
  }

  const other = leadersBy === 'wickets' ? 'dives' : 'wickets';
  const list = [...stats.values()]
    .filter(s => s[leadersBy] > 0)
    .sort((a, b) => b[leadersBy] - a[leadersBy] || b[other] - a[other]
      || (a.name || a.jersey).localeCompare(b.name || b.jersey))
    .slice(0, 10);

  const card = document.createElement('div');
  card.className = 'card tight';

  if (!list.length) {
    card.innerHTML = '<div class="empty">No dives recorded in this tournament yet</div>';
  }

  list.forEach((s, i) => {
    const games = s.games.size;
    const row = document.createElement('div');
    row.className = 'listrow';
    row.innerHTML = `<span class="rank">${i + 1}</span>`
      + `<div class="grow"><div class="name">${esc(s.name || 'Jersey ' + s.jersey)}</div>`
      + `<div class="meta">${esc(s.team)} &middot; jersey ${esc(s.jersey)} &middot; `
      + `${s.wickets} ${s.wickets === 1 ? 'wicket' : 'wickets'}, ${s.dives} `
      + `${s.dives === 1 ? 'dive' : 'dives'} in ${games} ${games === 1 ? 'match' : 'matches'}</div></div>`
      + `<span class="score">${s[leadersBy]}</span>`;
    card.appendChild(row);
  });

  box.appendChild(card);
  box.insertAdjacentHTML('beforeend',
    `<p class="muted" style="margin:0 4px">Counted from the ${sheetsCounted} score `
    + `${sheetsCounted === 1 ? 'sheet' : 'sheets'} on this phone for this tournament.</p>`);
}

/** The draw being looked at, read fresh so edits are never made to a stale copy. */
function openDraw() {
  return Draws.byId(openDrawId);
}

/**
 * Writes a change back to the stored list.
 *
 * Every edit to a draw - adding a group, ticking a team through, pairing a tie,
 * giving a bye - passes through here, which makes it the one place to say that a
 * shared tournament belongs to its host. The server refuses such writes anyway;
 * this is so a joined scorer is told plainly instead of watching nothing happen.
 */
function saveOpenDraw(draw) {

  if (!Room.canEdit(draw.id)) {
    toast('Only the host can change this tournament', 3500);
    return false;
  }

  const list = Draws.all();
  const i = list.findIndex(d => d.id === draw.id);

  if (i === -1) { toast('That draw is no longer saved', 3500); return false; }

  list[i] = draw;
  Draws.save(list);
  return true;
}

/** Group A, Group B, … by position, so removing one renames the rest. */
const groupName = i => 'Group ' + String.fromCharCode(65 + i);

/**
 * How many matches a team won during this tournament: only matches played on one
 * of the draw's own dates, and only in its own side and age group. A result from
 * another day, another category or last season's cup is somebody else's. Drawn
 * matches count for nobody.
 */
function winsFor(draw, teamName) {
  const name = (teamName || '').toLowerCase();
  const days = new Set(drawDates(draw).map(dateKey));

  return Matches.all().filter(m =>
    days.has(dateKey(m.date))
    && (m.teamType || 'Men') === draw.teamType
    && (m.category || 'Open') === draw.category
    && !isDraw(m)
    && (m.winner || '').toLowerCase() === name
  ).length;
}

$('#ddAddGroupBtn').onclick = () => {
  const draw = openDraw();
  if (!draw) return;

  draw.groups = draw.groups || [];

  if (draw.groups.length >= 26) { toast('That is as many groups as the letters allow'); return; }

  draw.groups.push({ teams: [] });

  if (saveOpenDraw(draw)) renderGroups();
};

function renderGroups() {
  const draw = openDraw();
  const box = $('#ddGroups');

  box.innerHTML = '';
  if (!draw) return;

  const groups = draw.groups || [];

  if (!groups.length) {
    box.innerHTML = '<div class="card empty">No groups yet — add one to start placing teams</div>';
    return;
  }

  // only this draw's own side and age group, and only teams not already placed.
  // A joined device gets nothing to pick from: it may see the teams the host
  // put in the tournament, never the ones registered on it.
  const guest = isGuestDraw(draw.id);

  const eligible = guest ? [] : Teams.all().filter(t =>
    (t.teamType || 'Men') === draw.teamType && (t.category || 'Open') === draw.category);

  const placed = new Set();
  groups.forEach(g => (g.teams || []).forEach(n => placed.add(n)));

  groups.forEach((group, gi) =>
    box.appendChild(groupCard(draw, group, gi, eligible, placed, guest)));
}

/**
 * Played, won and lost for a team across the tournament's days, in its side and
 * age group - the same matches the wins count has always used.
 */
function recordFor(draw, teamName) {
  const days = new Set(drawDates(draw).map(dateKey));
  const r = { p: 0, w: 0, l: 0 };

  Matches.all().forEach(m => {
    if (!days.has(dateKey(m.date))) return;
    if ((m.teamType || 'Men') !== draw.teamType || (m.category || 'Open') !== draw.category) return;
    if (!sameName(m.team1Name, teamName) && !sameName(m.team2Name, teamName)) return;

    r.p++;
    if (isDraw(m)) return;
    if (sameName(m.winner, teamName)) r.w++; else r.l++;
  });

  return r;
}

function groupCard(draw, group, gi, eligible, placed, guest) {
  const card = document.createElement('div');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'grouphead';
  head.innerHTML = `<h2>${groupName(gi)}</h2>`
    + ((group.teams || []).length
      ? '<div class="colhead" aria-hidden="true"><span>P</span><span>W</span><span>L</span></div>'
      : '');

  const kill = trashButton('Delete ' + groupName(gi));
  kill.onclick = async () => {
    if (await ask('Delete Group', `Delete ${groupName(gi)}?`, { yes: 'Delete' }) !== 'yes') return;

    const d = openDraw();
    if (!d) return;

    d.groups.splice(gi, 1);
    if (saveOpenDraw(d)) { toast('Group deleted'); renderGroups(); }
  };

  head.appendChild(kill);
  card.appendChild(head);

  // teams already in this group
  (group.teams || []).forEach(name => {
    const row = document.createElement('div');
    row.className = 'listrow';

    const rec = recordFor(draw, name);

    // ticking a team sends it through to the draw
    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.className = 'qual';
    tick.title = 'Goes through to the draw';
    tick.checked = (group.qualified || []).includes(name);

    tick.onchange = () => {
      const d = openDraw();
      if (!d) return;

      const g = d.groups[gi];
      const on = new Set(g.qualified || []);

      if (tick.checked) on.add(name); else on.delete(name);

      g.qualified = [...on];
      if (saveOpenDraw(d)) renderGroups();
    };

    row.appendChild(tick);

    // played, won and lost sit out on the right, away from the name; won is the
    // number a referee scans a group for, so it is the loud one
    row.insertAdjacentHTML('beforeend',
      `<div class="grow${tick.checked ? ' through' : ''}">${esc(name)}</div>`
      + `<div class="pwl" title="Played ${rec.p}, won ${rec.w}, lost ${rec.l}">`
      + `<span>${rec.p}</span><span class="${rec.w ? 'w' : ''}">${rec.w}</span><span>${rec.l}</span></div>`);

    const out = document.createElement('button');
    out.className = 'iconbtn danger';
    out.title = 'Take ' + name + ' out of the group';
    out.setAttribute('aria-label', 'Take ' + name + ' out of the group');
    out.innerHTML = '<svg><use href="#i-x"/></svg>';
    out.onclick = () => {
      const d = openDraw();
      if (!d) return;

      // a team taken out of the group must not stay in the draw
      d.groups[gi].teams = d.groups[gi].teams.filter(n => n !== name);
      d.groups[gi].qualified = (d.groups[gi].qualified || []).filter(n => n !== name);

      if (saveOpenDraw(d)) renderGroups();
    };

    row.appendChild(out);
    card.appendChild(row);
  });

  // a joined device stops here: no picker, and no "none registered" notice,
  // because the teams on it are not part of this tournament
  if (guest) return card;

  // what is left to pick from
  const free = eligible.filter(t => !placed.has(t.teamName));

  if (!eligible.length) {
    const none = document.createElement('div');
    none.className = 'empty';
    none.textContent = `No ${draw.teamType} ${draw.category} teams are registered yet`;
    card.appendChild(none);
    return card;
  }

  // nothing left to pick: the group simply shows what it holds, with no dropdown
  if (!free.length) return card;

  const picker = document.createElement('div');
  picker.className = 'field';
  picker.style.marginTop = '10px';

  const select = document.createElement('select');
  select.innerHTML = '<option value="">Select a team…</option>'
    + free.map(t => `<option value="${esc(t.teamName)}">${esc(t.teamName)}</option>`).join('');

  // picking from the list is the whole action; no separate Add button to forget
  select.onchange = () => {
    const name = select.value;
    if (!name) return;

    const d = openDraw();
    if (!d) return;

    d.groups[gi].teams = (d.groups[gi].teams || []).concat(name);
    if (saveOpenDraw(d)) renderGroups();
  };

  picker.appendChild(select);
  card.appendChild(picker);

  return card;
}

/* ============================================================
   SCORE SHEETS
   ============================================================ */

function renderSheets() {
  const all = Matches.all();
  const q = $('#sheetSearch').value.trim().toLowerCase();

  const hit = m => !q || [m.team1Name, m.team2Name, m.date, m.winner, m.category]
    .some(v => v && String(v).toLowerCase().includes(q));

  const box = $('#sheetList');
  box.innerHTML = '';

  const groups = new Map();
  let shown = 0;

  for (let i = all.length - 1; i >= 0; i--) {   // newest first
    const m = all[i];
    if (!hit(m)) continue;
    m.__index = i;                      // position in the stored list, used when editing
    const d = m.date || 'No Date';
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(m);
    shown++;
  }

  $('#sheetTotal').textContent = q
    ? `Showing ${shown} of ${all.length}`
    : `${all.length} score ${all.length === 1 ? 'sheet' : 'sheets'}`;

  renderSyncStrip('#sheetSync');

  if (!shown) {
    box.innerHTML = `<div class="card empty">${all.length
      ? 'No match found for "' + esc($('#sheetSearch').value) + '"'
      : 'No matches saved yet'}</div>`;
    return;
  }

  groups.forEach((list, date) => {
    box.insertAdjacentHTML('beforeend', `<p class="eyebrow">${esc(date)}</p>`);

    const card = document.createElement('div');
    card.className = 'card tight';

    list.forEach(m => {
      const draw = isDraw(m);
      const row = document.createElement('div');
      row.className = 'listrow';
      row.innerHTML = `<div class="grow pick">
          <div class="name">${esc(m.team1Name)} v ${esc(m.team2Name)}</div>
          <div class="meta">${esc((m.teamType || 'Men') + ' ' + (m.category || 'Open'))} • `
        + `${draw ? 'Draw' : 'won by ' + esc(m.winner)}`
        + `${wentToSuddenDeath(m) ? ' • sudden death' : ''}</div>
        </div>
        <span class="score">${m.team1Score}&ndash;${m.team2Score}</span>`;

      row.querySelector('.grow').onclick = () => showDetail(m, m.__index);

      const del = trashButton(`Delete ${m.team1Name} v ${m.team2Name}`);
      del.onclick = async () => {
        if (await ask('Delete Match', `Delete ${m.team1Name} vs ${m.team2Name}?`, { yes: 'Delete' }) !== 'yes') return;
        const l = Matches.all();

        // by its tag, so a list that has shifted cannot delete the wrong sheet
        const idx = m.id
          ? l.findIndex(x => x.id === m.id)
          : (typeof m.__index === 'number' ? m.__index : -1);

        if (idx >= 0 && idx < l.length) { l.splice(idx, 1); Matches.save(l); }
        toast('Match Deleted');
        renderSheets();
      };
      row.appendChild(del);

      card.appendChild(row);
    });

    box.appendChild(card);
  });
}

$('#sheetSearch').addEventListener('input', renderSheets);

function isDraw(m) {
  return m.winner !== m.team1Name && m.winner !== m.team2Name;
}

/* ============================================================
   SHARE ACROSS DEVICES
   ============================================================ */

/**
 * The sign-in screen.
 *
 * Signing in is the host's own convenience, never a gate: every other screen
 * works the same whether this one has been visited or not.
 */
function renderAccount() {

  // an anonymous identity is how a scorer joins a room; it is not being signed in
  const signedIn = Cloud.isHost();

  $('#acSignedOut').style.display = signedIn ? 'none' : '';
  $('#acSignedIn').style.display = signedIn ? '' : 'none';
  $('#acEmail').textContent = Cloud.email() || 'Signed in';

  renderRoomList();
}

/**
 * The tournaments this device is sharing or has joined.
 *
 * Only a host sees a code here. A device that joined with one must never be
 * shown it again anywhere, or it could pass it on to somebody the host never
 * invited.
 */
function renderRoomList() {

  const box = $('#acRoomList');
  const rows = [];

  Draws.all().forEach(d => {
    const m = Room.forDraw(d.id);
    if (m) rows.push({ draw: d, member: m });
  });

  $('#acRooms').style.display = rows.length ? '' : 'none';
  if (!rows.length) return;

  box.innerHTML = '';

  rows.forEach(({ draw, member }) => {

    const row = document.createElement('div');
    row.className = 'listrow';

    row.innerHTML = `<div class="grow">`
      + `<div class="name">${esc(draw.tournament || 'Tournament')}</div>`
      + `<div class="meta">${esc(draw.teamType)} ${esc(draw.category)} &nbsp;•&nbsp; `
      + `${member.host
            ? 'Hosting &nbsp;•&nbsp; ' + esc(member.code)
            : 'Joined'}</div>`
      + `</div>`;

    const open = document.createElement('button');
    open.className = 'grey';
    open.textContent = 'Open';
    open.onclick = () => showDraw(draw);

    row.appendChild(open);
    box.appendChild(row);
  });
}

Cloud.watch(() => { if (current === 'account') renderAccount(); });

$('#acSignInBtn').onclick = async () => {

  const btn = $('#acSignInBtn');

  btn.disabled = true;
  btn.textContent = 'Opening Google…';

  try {
    const done = await Cloud.signIn();
    if (done) toast('Signed in as ' + Cloud.email());

  } catch (e) {

    const code = (e && e.code) || '';

    if (code === 'auth/network-request-failed') {
      toast('No connection. Signing in needs internet - everything else does not.', 4500);
    } else if (code === 'auth/unauthorized-domain') {
      toast('This address is not on the Firebase allowed list yet', 5000);
    } else {
      toast('Could not sign in. Please try again.', 4000);
    }

  } finally {
    btn.disabled = false;
    btn.textContent = 'Continue with Google';
    renderAccount();
  }
};

$('#acSignOutBtn').onclick = async () => {

  const answer = await ask('Sign out?',
    'Your teams, score sheets and draws stay on this device. Sign in again any '
    + 'time to host from another one.', { yes: 'Sign out', no: 'Stay signed in' });

  if (answer !== 'yes') return;

  try {
    await Cloud.signOut();
    toast('Signed out');
  } catch (e) {
    toast('Could not sign out - check your connection', 4000);
  }

  renderAccount();
};

// brings back a signed-in host at startup, and costs nothing on a device that
// has never signed in
Cloud.restore();

/* ============================================================
   SHARING A TOURNAMENT
   ============================================================ */

/** Which of the three tabs on a draw is showing. */
let ddTab = 'groups';

function showShareTab() {
  showDrawTab('share');
}

$('#ddShareTab').onclick = showShareTab;

$('#ddLeaveTab').onclick = async () => {

  const answer = await ask('Leave this tournament?',
    'It is removed from this device, along with its score sheets and the teams '
    + 'playing in it. The host keeps all of it. Your own teams and your other '
    + 'tournaments are not touched.',
    { yes: 'Leave', no: 'Stay' });

  if (answer !== 'yes') return;

  await Room.leave(openDrawId);

  openDrawId = null;
  toast('Left the tournament');
  go('draws');

  renderDraws();
  renderSheets();
  renderTeams();
};

function renderShare() {

  const draw = openDraw();
  if (!draw) return;

  const member = Room.forDraw(draw.id);
  const hosting = member && member.host;

  $('#shStart').style.display = member ? 'none' : '';
  $('#shHost').style.display = hosting ? '' : 'none';

  if (!member) {
    const canHost = Cloud.isHost();
    $('#shCreateBtn').style.display = canHost ? '' : 'none';
    $('#shNeedSignIn').style.display = canHost ? 'none' : '';
    return;
  }

  if (hosting) {
    $('#shCode').textContent = member.code;
    drawQr($('#shQr'), joinLink(member.code));
  }
}

/**
 * The code belongs to the host. A device that joined with one is only passing
 * through, so it gets no Share tab and is never shown the code again - just a
 * way out.
 */
function renderDrawTabButtons(drawId) {

  const member = Room.forDraw(drawId);
  const guest = !!member && !member.host;

  $('#ddShareTab').style.display = guest ? 'none' : '';
  $('#ddLeaveTab').style.display = guest ? '' : 'none';

  if (!guest) return;

  // Wipe the host panel rather than merely hiding it. This device may have
  // hosted something before, and a code left sitting in the page is a code that
  // can still be found.
  $('#ddShareView').style.display = 'none';
  $('#shStart').style.display = 'none';
  $('#shHost').style.display = 'none';
  $('#shCode').textContent = '';
  $('#shQr').innerHTML = '';
  $('#shQr').hidden = true;
}

/**
 * Fetches every device's sheets for the shared tournaments now, and sends up
 * anything of ours that has not gone. Wired to the Refresh buttons and to the
 * pull-down, because a scorer who has just finished a match wants to see the
 * other court's result this minute, not whenever the listener notices.
 */
let refreshing = false;

async function syncNow(quiet) {

  if (refreshing) return;

  const rooms = Object.keys(DB.read('rooms', {}));

  if (!rooms.length) {
    if (!quiet) toast('This tournament is not shared with any other device');
    return;
  }

  refreshing = true;
  setRefreshBusy(true);

  try {
    const changed = await Room.refreshAll();

    // sheets may have arrived from another device: settle any tie they decide,
    // which sends the updated draw back out to everybody
    stampSharedDraws();

    // whatever came in, redraw what is on screen so it shows at once
    renderSheets();
    renderDraws();
    if (current === 'drawdetail' && openDrawId) {
      renderGroups();
      renderDrawTab();
    }

    if (!quiet) {
      toast(changed
        ? 'Up to date - ' + changed + (changed === 1 ? ' change' : ' changes') + ' synced'
        : 'Up to date - nothing to send or fetch');
    }

  } catch (e) {

    const code = (e && e.code) || '';
    const msg = (e && e.message) || '';

    if (code === 'permission-denied') {
      toast('Could not refresh - this device is no longer in the room. '
            + 'Ask the host for the code and join again.', 7000);

    } else if (msg === 'no such code') {
      toast('That session is over - the host ended it or issued a new code.', 6000);

    } else {
      toast('Could not refresh: ' + troubleWords(code || msg), 5000);
    }

  } finally {
    refreshing = false;
    setRefreshBusy(false);
  }
}

function setRefreshBusy(on) {
  ['#sheetRefresh', '#ddRefresh'].forEach(sel => {
    const b = $(sel);
    if (!b) return;
    b.disabled = on;
    b.classList.toggle('busy', on);
    b.setAttribute('aria-busy', on ? 'true' : 'false');
  });
}

/* ---------------- the join code as a QR square ----------------
   Typing eight characters at a noisy ground is the likeliest way joining goes
   wrong, so the host shows the join link as a square the other phone's camera
   can read. The encoder is fetched only when a host opens this, and only ever
   needs to work online - hosting does anyway. Without it the code still shows. */

let qrLoading = null;

function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (qrLoading) return qrLoading;

  qrLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
    s.onload = () => window.qrcode ? resolve(window.qrcode) : reject(new Error('qr'));
    s.onerror = () => { qrLoading = null; reject(new Error('qr')); };
    document.head.appendChild(s);
  });

  return qrLoading;
}

async function drawQr(box, text) {
  if (!box) return;
  box.hidden = true;

  try {
    const make = await loadQr();
    const qr = make(0, 'M');
    qr.addData(text);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, alt: 'Join code as a QR square' });
    box.hidden = false;
  } catch (e) {
    box.hidden = true;   // no signal: the code below it still works
  }
}

/* Settling the ties is part of saving a score sheet, on the host. Wrapping the
   store catches every route in - scoring, editing, deleting, and sheets that
   arrive from another device - without a call scattered through each of them. */
(function stampOnSave() {
  const original = Matches.save.bind(Matches);
  Matches.save = function (list) {
    const result = original(list);
    try { stampSharedDraws(); } catch (e) {}
    return result;
  };
})();

/* Both Refresh buttons, and a pull down from the top on a phone. */
(function wireRefresh() {

  const hook = sel => {
    const b = $(sel);
    if (b) b.onclick = () => syncNow(false);
  };

  hook('#sheetRefresh');
  hook('#ddRefresh');


  /* Pull down from the top of the page to refresh, the way a phone expects. */
  const bar = document.createElement('div');
  bar.id = 'pullbar';
  document.body.appendChild(bar);

  let armed = false, dy = 0;

  const atTop = () =>
    (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0) <= 1;

  const show = d => {
    dy = d;
    bar.style.transform = 'translateY(' + Math.min(d, 90) + 'px)';
    bar.textContent = d >= 70 ? 'Release to refresh' : 'Pull to refresh';
    bar.classList.add('on');
  };

  const hide = () => { bar.classList.remove('on'); bar.style.transform = ''; dy = 0; };

  document.addEventListener('touchstart', e => {
    armed = e.touches.length === 1 && atTop() && Object.keys(DB.read('rooms', {})).length > 0;
    dy = 0;
    if (armed) bar.dataset.y = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!armed) return;
    const moved = e.touches[0].clientY - Number(bar.dataset.y || 0);
    if (moved > 12) show(moved); else if (dy) hide();
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!armed) return;
    const go = dy >= 70;
    armed = false;
    hide();
    if (go) syncNow(false);
  }, { passive: true });
})();

/** The link that drops someone straight into this room. */
function joinLink(code) {
  return location.origin + location.pathname + '?join=' + encodeURIComponent(code);
}

$('#shCreateBtn').onclick = async () => {

  const draw = openDraw();
  if (!draw) return;

  const btn = $('#shCreateBtn');
  btn.disabled = true;
  btn.textContent = 'Opening...';

  try {
    await Room.createFor(draw);
    renderDrawTabButtons(draw.id);
    toast('Room open - share the code');

  } catch (e) {
    toast(roomError(e), 4500);

  } finally {
    btn.disabled = false;
    btn.textContent = 'Open a room';
    renderShare();
  }
};

$('#shCopyBtn').onclick = async () => {
  const m = Room.forDraw(openDrawId);
  if (!m || !m.host) return;
  try { await navigator.clipboard.writeText(m.code); toast('Code copied'); }
  catch (e) { toast('Could not copy - the code is ' + m.code, 5000); }
};

$('#shLinkBtn').onclick = async () => {

  const m = Room.forDraw(openDrawId);
  const draw = openDraw();
  if (!m || !m.host || !draw) return;

  const text = 'Join ' + (draw.tournament || 'the tournament') + ' on KhoScore.\n'
    + 'Code: ' + m.code + '\n' + joinLink(m.code);

  if (navigator.share) {
    try { await navigator.share({ title: 'KhoScore', text }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }

  try { await navigator.clipboard.writeText(text); toast('Invite copied - paste it to them'); }
  catch (e) { toast('Code: ' + m.code, 6000); }
};

$('#shNewCodeBtn').onclick = async () => {

  const answer = await ask('New code?',
    'The old code stops working straight away and every device that joined with '
    + 'it is dropped. The tournament itself is not touched.',
    { yes: 'New code', no: 'Keep this one' });

  if (answer !== 'yes') return;

  try {
    const fresh = await Room.regenerate(openDrawId);
    toast('New code: ' + fresh, 4000);
  } catch (e) {
    toast(roomError(e), 4500);
  }

  renderShare();
};

$('#shEndBtn').onclick = async () => {

  const answer = await ask('End session for everyone?',
    'Everyone who joined is dropped and the code stops working. Your draw and '
    + 'score sheets stay here, and so does their copy of what they already have.',
    { yes: 'End session', no: 'Keep it open' });

  if (answer !== 'yes') return;

  try {
    await Room.end(openDrawId);
    toast('Session ended');
  } catch (e) {
    toast(roomError(e), 4500);
  }

  renderShare();
};

/* ---------------- joining ---------------- */

$('#acJoinBtn').onclick = async () => {

  const field = $('#acJoinCode');
  const typed = Room.tidyCode(field.value);

  if (typed.length !== 9) { toast('A code looks like ABCD-EFGH'); return; }

  const btn = $('#acJoinBtn');
  btn.disabled = true;
  btn.textContent = 'Joining...';

  try {
    const room = await Room.join(typed);
    field.value = '';
    toast('Joined ' + (room.tournament || 'the tournament'));

    // go straight to the tournament rather than leaving them on this screen
    openJoined(room.drawId);

  } catch (e) {
    toast(roomError(e, true), 4500);

  } finally {
    btn.disabled = false;
    btn.textContent = 'Join';
  }
};

/** A tournament to open as soon as its draw arrives from the room. */
let pendingOpenDraw = null;

/** Opens a joined tournament now, or the moment it comes down. */
function openJoined(drawId) {
  const draw = Draws.byId(drawId);
  if (draw) { showDraw(draw); return; }

  pendingOpenDraw = drawId;
  toast('Getting the tournament…', 6000);
}

/** Plain words for what went wrong, since these all look alike to a referee. */
function roomError(e, joining) {

  const code = (e && e.code) || '';
  const msg = (e && e.message) || '';

  if (msg === 'no such code') return 'No tournament with that code';
  if (msg === 'ended') return 'That session has been ended by the host';
  if (msg === 'bad code') return 'A code looks like ABCD-EFGH';
  if (msg === 'sign-in required') return 'Sign in first to host a tournament';

  if (code === 'permission-denied') {
    return joining
      ? 'The server refused this join. The host may need to check the setup.'
      : 'Only the host can change this tournament';
  }

  if (code === 'unavailable' || code === 'auth/network-request-failed') {
    return 'No connection. Scoring still works - this will catch up later.';
  }

  if (code === 'auth/admin-restricted-operation') {
    return 'Anonymous sign-in is not switched on in Firebase yet';
  }

  return 'That did not work. Please try again.';
}

/* ---------------- a room speaking up ---------------- */

function roomEvent(event) {

  if (event.type === 'ended') {

    ask('Session ended',
        (event.regenerated
          ? 'The host has issued a new code. Ask them for it to join again.'
          : 'The host has ended this session.')
        + ' The tournament, its score sheets and its teams have been removed '
        + 'from this device. The host still has them all.',
        { yes: 'OK', no: null });

    // the tournament has just gone, so leave its screen before redrawing
    if (current === 'drawdetail' && (!event.drawId || openDrawId === event.drawId)) {
      openDrawId = null;
      go('draws');
    }

    renderDraws();
    renderSheets();
    renderTeams();
    return;
  }

  if (event.type === 'records') {

    // a tournament just joined arrives a moment after joining, not with it, so
    // the screen opens when the draw itself turns up
    if (pendingOpenDraw) {
      const draw = Draws.byId(pendingOpenDraw);
      if (draw) { pendingOpenDraw = null; showDraw(draw); return; }
    }

    // whatever is on screen may have just changed under it
    if (current === 'drawdetail') {
      if (ddTab === 'groups') renderGroups();
      else if (ddTab === 'draw') renderDrawTab();
      else if (ddTab === 'days') renderDays();
      else if (ddTab === 'leaders') renderLeaders();
    } else if (current === 'sheets') renderSheets();
    else if (current === 'home') renderHome();
    else if (current === 'teams') renderTeams();
    else if (current === 'draws') renderDraws();
    return;
  }

  if (event.type === 'trouble') {

    // The sync has stopped working. Saying so plainly is the whole point: from
    // the outside, silence here is indistinguishable from a quiet afternoon,
    // and that is what made this so hard to pin down.
    if (troubleShown === event.code) return;
    troubleShown = event.code;

    toast('Sharing stopped - ' + troubleWords(event.code)
          + '. Tap Refresh to try again.', 6000);
    return;
  }

  if (event.type === 'code' && current === 'drawdetail') renderShare();
}

/** The last thing the server complained about, so it is said once, not each time. */
let troubleShown = '';

/** Plain words for why sharing stopped. */
function troubleWords(code) {

  if (code === 'permission-denied') return 'this device is no longer in the room';
  if (code === 'unauthenticated') return 'this device is not signed in to the room';

  if (code === 'unavailable' || code === 'auth/network-request-failed') {
    return 'no connection';
  }

  return code;
}

/** Reconnects to whichever room this draw belongs to, when one is opened. */
function reopenRoomFor(drawId) {
  // Already connected: leave it be. Every other shared tournament stays
  // connected too, so opening one draw never cuts the sync of another.
  if (Room.isLiveFor(drawId)) return;
  Room.reopen(drawId).catch(() => {});
}

/** A link of the shape ...?join=ABCD-EFGH drops someone straight into a room. */
function joinFromLink() {

  const wanted = new URLSearchParams(location.search).get('join');
  if (!wanted) return;

  history.replaceState({}, '', location.pathname);

  toast('Joining…', 8000);

  Room.join(Room.tidyCode(wanted))
    .then(room => {
      toast('Joined ' + (room.tournament || 'the tournament'), 4000);
      openJoined(room.drawId);          // land on the tournament, not the home screen
    })
    .catch(e => toast(roomError(e, true), 6000));
}

/**
 * room.js is loaded after this file, so nothing here may touch Room while the
 * page is still parsing. Getting that wrong threw a ReferenceError that stopped
 * join links working at all, silently - hence waiting for every script to be in.
 */
function wireRoomEvents() {
  Room.watch(roomEvent);

  // Connect every shared tournament now, before anybody opens a draw or starts
  // scoring. This is what makes a sheet scored on any device reach the others,
  // and the others' sheets arrive here, whichever screen the app opens on.
  Room.restoreAll().catch(() => {});

  joinFromLink();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireRoomEvents);
} else {
  wireRoomEvents();
}
