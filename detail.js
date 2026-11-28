/* Match detail and export.
 *
 * Mirrors MatchDetailActivity: the same half titles, the same per-half attacking side
 * used to resolve jersey numbers to the right squad, and the same Dream Run summary.
 *
 * PDF comes from the browser's own print-to-PDF rather than a bundled PDF library, so
 * there is nothing to download and it works offline on every platform.
 */

/** Badge colour per age category; anything unrecognised falls back to the Open green. */
const CAT_COLOURS = {
  U14: '#2563EB', U17: '#0EA5E9', U18: '#7C3AED', U19: '#DB2777', OPEN: '#059669'
};

let detailMatch = null;

/** Index of the shown match inside the stored list; null means it cannot be edited. */
let detailIndex = null;

let editing = false;

/** Which of the four tabs on a match is showing. */
let detailPane = 'summary';

function halfTitle(m, i) {
  if (m.halfTitles && i < m.halfTitles.length && m.halfTitles[i]) return m.halfTitles[i];
  return ['1st Inning - 1st Half', '1st Inning - 2nd Half',
          '2nd Inning - 1st Half', '2nd Inning - 2nd Half',
          '3rd Inning - 1st Half', '3rd Inning - 2nd Half'][i] || ('Half ' + (i + 1));
}

function halfCode(m, i) {
  const t = halfTitle(m, i);
  if (t.startsWith('Sudden Death')) return t.includes('1st') ? 'SD1' : 'SD2';
  const inn = t.startsWith('1st') ? 'I1' : t.startsWith('2nd') ? 'I2'
            : t.startsWith('3rd') ? 'I3' : 'H' + (i + 1);
  const half = t.includes('1st Half') ? 'H1' : t.includes('2nd Half') ? 'H2' : '';
  return inn + half;
}

/** true if team1 was attacking in that half; legacy matches alternate from team1. */
function wasTeam1Attacking(m, i) {
  if (m.halfTeam1Attacking && i < m.halfTeam1Attacking.length
      && typeof m.halfTeam1Attacking[i] === 'boolean') {
    return m.halfTeam1Attacking[i];
  }
  return i % 2 === 0;
}

const halfBonusOf = (m, i) =>
  (m.halfBonus && typeof m.halfBonus[i] === 'number') ? m.halfBonus[i] : 0;

/** "5. Amit Deshmukh", or just "5." when the name is unknown. */
function numName(jersey, name) {
  if (!jersey) return '';
  if (jersey === '-') return '-';   // recorded without naming the player
  return jersey + '.' + (name ? ' ' + name : '');
}

function squadName(m, jersey, fromTeam1) {
  if (!jersey) return '';

  let squad = fromTeam1 ? m.team1Players : m.team2Players;

  if (!squad) {   // saved before squads were stored - fall back to the team list
    const t = Teams.byName(fromTeam1 ? m.team1Name : m.team2Name, m.teamType, m.category);
    squad = t && t.players;
  }
  if (!squad) return '';

  const i = parseInt(jersey, 10) - 1;
  return (i >= 0 && i < squad.length) ? squad[i] : '';
}

/** Flattens the match into printable rows, names already resolved. */
function sheetRows(m) {
  const rows = [];
  const events = m.allEvents || [];

  for (let h = 0; h < events.length; h++) {
    const batches = events[h] || [];
    const times = (m.allTimes || [])[h] || [];
    const types = (m.allTypes || [])[h] || [];
    const t1Att = wasTeam1Attacking(m, h);

    for (let i = 0; i < batches.length; i++) {

      let firstOfBatch = true;

      for (let j = 0; j < batches[i].length; j++) {
        const raw = batches[i][j];
        if (!raw || raw === '-') continue;

        const time = (times[i] && times[i][j]) || '-';
        const type = (types[i] && types[i][j]) || '-';

        let defNo = raw.trim(), attNo = '';
        if (raw.includes('-by-')) {
          const parts = raw.split('-by-');
          defNo = (parts[0] || '').trim();
          attNo = (parts[1] || '').trim();

          // a self out is stored as "3-by--", so the attacker side is the "-"
          // placeholder rather than a real jersey
          if (attNo === '-') attNo = '';
        }

        // the defender belongs to the defending side of that half
        const defName = squadName(m, defNo, !t1Att);
        const attName = squadName(m, attNo, t1Att);

        const notOut = time === 'Not Out';
        const label = numName(defNo, defName)
          + (notOut || !attNo ? '' : ' - by - ' + numName(attNo, attName));

        rows.push({
          halfIndex: h,
          batchIndex: i,
          eventIndex: j,
          half: halfTitle(m, h),
          batchNo: i + 1,
          batch: 'Batch ' + (i + 1),
          firstOfBatch,
          defNo, defName, attNo, attName,
          time, type, notOut, label
        });

        firstOfBatch = false;   // the label shows once, on the batch's first line
      }
    }
  }

  return rows;
}

