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

  let live = null;        // { roomId, drawId, code, host, stopRecords, stopRoom }
  let pushTimer = null;
  let applying = false;   // true while writing an incoming record, to not echo it

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

  function code() { return live ? live.code : ''; }
  function isLive() { return !!live; }
  function liveDrawId() { return live ? live.drawId : ''; }
  function isHost() { return !!live && live.host === true; }

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
    if (!live || applying) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { push().catch(() => {}); }, 500);
  }

  async function push() {

    if (!live) return;

    const draw = Draws.byId(live.drawId);
    if (!draw) return;

    const { db, fs } = await Cloud.firestore();
    const mine = revs();
    const batch = fs.writeBatch(db);

    let count = 0;

    recordsFor(draw).forEach(rec => {

      // A joined device may only write score sheets. A batch is all or nothing,
      // so one draw or team record in it gets the whole batch refused - and the
      // score sheet thrown out along with it. They are left out here rather
      // than rejected there.
      if (!live.host && rec.kind !== 'match') return;

      const body = JSON.stringify(rec.data);

      // unchanged since the last push: leave it alone rather than spend a write
      if (mine[rec.id] && mine[rec.id].body === body) return;

      const rev = Date.now();

      batch.set(fs.doc(db, 'rooms', live.roomId, 'records', rec.id), {
        kind: rec.kind,
        rev,
        deleted: false,
        by: Cloud.uid(),
        data: rec.data
      });

      setRev(rec.id, { rev, body });
      count++;
    });

    if (!count) return;

    try {
      await batch.commit();
    } catch (e) {
      // a joined device trying to change the draw, or no signal. Either way the
      // local copy stands and the app carries on.
      if (e && e.code === 'permission-denied' && !live.host) {
        toast('Only the host can change this tournament', 3500);
      }
    }
  }

  /* ---------------- taking changes in ---------------- */

  function applyRecord(id, doc) {

    if (!doc || !doc.data) return false;

    const mine = revs();
    if (mine[id] && mine[id].rev >= doc.rev) return false;   // already have it

    applying = true;

    try {
      if (doc.kind === 'draw') {
        const list = Draws.all();
        const i = list.findIndex(d => d.id === id);

        if (doc.deleted) { if (i >= 0) list.splice(i, 1); }
        else if (i >= 0) list[i] = doc.data;
        else list.push(doc.data);

        Draws.save(list);

      } else if (doc.kind === 'team') {
        const list = Teams.all();
        const i = list.findIndex(t => t.id === id);

        if (doc.deleted) { if (i >= 0) list.splice(i, 1); }
        else if (i >= 0) list[i] = doc.data;
        else list.push(doc.data);

        Teams.save(list);

      } else if (doc.kind === 'match') {
        const list = Matches.all();
        const i = list.findIndex(m => m.id === id);

        if (doc.deleted) { if (i >= 0) list.splice(i, 1); }
        else if (i >= 0) list[i] = doc.data;
        else list.push(doc.data);

        Matches.save(list);

      } else {
        return false;
      }

    } finally {
      applying = false;
    }

    setRev(id, { rev: doc.rev, body: JSON.stringify(doc.data) });
    return true;
  }

  /* ---------------- being in a room ---------------- */

  const listeners = [];

  function tell(event) {
    listeners.forEach(fn => { try { fn(event); } catch (e) {} });
  }

  async function attach(roomId, drawId, roomCode, host) {

    const { db, fs } = await Cloud.firestore();

    stop();

    live = { roomId, drawId, code: roomCode, host, stopRecords: null, stopRoom: null };

    live.stopRecords = fs.onSnapshot(
      fs.collection(db, 'rooms', roomId, 'records'),
      snap => {
        let changed = 0;
        snap.docChanges().forEach(ch => {
          if (applyRecord(ch.doc.id, ch.doc.data())) changed++;
        });
        if (changed) tell({ type: 'records', changed });
      },
      () => {}
    );

    // the host ending the room, or the code being regenerated, arrives here
    live.stopRoom = fs.onSnapshot(
      fs.doc(db, 'rooms', roomId),
      snap => {
        const d = snap.data();
        if (!d) return;

        if (d.ended) { tell({ type: 'ended' }); forget(drawId); return; }
        if (d.code && live && d.code !== live.code) {
          if (live.host) { live.code = d.code; tell({ type: 'code' }); }
          else { tell({ type: 'ended', regenerated: true }); forget(drawId); }
        }
      },
      () => {}
    );

    tell({ type: 'joined' });
  }

  function stop() {
    if (!live) return;
    try { live.stopRecords && live.stopRecords(); } catch (e) {}
    try { live.stopRoom && live.stopRoom(); } catch (e) {}
    live = null;
  }

  function forget(drawId) {
    stop();
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

    await push();

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
  async function leave() {

    if (!live) return;

    const { roomId, drawId, host } = live;

    try {
      const { db, fs } = await Cloud.firestore();
      await fs.deleteDoc(fs.doc(db, 'rooms', roomId, 'members', Cloud.uid()));
    } catch (e) {}

    forget(drawId);

    if (!host) dropJoined(drawId);
  }

  /** Takes a tournament this device had only joined back off it. */
  function dropJoined(drawId) {

    const list = Draws.all();
    const i = list.findIndex(d => d.id === drawId);

    // live is already null by now, so this save starts no push
    if (i >= 0) { list.splice(i, 1); Draws.save(list); }

    const all = revs();
    delete all[drawId];
    DB.write(REVS, all);
  }

  /** Host only. Closes the room for everyone. */
  async function end() {

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
  async function regenerate() {

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
    forDraw, canEdit, code, isLive, isHost, liveDrawId,
    createFor, join, leave, end, regenerate, reopen, stop,
    tidyCode,
    watch(fn) { listeners.push(fn); }
  };
})();
