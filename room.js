/* Rooms: one tournament, shared across phones and laptops.
 *
 * The host opens a room for a draw and gets a code. Anyone with the code joins
 * and sees that tournament - its draw, the teams in it, and the score sheets
 * from its days. Nothing else of the host's goes with it.
 *
 * Three things decide the shape of all this:
 *
 * Records travel one at a time, never as a lump. Court 1's scorer saving a match
 * and Court 2's scorer saving a different one touch different records, so they
 * cannot land on each other. This is what the permanent tags are for.
 *
 * The draw belongs to the host. Joined devices read it and score matches; they
 * cannot pair teams, tick groups through or register teams. That is enforced by
 * the rules on the server, not by hiding buttons here.
 *
 * None of it is allowed to break scoring. Every call out is wrapped; a room that
 * cannot be reached leaves the app exactly as it was before rooms existed.
 */
const Room = (() => {

  /** Rooms this device belongs to, by draw: { [drawId]: {roomId, code, host} } */
  const KEY = 'rooms';

  /** What version of each record this device has, by tag: { [id]: rev } */
  const REVS = 'syncRevs';

  /** No O/0 or I/1: these get read aloud across a noisy ground. */
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  /**
   * Every room this device is connected to, by draw. All of them at once, and
   * from the moment the app starts - not only the one whose draw happens to be
   * on screen. A scorer opens the app and goes straight into a match; if a room
   * were connected only by visiting its draw screen first, that match would
   * never reach anybody and nobody else's would ever arrive.
   */
  const lives = new Map();   // drawId -> { roomId, drawId, code, host, stopRecords, stopRoom }

  let pushTimer = null;
  let applying = false;   // true while writing an incoming record, to not echo it
  let lastTrouble = '';   // the last thing the server complained about

  /** Rooms we have already tried to let back in, so one go is all it gets. */
  const healed = new Set();

  /* ---------------- what this device remembers ---------------- */

  const memberships = () => DB.read(KEY, {});
  const revs = () => DB.read(REVS, {});

  function remember(drawId, entry) {
    const all = memberships();
    if (entry) all[drawId] = entry; else delete all[drawId];
    DB.write(KEY, all);
  }

  function setRev(id, rev) {
    const all = revs();
    all[id] = rev;
    DB.write(REVS, all);
  }

  /** The room this draw belongs to on this device, if any. */
  function forDraw(drawId) {
    return memberships()[drawId] || null;
  }

  /**
   * Whether this device may change a draw. A draw nobody has shared is yours to
   * edit; a shared one belongs to its host. The server enforces this too - this
   * is only so the app can say so politely instead of failing silently.
   */
  function canEdit(drawId) {
    const m = forDraw(drawId);
    return !m || m.host === true;
  }

  /** The connected room for one draw, if this device is connected to it. */
  function liveFor(drawId) { return lives.get(drawId) || null; }

  function isLiveFor(drawId) { return lives.has(drawId); }
  function code(drawId) { const l = liveFor(drawId); return l ? l.code : ''; }
  function isLive() { return lives.size > 0; }
  function isHost(drawId) { const l = liveFor(drawId); return !!l && l.host === true; }

  /* ---------------- the code ---------------- */

  function makeCode() {
    let s = '';
    for (let i = 0; i < 8; i++) {
      s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return s.slice(0, 4) + '-' + s.slice(4);
  }

  /** Forgiving: people type spaces, lower case and miss the dash. */
  function tidyCode(text) {
    const bare = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return bare.length === 8 ? bare.slice(0, 4) + '-' + bare.slice(4) : bare;
  }

  /* ---------------- which records belong to a tournament ---------------- */

  /**
   * A tournament is its draw, the teams playing in it, and the score sheets from
   * its own days in its own side and age group. The host's other teams, other
   * tournaments and last season's sheets stay on the host's device.
   */
  function recordsFor(draw) {

    const out = [];

    out.push({ id: draw.id, kind: 'draw', data: draw });

    const inDraw = new Set();
    (draw.groups || []).forEach(g => (g.teams || []).forEach(n => inDraw.add(n.toLowerCase())));
    (draw.picked || []).forEach(n => inDraw.add(n.toLowerCase()));
    (draw.bracket || []).forEach(t => {
      if (t.a) inDraw.add(t.a.toLowerCase());
      if (t.b) inDraw.add(t.b.toLowerCase());
    });

    Teams.all().forEach(t => {
      if (!t.id) return;
      if ((t.teamType || '') !== draw.teamType) return;
      if ((t.category || '') !== draw.category) return;
      if (!inDraw.has((t.teamName || '').toLowerCase())) return;
      out.push({ id: t.id, kind: 'team', data: t });
    });

    const days = new Set(drawDates(draw).map(dateKey));

    Matches.all().forEach(m => {
      if (!m.id) return;
      if (!days.has(dateKey(m.date))) return;
      if ((m.teamType || 'Men') !== draw.teamType) return;
      if ((m.category || 'Open') !== draw.category) return;
      out.push({ id: m.id, kind: 'match', data: m });
    });

    return out;
  }

  /* ---------------- sending changes up ---------------- */

  /** Called after any local save. Waits a moment so a burst becomes one push. */
  function pushSoon() {
    if (!lives.size || applying) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushAll, 500);
  }

  /** A save may belong to any shared tournament, so offer it to every room. */
  function pushAll() {
    lives.forEach(live => { push(live).catch(() => {}); });
  }

  /**
   * Sends up whatever has changed. `serverHas`, when given, is the set of
   * record ids the room actually holds; anything of ours missing from it goes
   * up whatever this device believes about it.
   *
   * What counts as sent is only ever decided by the server taking it. Marking a
   * record sent before the commit - which is what this used to do - meant that
   * one refused upload silenced that score sheet for good: every push after it
   * saw an unchanged record and skipped it, and the app cheerfully reported
   * being up to date while the sheet sat on the device for ever.
   */
  async function push(live, serverHas) {

    if (!live || !lives.has(live.drawId)) return 0;

    const draw = Draws.byId(live.drawId);
    if (!draw) return 0;

    const { db, fs } = await Cloud.firestore();
    const mine = revs();
    const batch = fs.writeBatch(db);

    const staged = [];

    recordsFor(draw).forEach(rec => {

      // A joined device may only write score sheets. A batch is all or nothing,
      // so one draw or team record in it gets the whole batch refused - and the
      // score sheet thrown out along with it. They are left out here rather
      // than rejected there.
      if (!live.host && rec.kind !== 'match') return;

      const body = JSON.stringify(rec.data);
      const absent = !!serverHas && !serverHas.has(rec.id);

      // unchanged since the last push: leave it alone rather than spend a write
      if (!absent && mine[rec.id] && mine[rec.id].body === body) return;

      const rev = Date.now();

      try {
        batch.set(fs.doc(db, 'rooms', live.roomId, 'records', rec.id), {
          kind: rec.kind,
          rev,
          deleted: false,
          by: Cloud.uid(),

          // The record travels as text.
          //
          // A score sheet keeps one array of events per half, which makes an
          // array inside an array, and Firestore will not store those. It threw
          // the moment the write was staged - before any of this was sent - and
          // because that throw was synchronous it escaped every catch here and
          // was never reported. The sheets stayed on the device, the draw went
          // up perfectly well because it has no nested arrays, and the app said
          // there was nothing to send. As text there is nothing left to object
          // to: no nested arrays, and no undefined fields either.
          json: body
        });

      } catch (e) {
        // one record Firestore will not take must not silence the rest, and
        // must never again be invisible
        trouble(e, live.drawId);
        return;
      }

      staged.push({ id: rec.id, rev, body });
    });

    if (!staged.length) return 0;

    try {
      await batch.commit();

      // now, and only now, is it true that the room has these
      staged.forEach(x => setRev(x.id, { rev: x.rev, body: x.body }));
      return staged.length;

    } catch (e) {
      // Everything is reported, not only a refusal. A silent failure here is
      // what hid the real fault for a week: trouble also knows how to get a
      // device that has been forgotten back into the room. The records stay
      // unmarked either way, so the next push tries them again.
      trouble(e, live.drawId);
      return 0;
    }
  }

  /* ---------------- taking changes in ---------------- */

  function applyRecord(id, doc) {

    if (!doc) return false;

    // Records travel as text now. Anything already sitting in a room from
    // before that still arrives as a plain object, so both are read.
    let data = doc.data;

    if (typeof doc.json === 'string') {
      try { data = JSON.parse(doc.json); } catch (e) { return false; }
    }

    if (!data) return false;

    const mine = revs();
    if (mine[id] && mine[id].rev >= doc.rev) return false;   // already have it

    applying = true;

    try {
      if (doc.kind === 'draw') {
        const list = Draws.all();
        const i = list.findIndex(d => d.id === id);

        if (doc.deleted) { if (i >= 0) list.splice(i, 1); }
        else if (i >= 0) list[i] = data;
        else list.push(data);

        Draws.save(list);

      } else if (doc.kind === 'team') {
        const list = Teams.all();
        const i = list.findIndex(t => t.id === id);

        if (doc.deleted) { if (i >= 0) list.splice(i, 1); }
        else if (i >= 0) list[i] = data;
        else list.push(data);

        Teams.save(list);

      } else if (doc.kind === 'match') {
        const list = Matches.all();
        const i = list.findIndex(m => m.id === id);

        if (doc.deleted) { if (i >= 0) list.splice(i, 1); }
        else if (i >= 0) list[i] = data;
        else list.push(data);

        Matches.save(list);

      } else {
        return false;
      }

    } finally {
      applying = false;
    }

    setRev(id, { rev: doc.rev, body: JSON.stringify(data) });
    return true;
  }

  /* ---------------- being in a room ---------------- */

  const listeners = [];

  function tell(event) {
    listeners.forEach(fn => { try { fn(event); } catch (e) {} });
  }

  async function attach(roomId, drawId, roomCode, host) {

    // An identity first. Without one the server sees a stranger, and every
    // listener below fails quietly - which looks exactly like nothing syncing.
    await Cloud.ensureUser();

    const { db, fs } = await Cloud.firestore();

    stopOne(drawId);

    const live = { roomId, drawId, code: roomCode, host, stopRecords: null, stopRoom: null };
    lives.set(drawId, live);

    live.stopRecords = fs.onSnapshot(
      fs.collection(db, 'rooms', roomId, 'records'),
      snap => {
        let changed = 0;
        snap.docChanges().forEach(ch => {
          if (applyRecord(ch.doc.id, ch.doc.data())) changed++;
        });
        if (changed) tell({ type: 'records', changed, drawId });
      },
      err => trouble(err, drawId)
    );

    // the host ending the room, or the code being regenerated, arrives here
    live.stopRoom = fs.onSnapshot(
      fs.doc(db, 'rooms', roomId),
      snap => {
        const d = snap.data();
        if (!d) return;

        // The host closing the room, or issuing a new code, puts every other
        // device out. The tournament goes with them: the host keeps the sheets
        // and the teams, and a device that can no longer be updated should not
        // sit on a copy that will slowly go stale.
        if (d.ended) {
          const guest = !live.host;
          tell({ type: 'ended', drawId });
          forget(drawId);
          if (guest) dropJoined(drawId);
          return;
        }

        if (d.code && d.code !== live.code) {
          if (live.host) {
            live.code = d.code;
            tell({ type: 'code', drawId });
          } else {
            tell({ type: 'ended', regenerated: true, drawId });
            forget(drawId);
            dropJoined(drawId);
          }
        }
      },
      err => trouble(err, drawId)
    );

    healed.delete(drawId);
    tell({ type: 'joined', drawId });
  }

  /**
   * A listener that stops working is the one failure that must not be silent:
   * from the outside it looks exactly like nothing syncing, which is the hardest
   * thing of all to tell apart from a quiet afternoon.
   */
  function trouble(err, drawId) {

    const code = (err && err.code) || String(err || 'unknown');
    lastTrouble = code;

    // Refused because this device is not in the room any more. Nearly always an
    // anonymous identity that did not survive a restart: a fresh one means a uid
    // the room has never heard of, and then every read and write is refused.
    // The code is still here, so the way back in is simply to join again.
    if (code === 'permission-denied' && !healed.has(drawId) && canRejoin(drawId)) {
      healed.add(drawId);
      rejoin(drawId)
        .then(() => tell({ type: 'records', changed: 1, drawId }))
        .catch(() => tell({ type: 'trouble', code, drawId }));
      return;
    }

    tell({ type: 'trouble', code, drawId });
  }

  function canRejoin(drawId) {
    const m = forDraw(drawId);
    return !!(m && m.code);
  }

  /** Puts this device back in the room with the code it still holds. */
  async function rejoin(drawId) {

    const m = forDraw(drawId);
    if (!m || !m.code) throw new Error('no such code');

    stopOne(drawId);
    await join(m.code);
  }

  /**
   * Pulls the whole room from the server now, then sends up anything local that
   * has not gone yet. The live listener normally keeps up by itself; this is for
   * when it has not, and it is what the Refresh button and the pull-down run.
   */
  async function refresh(drawId) {

    if (!forDraw(drawId)) return 0;

    if (!lives.has(drawId)) await reopen(drawId);

    const live = liveFor(drawId);
    if (!live) return 0;

    let got;

    try {
      got = await pull(live);

    } catch (e) {

      // Forgotten by the room. Get back in with the code and pull again, rather
      // than telling a referee halfway through a tournament that they cannot.
      if ((e && e.code) !== 'permission-denied' || !canRejoin(drawId)) throw e;

      await rejoin(drawId);
      got = await pull(liveFor(drawId));
    }

    // Anything of ours the room does not hold goes up now, whatever this device
    // thinks it already sent. This is what rescues a sheet left behind by an
    // upload that failed earlier.
    let sent = 0;
    try { sent = await push(liveFor(drawId), got.ids); } catch (e) {}

    return got.changed + sent;
  }

  /**
   * Everything in the room, read from the server rather than the copy on this
   * device - a refresh that handed back what we already had would be no
   * refresh at all.
   */
  async function pull(live) {

    if (!live) return { changed: 0, ids: new Set() };

    const { db, fs } = await Cloud.firestore();
    const ref = fs.collection(db, 'rooms', live.roomId, 'records');

    const snap = fs.getDocsFromServer
      ? await fs.getDocsFromServer(ref)
      : await fs.getDocs(ref);

    let changed = 0;
    const ids = new Set();

    snap.forEach(d => {
      ids.add(d.id);
      if (applyRecord(d.id, d.data())) changed++;
    });

    return { changed, ids };
  }

  /** Refreshes every shared tournament. Returns how many records came in. */
  async function refreshAll() {

    let changed = 0;

    for (const drawId of Object.keys(memberships())) {
      try { changed += await refresh(drawId); }
      catch (e) { trouble(e, drawId); throw e; }
    }

    return changed;
  }

  /** Disconnects one room, leaving every other one alone. */
  function stopOne(drawId) {
    const live = lives.get(drawId);
    if (!live) return;
    try { live.stopRecords && live.stopRecords(); } catch (e) {}
    try { live.stopRoom && live.stopRoom(); } catch (e) {}
    lives.delete(drawId);
  }

  function stop() {
    [...lives.keys()].forEach(stopOne);
  }

  /**
   * Reconnects every tournament this device is sharing or has joined. Called
   * once when the app starts, so scoring syncs wherever the scorer begins and
   * other devices' sheets arrive without anyone opening the draw first.
   */
  async function restoreAll() {
    const ids = Object.keys(memberships());
    for (const drawId of ids) {
      try { await reopen(drawId); } catch (e) {}
    }
    return ids.length;
  }

  /** Disconnects and un-remembers one room. Every other room carries on. */
  function forget(drawId) {
    stopOne(drawId);
    remember(drawId, null);
  }

  /** Opens a room for a tournament. Host only; needs a signed-in account. */
  async function createFor(draw) {

    if (!Cloud.isHost()) throw new Error('sign-in required');

    const { db, fs } = await Cloud.firestore();
    const uid = Cloud.uid();

    const existing = forDraw(draw.id);
    if (existing) { await attach(existing.roomId, draw.id, existing.code, existing.host); return existing.code; }

    const roomId = Ids.make('r');
    const roomCode = makeCode();

    const batch = fs.writeBatch(db);

    batch.set(fs.doc(db, 'rooms', roomId), {
      hostUid: uid,
      drawId: draw.id,
      code: roomCode,
      tournament: draw.tournament || '',
      teamType: draw.teamType || '',
      category: draw.category || '',
      ended: false,
      createdAt: Date.now()
    });

    // The code doc carries everything joining needs. A room may only be read by
    // its members, so a joiner cannot look at the room first - that would need
    // to be a member before becoming one. The code is the capability.
    batch.set(fs.doc(db, 'codes', roomCode), {
      roomId,
      hostUid: uid,
      drawId: draw.id,
      tournament: draw.tournament || '',
      teamType: draw.teamType || '',
      category: draw.category || ''
    });
    batch.set(fs.doc(db, 'rooms', roomId, 'members', uid), { host: true, joinedAt: Date.now() });

    await batch.commit();

    remember(draw.id, { roomId, code: roomCode, host: true });
    await attach(roomId, draw.id, roomCode, true);

    // The first upload: the draw, its teams and the sheets already scored.
    // Without the room it has just attached to, this does nothing at all and a
    // joining device finds an empty room.
    await push(liveFor(draw.id));

    return roomCode;
  }

  /** Joins a tournament with a code. No account needed. */
  async function join(typed) {

    const wanted = tidyCode(typed);
    if (wanted.length !== 9) throw new Error('bad code');

    await Cloud.ensureUser();

    const { db, fs } = await Cloud.firestore();

    const codeDoc = await fs.getDoc(fs.doc(db, 'codes', wanted));

    // ending a session and regenerating a code both delete the code document,
    // so a code that no longer resolves is exactly a session that is over
    if (!codeDoc.exists()) throw new Error('no such code');

    const room = codeDoc.data();
    const roomId = room.roomId;

    const uid = Cloud.uid();
    const host = room.hostUid === uid;

    // membership first: only then may this device read the room itself
    await fs.setDoc(fs.doc(db, 'rooms', roomId, 'members', uid),
                    { host, joinedAt: Date.now() });

    let drawId = room.drawId;

    // a room opened before the code carried these details: now that this device
    // is a member, the room itself can be asked
    if (!drawId) {
      const roomDoc = await fs.getDoc(fs.doc(db, 'rooms', roomId));
      if (!roomDoc.exists()) throw new Error('no such room');

      const full = roomDoc.data();
      if (full.ended) throw new Error('ended');

      drawId = full.drawId;
      room.drawId = drawId;
      room.tournament = room.tournament || full.tournament || '';
    }

    remember(drawId, { roomId, code: wanted, host });
    await attach(roomId, drawId, wanted, host);

    return room;
  }

  /**
   * Leaves on this device only. The room itself carries on without it.
   *
   * A tournament this device merely joined belongs to the host, so leaving
   * takes it off this device along with what was remembered about syncing it -
   * otherwise a stale copy sits in the Draws list that nothing will ever update
   * again, and rejoining later would skip the records it thinks it has.
   *
   * The score sheets scored here are kept. They are a record of matches that
   * were really played, and throwing away a scorer's own afternoon because they
   * tapped Leave would be its own kind of bug.
   */
  async function leave(forDrawId) {

    const live = liveFor(forDrawId);
    if (!live) return;

    const { roomId, drawId, host } = live;

    try {
      const { db, fs } = await Cloud.firestore();
      await fs.deleteDoc(fs.doc(db, 'rooms', roomId, 'members', Cloud.uid()));
    } catch (e) {}

    forget(drawId);

    if (!host) dropJoined(drawId);
  }

  /**
   * Takes a tournament this device had only joined back off it: the draw, the
   * score sheets from its own days, and the teams that were playing in it. The
   * host keeps all of it - a joined device was only ever borrowing it.
   *
   * Two things are deliberately spared: anything another tournament still on
   * this device needs, and anything this device registered that the tournament
   * never covered. A scorer's own teams and their other weekends stay put.
   */
  function dropJoined(drawId) {

    const draw = Draws.byId(drawId);
    const others = Draws.all().filter(d => d.id !== drawId);

    if (draw) {

      /** Does another tournament here still play this side and age group? */
      const stillNeeded = (type, cat, day) => others.some(o => {
        if ((o.teamType || '') !== type || (o.category || '') !== cat) return false;
        if (day == null) return true;
        return new Set(drawDates(o).map(dateKey)).has(day);
      });

      const days = new Set(drawDates(draw).map(dateKey));

      // the score sheets from this tournament's own days
      Matches.save(Matches.all().filter(m => {

        const day = dateKey(m.date);
        const type = m.teamType || 'Men';
        const cat = m.category || 'Open';

        const belongs = days.has(day)
                     && type === draw.teamType
                     && cat === draw.category;

        return belongs ? stillNeeded(type, cat, day) : true;
      }));

      // the teams that were in it, by any route
      const inDraw = new Set();

      (draw.groups || []).forEach(g => (g.teams || []).forEach(n => inDraw.add(n.toLowerCase())));
      (draw.picked || []).forEach(n => inDraw.add(n.toLowerCase()));
      (draw.bracket || []).forEach(t => {
        if (t.a) inDraw.add(t.a.toLowerCase());
        if (t.b) inDraw.add(t.b.toLowerCase());
      });

      Teams.save(Teams.all().filter(t => {
        if (!inDraw.has((t.teamName || '').toLowerCase())) return true;
        return stillNeeded(t.teamType || '', t.category || '', null);
      }));
    }

    // and the draw itself
    const list = Draws.all();
    const i = list.findIndex(d => d.id === drawId);

    // this room is already disconnected, so these saves start no push to it
    if (i >= 0) { list.splice(i, 1); Draws.save(list); }

    const all = revs();
    delete all[drawId];
    DB.write(REVS, all);
  }

  /** Host only. Closes the room for everyone. */
  async function end(forDrawId) {

    const live = liveFor(forDrawId);
    if (!live || !live.host) return;

    const { roomId, drawId, code: old } = live;
    const { db, fs } = await Cloud.firestore();

    const batch = fs.writeBatch(db);
    batch.update(fs.doc(db, 'rooms', roomId), { ended: true, endedAt: Date.now() });
    batch.delete(fs.doc(db, 'codes', old));

    await batch.commit();

    forget(drawId);
  }

  /** Host only. New code, old one dead, everyone else dropped. */
  async function regenerate(forDrawId) {

    const live = liveFor(forDrawId);
    if (!live || !live.host) return '';

    const { roomId, old } = { roomId: live.roomId, old: live.code };
    const { db, fs } = await Cloud.firestore();

    const fresh = makeCode();

    const draw = Draws.byId(live.drawId) || {};

    const batch = fs.writeBatch(db);
    batch.delete(fs.doc(db, 'codes', old));
    batch.set(fs.doc(db, 'codes', fresh), {
      roomId,
      hostUid: Cloud.uid(),
      drawId: live.drawId,
      tournament: draw.tournament || '',
      teamType: draw.teamType || '',
      category: draw.category || ''
    });
    batch.update(fs.doc(db, 'rooms', roomId), { code: fresh });

    await batch.commit();

    live.code = fresh;
    remember(live.drawId, { roomId, code: fresh, host: true });

    return fresh;
  }

  /** Reconnects to a room this device already belongs to. */
  async function reopen(drawId) {
    const m = forDraw(drawId);
    if (!m) return false;
    await attach(m.roomId, drawId, m.code, m.host);
    return true;
  }

  /**
   * Every local save is a reason to send changes up. Wrapping the three storage
   * objects catches every path - registration, scoring, editing, the draw screen
   * - without a push call scattered through all of them.
   */
  (function watchSaves() {
    [[Teams, 'save'], [Matches, 'save'], [Draws, 'save']].forEach(([obj, name]) => {
      const original = obj[name].bind(obj);
      obj[name] = function (list) {
        const result = original(list);
        pushSoon();
        return result;
      };
    });
  })();

  return {
    forDraw, canEdit, code, isLive, isHost, isLiveFor,
    createFor, join, leave, end, regenerate, reopen, restoreAll,
    refresh, refreshAll, rejoin, lastTrouble: () => lastTrouble,
    stop, stopOne,
    tidyCode,
    watch(fn) { listeners.push(fn); }
  };
})();