/**
 * Every attacker's wicket count for the whole match, grouped by team.
 *
 * Grouping by team matters: jersey 5 of one side is a different player from jersey 5
 * of the other, so their tallies must never be merged.
 */
function matchSummary(m, rows) {
  const teams = new Map();

  // seed both sides so a team that took nothing is still listed, in a stable order
  teams.set(m.team1Name, new Map());
  teams.set(m.team2Name, new Map());

  rows.forEach(r => {
    // not outs and self outs have no attacker to credit
    if (r.notOut || !r.attNo) return;

    const team = wasTeam1Attacking(m, r.halfIndex) ? m.team1Name : m.team2Name;

    if (!teams.has(team)) teams.set(team, new Map());

    const jerseys = teams.get(team);
    const had = jerseys.get(r.attNo);

    jerseys.set(r.attNo, {
      name: (had && had.name) || r.attName,
      count: (had ? had.count : 0) + 1
    });
  });

  return Array.from(teams.entries()).map(([name, jerseys]) => ({
    name,
    pairs: Array.from(jerseys.entries())
      .sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10))
      .map(([jersey, v]) => ({ jersey, player: v.name, count: v.count }))
  }));
}

/** "5. Amit - 4,  7. Kiran - 1", or a dash when the side took nothing. */
function pairsText(pairs) {
  if (!pairs.length) return '-';
  return pairs.map(p => numName(p.jersey, p.player) + ' - ' + p.count).join(',   ');
}

/**
 * "Batch 1 - 2,  Batch 3 - 1" for one half, or '' when nothing was earned or the
 * match was saved before the per-batch figures were kept.
 */
function dreamRunByBatch(m, i) {
  const per = m.halfBatchBonus && m.halfBatchBonus[i];
  if (!Array.isArray(per)) return '';

  return per
    .map((n, b) => ({ n: n || 0, b }))
    .filter(x => x.n > 0)
    .map(x => `Batch ${x.b + 1} - ${x.n}`)
    .join(',   ');
}

function sectionLabel(m, i) {
  const bonus = halfBonusOf(m, i);
  if (!bonus) return halfTitle(m, i);

  const defending = wasTeam1Attacking(m, i) ? m.team2Name : m.team1Name;
  const perBatch = dreamRunByBatch(m, i);

  return `${halfTitle(m, i)}   ⭐ Dream Run +${bonus} ${defending}`
       + (perBatch ? `   (${perBatch})` : '');
}

function rulesLine(m) {
  let s = (m.wicketPoints || 1) + ' point(s) per wicket';
  if (m.attackPlayers) s += '  |  ' + m.attackPlayers + '-player attack';
  s += m.dreamRunMinutes
    ? `  |  Dream Run ${m.dreamRunMinutes} min, bonus every ${m.bonusIntervalSeconds || 30} sec`
    : '  |  No Dream Run';
  return s;
}

/* ============================================================
   WHAT THE SHEET ALREADY KNOWS

   Everything on the Summary, Turns and Players tabs is counted from the
   wickets on the sheet. Nothing is entered for it and nothing is estimated.
   ============================================================ */

/** "Satara won by 6 points", "Sangli won in sudden death", or "Match drawn". */
function resultLine(m) {
  if (isDraw(m)) return 'Match drawn';
  if (wentToSuddenDeath(m)) return m.winner + ' won in sudden death';

  const margin = Math.abs((Number(m.team1Score) || 0) - (Number(m.team2Score) || 0));
  return margin ? `${m.winner} won by ${margin} ${margin === 1 ? 'point' : 'points'}` : m.winner + ' won';
}

const isDive = type => type === 'Pole Dive' || type === 'Sky Dive';

/** Per side: wickets taken attacking, how many were dives, dream run points defending. */
function sideStats(m, rows) {
  const st = [{ wickets: 0, dives: 0, dream: 0 }, { wickets: 0, dives: 0, dream: 0 }];

  rows.forEach(r => {
    if (r.notOut) return;
    const att = wasTeam1Attacking(m, r.halfIndex) ? 0 : 1;
    st[att].wickets++;
    if (isDive(r.type)) st[att].dives++;
  });

  (m.allEvents || []).forEach((_, h) => {
    const def = wasTeam1Attacking(m, h) ? 1 : 0;
    st[def].dream += halfBonusOf(m, h);
  });

  return st;
}

