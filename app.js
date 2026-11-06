/* KhoTrack - web / desktop version.
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
  save: list => DB.write('teams', list),

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
  save: list => DB.write('matches', list),
  add(m) { const l = this.all(); l.push(m); this.save(l); }
};

/**
 * Tournament draws. Each carries an id of its own, because two draws can easily
 * share a tournament name, a date, a side and an age group.
 */
const Draws = {
  all: () => DB.read('draws', []),
  save: list => DB.write('draws', list),
  byId(id) { return this.all().find(d => d.id === id) || null; }
};

/* ============================================================
   SMALL UI HELPERS
   ============================================================ */

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

let toastTimer = null;
function toast(msg, ms = 2400) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
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
  sheets: renderSheets
};

document.addEventListener('click', e => {
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

/* ============================================================
   HOME
   ============================================================ */

function renderHome() {
  const draft = DB.read('liveMatchDraft', null);
  const btn = $('#resumeBtn');

  if (draft && draft.team1 && draft.team2) {
    btn.style.display = '';
    btn.textContent = '⏱ Resume  ' + draft.team1.teamName + ' ' + draft.team1Score
                    + ' - ' + draft.team2Score + ' ' + draft.team2.teamName;
  } else {
    btn.style.display = 'none';
  }
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

  [['Men', '👨 Men Teams', 'var(--yellow)'], ['Women', '👩 Women Teams', 'var(--pink)']]
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

  if (!all.length) box.innerHTML = '<div class="card empty">No teams registered yet</div>';
}

function teamRow(team) {
  const row = document.createElement('div');
  row.className = 'listrow';

  row.innerHTML = `
    <div class="grow pick">
      <div class="name">${esc(team.teamName)}</div>
      <div class="meta">${team.players.length} players • Coach: ${esc(team.coachName)}</div>
    </div>`;

  row.querySelector('.grow').onclick = () => showTeamDetail(team);

  const del = document.createElement('button');
  del.className = 'red';
  del.textContent = '🗑';
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
    .map((p, i) => `<div class="listrow"><div class="grow">🔹 ${i + 1}. ${esc(p)}</div></div>`)
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
  $('#regTitle').textContent = editingTeam ? '✏️ Edit Team' : '🏃 Team Registration';
  $('#saveTeamBtn').textContent = editingTeam ? 'UPDATE TEAM' : 'SAVE TEAM';

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

  $('#drawTotal').textContent = `Total Draws : ${all.length}`;

  box.innerHTML = '';

  if (!all.length) {
    box.innerHTML = '<div class="card empty">No draws yet</div>';
    return;
  }

  const card = document.createElement('div');
  card.className = 'card';

  // newest first, the same way the score sheets are listed
  for (let i = all.length - 1; i >= 0; i--) {
    const d = all[i];

    const row = document.createElement('div');
    row.className = 'listrow';
    row.innerHTML = `
      <div class="grow pick">
        <div class="name">${esc(d.tournament)}</div>
        <div class="meta">${esc(drawDates(d).join(',  ') || 'No Date')} • ${esc(d.teamType)} ${esc(d.category)}</div>
      </div>`;

    row.querySelector('.grow').onclick = () => showDraw(d);

    const del = document.createElement('button');
    del.className = 'red';
    del.textContent = '🗑';
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

  toast('Draw Saved');
  renderDraws();
};

/* ---------------- one draw: groups and the bracket ---------------- */

let openDrawId = null;

function showDraw(draw) {
  openDrawId = draw.id;

  $('#ddName').textContent = draw.tournament;
  $('#ddMeta').textContent =
    `${drawDates(draw).join(',  ')}   •   ${draw.teamType} ${draw.category}`;

  showDrawTab('groups');
  go('drawdetail');
}

function showDrawTab(which) {
  const groups = which === 'groups';

  $('#ddGroupsView').style.display = groups ? '' : 'none';
  $('#ddDrawView').style.display = groups ? 'none' : '';

  $('#ddGroupsTab').className = groups ? 'green' : 'grey';
  $('#ddDrawTab').className = groups ? 'grey' : 'green';

  if (groups) renderGroups(); else renderDrawTab();
}

/** The teams ticked in each group, in group order. */
function qualifiedTeams(draw) {
  const out = [];

  (draw.groups || []).forEach((g, gi) => {
    (g.teams || []).forEach(name => {
      if ((g.qualified || []).includes(name)) out.push({ group: groupName(gi), name });
    });
  });

  return out;
}

function renderDrawTab() {
  const draw = openDraw();
  const box = $('#ddDrawView');

  box.innerHTML = '';
  if (!draw) return;

  const through = qualifiedTeams(draw);

  if (!through.length) {
    box.innerHTML = '<div class="card empty">Tick the teams going through '
      + 'on the Groups tab and they appear here</div>';
    return;
  }

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>Through to the draw — ${through.length}</h2>`;

  through.forEach(t => {
    const row = document.createElement('div');
    row.className = 'listrow';
    row.innerHTML = `<div class="grow"><div class="name">${esc(t.name)}</div>`
      + `<div class="meta">${t.group}</div></div>`;
    card.appendChild(row);
  });

  box.appendChild(card);
}

$('#ddGroupsTab').onclick = () => showDrawTab('groups');
$('#ddDrawTab').onclick = () => showDrawTab('draw');

/** The draw being looked at, read fresh so edits are never made to a stale copy. */
function openDraw() {
  return Draws.byId(openDrawId);
}

/** Writes a change back to the stored list. */
function saveOpenDraw(draw) {
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

  // only this draw's own side and age group, and only teams not already placed
  const eligible = Teams.all().filter(t =>
    (t.teamType || 'Men') === draw.teamType && (t.category || 'Open') === draw.category);

  const placed = new Set();
  groups.forEach(g => (g.teams || []).forEach(n => placed.add(n)));

  groups.forEach((group, gi) => box.appendChild(groupCard(draw, group, gi, eligible, placed)));
}

function groupCard(draw, group, gi, eligible, placed) {
  const card = document.createElement('div');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'listrow';
  head.innerHTML = `<div class="grow"><h2 style="margin:0">${groupName(gi)}</h2></div>`;

  const kill = document.createElement('button');
  kill.className = 'red';
  kill.textContent = '🗑';
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

    const wins = winsFor(draw, name);

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
      saveOpenDraw(d);
    };

    row.appendChild(tick);

    // the tally sits out on the right, away from the name, and only appears
    // once there is something to show
    row.insertAdjacentHTML('beforeend',
      `<div class="grow">🔹 ${esc(name)}</div>`
      + (wins ? `<span class="wins" title="Matches won">${wins}</span>` : ''));

    const out = document.createElement('button');
    out.className = 'red';
    out.textContent = '✕';
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
    : `Total Matches : ${all.length}`;

  if (!shown) {
    box.innerHTML = `<div class="card empty">${all.length
      ? 'No match found for "' + esc($('#sheetSearch').value) + '"'
      : 'No matches saved yet'}</div>`;
    return;
  }

  groups.forEach((list, date) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<h2>📅 ${esc(date)}</h2>`;

    list.forEach(m => {
      const draw = isDraw(m);
      const row = document.createElement('div');
      row.className = 'listrow';
      row.innerHTML = `<div class="grow pick">
          <div class="name">${esc(m.team1Name)} vs ${esc(m.team2Name)}</div>
          <div class="meta">${m.team1Score} - ${m.team2Score} • ${draw ? 'Draw' : '🏆 ' + esc(m.winner)}</div>
        </div>`;

      row.querySelector('.grow').onclick = () => showDetail(m, m.__index);

      const del = document.createElement('button');
      del.className = 'red';
      del.textContent = '🗑';
      del.onclick = async () => {
        if (await ask('Delete Match', `Delete ${m.team1Name} vs ${m.team2Name}?`, { yes: 'Delete' }) !== 'yes') return;
        const l = Matches.all();
        const idx = typeof m.__index === 'number' ? m.__index : -1;
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