function barRow(label, value, max, alt) {
  const pct = Math.round((value / Math.max(1, max)) * 100);
  return `<div class="barrow"><span class="lbl">${esc(label)}</span>`
    + `<div class="bartrack"><div class="barfill${alt ? ' alt' : ''}" style="width:${pct}%"></div></div>`
    + `<span class="v">${value}</span></div>`;
}

const NO_DATA = '<div class="empty">No ball-by-ball data recorded for this match</div>';

function renderGlance(m, rows) {
  const box = $('#dtGlance');

  if (!rows.length) { box.innerHTML = NO_DATA; return; }

  const st = sideStats(m, rows);
  const names = [m.team1Name, m.team2Name];

  const metric = (title, key) => {
    const max = Math.max(st[0][key], st[1][key]);
    return `<p class="eyebrow">${title}</p>`
      + barRow(names[0], st[0][key], max, false)
      + barRow(names[1], st[1][key], max, true);
  };

  let html = metric('Wickets taken', 'wickets') + metric('Of them, dives', 'dives');
  if (st[0].dream || st[1].dream || m.dreamRunMinutes) html += metric('Dream run points', 'dream');

  box.innerHTML = html;
}

/** Points per half, both sides, drawn to one scale - where the match was won. */
function renderTurns(m, rows) {
  const box = $('#dtPaneTurns');
  const halves = (m.allEvents || []).length;

  if (!halves) { box.innerHTML = '<div class="card">' + NO_DATA + '</div>'; return; }

  const pts = m.wicketPoints || 1;
  const per = [];

  for (let h = 0; h < halves; h++) {
    const t1Att = wasTeam1Attacking(m, h);
    const outs = rows.filter(r => r.halfIndex === h && !r.notOut).length;
    const bonus = halfBonusOf(m, h);
    const scored = outs * pts;

    per.push({ h, outs, bonus, t1Att, t1: t1Att ? scored : bonus, t2: t1Att ? bonus : scored });
  }

  const max = Math.max(1, ...per.map(p => Math.max(p.t1, p.t2)));

  const colW = 66, padX = 8, padT = 20, padB = 26, H = 176;
  const W = Math.max(300, padX * 2 + per.length * colW);
  const plotH = H - padT - padB;
  const base = H - padB;

  let marks = `<line x1="${padX}" y1="${base}" x2="${W - padX}" y2="${base}" style="stroke:var(--line)" stroke-width="1"></line>`;

  per.forEach((p, i) => {
    const x0 = padX + i * colW + 13;

    [[p.t1, 'var(--accent)'], [p.t2, 'var(--warn)']].forEach(([v, colour], k) => {
      const hgt = Math.round((v / max) * plotH);
      const x = x0 + k * 21;
      if (hgt > 0) {
        marks += `<rect x="${x}" y="${base - hgt}" width="17" height="${hgt}" rx="3" style="fill:${colour}"></rect>`;
      }
      marks += `<text x="${x + 8.5}" y="${base - hgt - 6}" text-anchor="middle" font-size="11" `
        + `style="fill:var(--muted)">${v}</text>`;
    });

    marks += `<text x="${x0 + 19}" y="${H - 8}" text-anchor="middle" font-size="11" `
      + `style="fill:var(--muted)">${esc(halfCode(m, p.h))}</text>`;
  });

  let html = '<div class="card"><p class="eyebrow">Points in each half</p>'
    + `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W * 1.6}px;height:auto;display:block" `
    + `role="img" aria-label="Points scored by each side in each half">${marks}</svg>`
    + `<div class="legend"><span><i style="background:var(--accent)"></i>${esc(m.team1Name)}</span>`
    + `<span><i style="background:var(--warn)"></i>${esc(m.team2Name)}</span></div></div>`;

  html += '<div class="card tight">';
  per.forEach(p => {
    const attName = p.t1Att ? m.team1Name : m.team2Name;
    const defName = p.t1Att ? m.team2Name : m.team1Name;
    html += `<div class="listrow"><div class="grow"><div class="name">${esc(halfTitle(m, p.h))}</div>`
      + `<div class="meta">${esc(attName)} attacking &middot; ${p.outs} ${p.outs === 1 ? 'wicket' : 'wickets'}`
      + (p.bonus ? ` &middot; ${esc(defName)} dream run +${p.bonus}` : '') + `</div></div>`
      + `<span class="score">${p.t1}&ndash;${p.t2}</span></div>`;
  });
  html += '</div>';

  box.innerHTML = html;
}

/** Every attacker who took a wicket: how many, and how many of those were dives. */
function renderPlayers(m, rows) {
  const box = $('#dtPanePlayers');

  if (!rows.length) { box.innerHTML = '<div class="card">' + NO_DATA + '</div>'; return; }

  const sides = [new Map(), new Map()];

  rows.forEach(r => {
    if (r.notOut || !r.attNo) return;
    const s = wasTeam1Attacking(m, r.halfIndex) ? 0 : 1;
    const p = sides[s].get(r.attNo) || { jersey: r.attNo, name: '', wickets: 0, dives: 0 };
    p.wickets++;
    if (isDive(r.type)) p.dives++;
    if (!p.name && r.attName) p.name = r.attName;
    sides[s].set(r.attNo, p);
  });

  const max = Math.max(1, ...sides.flatMap(s => [...s.values()].map(p => p.wickets)));

  let html = '';

  [m.team1Name, m.team2Name].forEach((team, s) => {
    const list = [...sides[s].values()].sort((a, b) =>
      b.wickets - a.wickets || b.dives - a.dives || parseInt(a.jersey, 10) - parseInt(b.jersey, 10));

    html += `<p class="eyebrow">${esc(team)} &middot; attacking</p><div class="card">`;

    if (!list.length) html += '<div class="empty" style="padding:6px 0">No wicket credited to a player</div>';

    list.forEach(p => {
      const w = Math.round((p.wickets / max) * 100);
      const d = p.wickets ? Math.round((p.dives / p.wickets) * 100) : 0;
      html += `<div class="barrow"><span class="lbl">${esc(p.jersey)}. ${esc(p.name || 'Jersey ' + p.jersey)}</span>`
        + `<div class="bartrack"><div class="barfill" style="width:${w}%">`
        + `<div class="barfill alt" style="width:${d}%"></div></div></div>`
        + `<span class="v">${p.wickets}</span></div>`;
    });

    html += '</div>';
  });

  html += '<div class="legend" style="margin:0 4px 14px"><span><i style="background:var(--accent)"></i>wickets</span>'
    + '<span><i style="background:var(--warn)"></i>of them dives</span></div>';

  box.innerHTML = html;
}

function showDetailPane(p) {
  const panes = {
    summary: '#dtPaneSummary', turns: '#dtPaneTurns',
    players: '#dtPanePlayers', sheet: '#dtPaneSheet'
  };

  Object.entries(panes).forEach(([key, sel]) => { $(sel).hidden = key !== p; });
  $$('#dtTabs [data-pane]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pane === p)));
}

$('#dtTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-pane]');
  if (!b) return;
  detailPane = b.dataset.pane;
  showDetailPane(detailPane);
});

/* ============================================================
   THE RESULT CARD

   One square picture per match - teams, score, margin, the tournament and the
   date - for the WhatsApp group that is waiting for the result. Drawn here on a
   canvas, so it needs nothing from the internet.
   ============================================================ */

/** The tournament this match belongs to, if one on this phone covers it. */
function tournamentOf(m) {
  const day = dateKey(m.date);
  const d = Draws.all().find(x =>
    (x.teamType || 'Men') === (m.teamType || 'Men')
    && (x.category || 'Open') === (m.category || 'Open')
    && drawDates(x).map(dateKey).includes(day));
  return d ? d.tournament : '';
}

/** The largest size, up to start, at which text fits the width. */
function fitFont(g, text, weight, family, start, min, width) {
  let size = start;
  for (; size > min; size -= 4) {
    g.font = `${weight} ${size}px ${family}`;
    if (g.measureText(text).width <= width) break;
  }
  g.font = `${weight} ${size}px ${family}`;
  return size;
}

async function drawResultCard(m) {
  const DISPLAY = '"Space Grotesk", Inter, system-ui, sans-serif';
  const TEXT = 'Inter, system-ui, sans-serif';

  try {
    await Promise.all([
      document.fonts.load(`700 64px "Space Grotesk"`),
      document.fonts.load(`600 32px Inter`)
    ]);
  } catch (e) { /* offline and never loaded: the fallbacks still read well */ }

  const S = 1080, P = 92;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');

  const ground = g.createLinearGradient(0, 0, S, S);
  ground.addColorStop(0, '#0F172A');
  ground.addColorStop(0.62, '#1E3A8A');
  ground.addColorStop(1, '#0E7490');
  g.fillStyle = ground;
  g.fillRect(0, 0, S, S);

  // the tournament, or the side and age group when it belongs to none
  const kicker = (tournamentOf(m) || ((m.teamType || 'Men') + ' ' + (m.category || 'Open'))).toUpperCase();
  g.fillStyle = 'rgba(255,255,255,.72)';
  g.textAlign = 'left';
  fitFont(g, kicker, 700, TEXT, 34, 22, S - P * 2);
  g.fillText(kicker, P, 160);

  const rowsY = [430, 640];
  [[m.team1Name, m.team1Score], [m.team2Name, m.team2Score]].forEach(([name, score], i) => {
    const won = !isDraw(m) && m.winner === name;
    g.fillStyle = won ? '#FFFFFF' : 'rgba(255,255,255,.7)';
    g.textAlign = 'left';
    fitFont(g, name, 700, DISPLAY, 92, 44, S - P * 2 - 300);
    g.fillText(name, P, rowsY[i]);

    g.textAlign = 'right';
    g.font = `700 170px ${DISPLAY}`;
    g.fillText(String(score), S - P, rowsY[i] + 30);
  });

  g.fillStyle = 'rgba(255,255,255,.18)';
  g.fillRect(P, 520, S - P * 2, 2);

  g.textAlign = 'left';
  g.fillStyle = '#67E8F9';
  fitFont(g, resultLine(m), 700, TEXT, 44, 28, S - P * 2);
  g.fillText(resultLine(m), P, 800);

  g.fillStyle = 'rgba(255,255,255,.7)';
  g.font = `500 32px ${TEXT}`;
  g.fillText(m.date || '', P, 858);

  g.fillStyle = 'rgba(255,255,255,.9)';
  g.font = `700 42px ${DISPLAY}`;
  g.fillText('KhoScore', P, S - P);

  g.textAlign = 'right';
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.font = `500 28px ${TEXT}`;
  g.fillText('Kho Kho scoring', S - P, S - P);

  return c;
}

let cardBlob = null;

const cardName = m => exportName(m, 'png').replace(/^Scoresheet_/, 'Result_');

$('#cardBtn').onclick = async () => {
  if (!detailMatch) return;

  const c = await drawResultCard(detailMatch);
  $('#cardPreview').src = c.toDataURL('image/png');
  cardBlob = await new Promise(res => c.toBlob(res, 'image/png'));

  $('#dlgCard').showModal();
};

$('#cardClose').onclick = () => $('#dlgCard').close();

$('#cardSaveBtn').onclick = () => {
  if (!cardBlob || !detailMatch) return;
  download(cardName(detailMatch), cardBlob, 'image/png');
  toast('Image saved');
};

$('#cardShareBtn').onclick = async () => {
  if (!cardBlob || !detailMatch) return;

  const m = detailMatch;
  const file = new File([cardBlob], cardName(m), { type: 'image/png' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${m.team1Name} v ${m.team2Name}`, text: resultLine(m) });
      return;
    } catch (e) { if (e && e.name === 'AbortError') return; }
  }

  // no picture sharing here: save it, so it can be attached by hand
  download(file.name, file, 'image/png');
  toast('Image saved - attach it to share', 4000);
};

function showDetail(m, index) {
  detailMatch = m;
  detailIndex = (typeof index === 'number' && index >= 0) ? index : null;
  editing = false;
  detailPane = 'summary';
  renderDetail();
  go('detail');
}

/** Redraws the detail screen for the current match and edit state. */
function renderDetail() {
  const m = detailMatch;
  const draw = isDraw(m);

  const cat = m.category
    || (Teams.byName(m.team1Name, m.teamType) || {}).category
    || 'Open';
  const badge = $('#dtBadge');
  badge.textContent = m.teamType ? m.teamType + ' • ' + cat : cat;
  badge.style.background = CAT_COLOURS[cat.toUpperCase()] || '#059669';

  $('#dtTitle').textContent = `${m.team1Name} v ${m.team2Name}`;
  $('#dtCode1').textContent = teamCode(m.team1Name);
  $('#dtCode2').textContent = teamCode(m.team2Name);
  $('#dtDate').textContent = (m.date || 'No Date')
    + (m.minutesPerHalf ? `  •  ${m.minutesPerHalf} min halves` : '');

  const w = $('#dtWinner');
  w.textContent = resultLine(m);
  w.style.color = draw ? 'var(--warn)' : 'var(--good)';

  $('#dt1Name').textContent = m.team1Name;
  $('#dt2Name').textContent = m.team2Name;
  $('#dt1').textContent = m.team1Score;
  $('#dt2').textContent = m.team2Score;
  $('#dtRules').textContent = rulesLine(m);

  const rows = sheetRows(m);
  const table = $('#dtTable');

  let html = '<tr><th>Batch</th><th>Wicket</th><th>Time</th><th>Type</th></tr>';
  let currentHalf = null;

  rows.forEach(r => {
    if (r.half !== currentHalf) {
      currentHalf = r.half;
      html += `<tr class="section"><td colspan="4">${esc(sectionLabel(m, r.halfIndex))}</td></tr>`;
    }

    const idx = rows.indexOf(r);

    html += `<tr${editing ? ` data-row="${idx}" class="editable"` : ''}>`
          + `<td>${r.firstOfBatch ? esc(r.batch) : ''}</td>`
          + `<td>${editing ? '✏️ ' : ''}${esc(r.label)}</td>`
          + `<td class="${r.notOut ? 'notout' : ''}">${esc(r.time)}</td><td>${esc(r.type)}</td></tr>`;
  });

  if (!rows.length) html += '<tr><td colspan="4" class="empty">No ball-by-ball data recorded</td></tr>';

  // one tally for the whole match, once every inning is done
  if (rows.length) {
    html += '<tr class="tally"><td colspan="4">Wickets Taken — Match Total</td></tr>';

    matchSummary(m, rows).forEach(t => {
      html += `<tr class="tally team"><td colspan="4">${esc(t.name)} — `
            + `${esc(pairsText(t.pairs))}</td></tr>`;
    });
  }

  table.innerHTML = html;

  // in edit mode every wicket line opens the row editor
  if (editing) {
    table.querySelectorAll('tr[data-row]').forEach(tr => {
      tr.onclick = () => openRowEditor(rows[Number(tr.dataset.row)]);
    });
  }

  $('#editBtn').style.display = detailIndex === null ? 'none' : '';
  $('#editPanel').style.display = editing ? '' : 'none';
  $('#editBtn').textContent = editing ? 'Cancel edit' : 'Edit';

  renderGlance(m, rows);
  renderTurns(m, rows);
  renderPlayers(m, rows);

  // corrections are made on the sheet itself, so editing opens it
  if (editing) detailPane = 'sheet';   // and it stays there after the save
  showDetailPane(detailPane);
}

/* ============================================================
   EDIT
   ============================================================

   Corrections are made on a working copy and only written to storage on Save, so
   Cancel always leaves the saved match exactly as it was.
*/

let editBackup = null;

function startEdit() {
  if (detailIndex === null) { toast('This match cannot be edited'); return; }

  editBackup = JSON.parse(JSON.stringify(detailMatch));
  editing = true;

  const m = detailMatch;

  $('#edDate').value = m.date || '';
  $('#edName1').textContent = m.team1Name;
  $('#edName2').textContent = m.team2Name;
  $('#edScore1').value = m.team1Score;
  $('#edScore2').value = m.team2Score;

  $('#edWinner').innerHTML =
      `<option value="${esc(m.team1Name)}">${esc(m.team1Name)}</option>`
    + `<option value="${esc(m.team2Name)}">${esc(m.team2Name)}</option>`
    + '<option value="Draw">Draw</option>';

  $('#edWinner').value = isDraw(m) ? 'Draw' : m.winner;

  renderDetail();
  toast('Edit mode - tap a row to change it');
}

function cancelEdit() {
  detailMatch = editBackup || detailMatch;
  editBackup = null;
  editing = false;
  renderDetail();
  toast('Changes discarded');
}

function saveEdit() {
  const m = detailMatch;

  const s1 = parseInt($('#edScore1').value, 10);
  const s2 = parseInt($('#edScore2').value, 10);

  if (isNaN(s1) || isNaN(s2) || s1 < 0 || s2 < 0) {
    toast('Scores must be whole numbers');
    return;
  }

  m.date = $('#edDate').value.trim() || m.date;
  m.team1Score = s1;
  m.team2Score = s2;
  m.winner = $('#edWinner').value;

  const all = Matches.all();

  // found by its tag, so the right sheet is written even if the list has shifted
  const i = m.id ? all.findIndex(x => x.id === m.id) : detailIndex;

  if (i < 0 || i >= all.length) {
    toast('Could not find this match in storage');
    return;
  }

  all[i] = m;
  Matches.save(all);

  editBackup = null;
  editing = false;
  renderDetail();
  toast('Scoresheet updated');
}

/** Rebuilds both scores from the sheet, after rows have been corrected. */
function recalcScores() {
  const m = detailMatch;
  const pts = m.wicketPoints || 1;

  let s1 = 0, s2 = 0;

  (m.allEvents || []).forEach((batches, h) => {
    const t1Att = wasTeam1Attacking(m, h);

    let outs = 0;
    (batches || []).forEach(b => b.forEach(e => { if (e.includes('-by-')) outs++; }));

    // wickets score for the attacking side, Dream Run points for the defending side
    if (t1Att) { s1 += outs * pts; s2 += halfBonusOf(m, h); }
    else       { s2 += outs * pts; s1 += halfBonusOf(m, h); }
  });

  $('#edScore1').value = s1;
  $('#edScore2').value = s2;

  $('#edWinner').value = s1 > s2 ? m.team1Name : s2 > s1 ? m.team2Name : 'Draw';

  toast(`Recalculated: ${s1} - ${s2}`);
}

/* ---- one wicket ---- */

let rowBeingEdited = null;

function openRowEditor(r) {
  rowBeingEdited = r;

  $('#rowWhere').textContent = `${r.half}  •  ${r.batch}`;
  $('#rowDef').value = r.defNo;
  $('#rowAtt').value = r.attNo;
  $('#rowTime').value = r.time;
  $('#rowType').value = r.notOut ? '' : (r.type === '-' ? '' : r.type);

  $('#dlgRow').showModal();
}

/** Writes the edited values back into the match's own arrays. */
function applyRowEdit() {
  const r = rowBeingEdited;
  if (!r) return;

  const m = detailMatch;
  const def = $('#rowDef').value.trim();

  if (!def) { toast('Defender jersey is required'); return; }

  const att = $('#rowAtt').value.trim();
  const time = $('#rowTime').value.trim() || '00:00';
  const type = $('#rowType').value;

  const notOut = time.toLowerCase() === 'not out';

  // a not out has no attacker at all; a self out keeps the "-" placeholder
  const event = notOut ? def
    : (att ? def + '-by-' + att : def + '-by--');

  m.allEvents[r.halfIndex][r.batchIndex][r.eventIndex] = event;
  m.allTimes[r.halfIndex][r.batchIndex][r.eventIndex] = notOut ? 'Not Out' : time;
  m.allTypes[r.halfIndex][r.batchIndex][r.eventIndex] = notOut ? '' : type;

  $('#dlgRow').close();
  rowBeingEdited = null;
  renderDetail();
  toast('Row updated - remember to Save');
}

async function deleteRow() {
  const r = rowBeingEdited;
  if (!r) return;

  $('#dlgRow').close();

  if (await ask('Delete Wicket', `Remove "${r.label}" from the sheet?`,
      { yes: 'Delete' }) !== 'yes') {
    rowBeingEdited = null;
    return;
  }

  const m = detailMatch;

  m.allEvents[r.halfIndex][r.batchIndex].splice(r.eventIndex, 1);
  m.allTimes[r.halfIndex][r.batchIndex].splice(r.eventIndex, 1);
  m.allTypes[r.halfIndex][r.batchIndex].splice(r.eventIndex, 1);

  rowBeingEdited = null;
  renderDetail();
  toast('Row deleted - remember to Save');
}

$('#editBtn').onclick = () => editing ? cancelEdit() : startEdit();
$('#edSaveBtn').onclick = saveEdit;
$('#edCancelBtn').onclick = cancelEdit;
$('#edRecalcBtn').onclick = recalcScores;

$('#rowOkBtn').onclick = applyRowEdit;
$('#rowCancelBtn').onclick = () => { $('#dlgRow').close(); rowBeingEdited = null; };
$('#rowDeleteBtn').onclick = deleteRow;

/* ---------------- export ---------------- */

function exportName(m, ext) {
  const clean = `${m.team1Name} vs ${m.team2Name} ${m.date || ''}`
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'match';
  return 'Scoresheet_' + clean + '.' + ext;
}

function sheetText(m) {
  let s = `${m.team1Name} vs ${m.team2Name}\n${m.date || ''}\n`;
  s += `${m.team1Name} : ${m.team1Score}\n${m.team2Name} : ${m.team2Score}\n`;
  s += (isDraw(m) ? 'Match Draw' : 'Winner: ' + m.winner) + '\n';
  s += rulesLine(m) + '\n';

  let half = null;
  sheetRows(m).forEach(r => {
    if (r.half !== half) {
      half = r.half;
      s += `\n========== ${sectionLabel(m, r.halfIndex)} ==========\n`;
      s += 'Batch | Wicket | Time | Type\n';
    }
    s += `${r.firstOfBatch ? r.batch : ''} | ${r.label} | ${r.time} | ${r.type}\n`;
  });

  s += `\n---- Wickets Taken — Match Total ----\n`;

  matchSummary(m, sheetRows(m)).forEach(t => {
    s += `${t.name} — ${pairsText(t.pairs)}\n`;
  });

  return s;
}

function download(filename, body, mime) {
  const blob = body instanceof Blob ? body : new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================================================
   PDF

   Printing, downloading and sharing all hand out the same document, so what a
   referee prints is exactly what lands in somebody's WhatsApp.
   ============================================================ */

const M_LEFT = Pdf.MARGIN;
const PAGE_W = Pdf.PAGE.w - Pdf.MARGIN * 2;

/** Lays the score sheet out as a PDF and returns it as a Blob. */
function buildSheetPdf(m) {
  const d = Pdf.doc();

  d.text(`${m.team1Name} vs ${m.team2Name}`, { size: 17, bold: true, gapAfter: 1 });

  const cat = m.category || 'Open';
  d.text([m.date || '', m.teamType ? `${m.teamType} ${cat}` : cat,
    m.minutesPerHalf ? `${m.minutesPerHalf} min halves` : '']
    .filter(Boolean).join('   -   '), { size: 9, gapAfter: 6 });

  d.text(`${m.team1Name} ${m.team1Score}   -   ${m.team2Score} ${m.team2Name}`,
    { size: 13, bold: true, gapAfter: 2 });

  d.text(isDraw(m) ? 'Match Draw' : `Winner: ${m.winner}`, { size: 11, bold: true });
  d.text(rulesLine(m), { size: 8 });
  d.rule();

  // ---- ball by ball, split by half ----
  const COLS = [
    ['Batch', M_LEFT, 60],
    ['Wicket', M_LEFT + 65, 250],
    ['Time', M_LEFT + 325, 80],
    ['Type', M_LEFT + 410, PAGE_W - 410]
  ];

  const rows = sheetRows(m);
  let half = null;

  rows.forEach(r => {
    if (r.half !== half) {
      half = r.half;
      d.gap(6);
      d.text(sectionLabel(m, r.halfIndex), { size: 10, bold: true, gapAfter: 2 });
      d.row(COLS.map(c => [c[0], c[1], c[2]]), { size: 8, bold: true });
      d.rule();
    }

    d.row([
      [r.firstOfBatch ? r.batch : '', COLS[0][1], COLS[0][2]],
      [r.label, COLS[1][1], COLS[1][2]],
      [r.time, COLS[2][1], COLS[2][2]],
      [r.type, COLS[3][1], COLS[3][2]]
    ]);
  });

  if (!rows.length) d.text('No ball-by-ball data recorded', { size: 9 });

  // ---- wickets taken, whole match ----
  d.gap(10);
  d.rule();
  d.text('Wickets Taken - Match Total', { size: 11, bold: true, gapAfter: 3 });

  const totals = matchSummary(m, rows);

  if (!totals.length) {
    d.text('None', { size: 9 });
  } else {
    totals.forEach(t => {
      d.text(t.name, { size: 9, bold: true, gapAfter: 0 });
      d.text(pairsText(t.pairs), { size: 9, x: M_LEFT + 12, gapAfter: 4 });
    });
  }

  return d.build();
}

/** The sheet as a File, ready to share or save. */
function sheetPdfFile(m) {
  return new File([buildSheetPdf(m)], exportName(m, 'pdf'), { type: 'application/pdf' });
}

$('#printBtn').onclick = () => {
  if (!detailMatch) return;

  // print the PDF itself rather than the page, so the paper copy matches the
  // file people are sent
  const url = URL.createObjectURL(buildSheetPdf(detailMatch));
  const w = window.open(url, '_blank');

  if (!w) {
    // a blocked popup should still leave the referee able to print
    toast('Allow pop-ups to print, or use Download PDF', 4000);
    URL.revokeObjectURL(url);
    return;
  }

  w.addEventListener('load', () => { try { w.print(); } catch (e) { /* viewer prints */ } });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

$('#pdfBtn').onclick = () => {
  if (!detailMatch) return;
  download(exportName(detailMatch, 'pdf'), buildSheetPdf(detailMatch), 'application/pdf');
  toast('PDF downloaded');
};

$('#shareBtn').onclick = async () => {
  if (!detailMatch) return;

  const file = sheetPdfFile(detailMatch);
  const title = `${detailMatch.team1Name} vs ${detailMatch.team2Name}`;

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ title, files: [file] }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }

  // no file sharing here - hand over the PDF itself rather than a text copy
  download(file.name, file, 'application/pdf');
  toast('PDF downloaded - attach it to share', 4000);
};
