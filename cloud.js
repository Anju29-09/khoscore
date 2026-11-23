/* Signing in.
 *
 * The host signs in with Google so a tournament belongs to a person rather than
 * to a phone. Lose the phone, sign in on another one, carry on hosting. Scorers
 * never sign in; they join a room with a code.
 *
 * Two rules shape everything here:
 *
 * The app must work with none of this. KhoScore is used at grounds with no
 * signal, by people who will never sign in, and it has to start instantly and
 * score a match either way. So Firebase is fetched only when it is actually
 * wanted - on the sign-in tap, or at startup for somebody who has signed in
 * before - and every failure is quiet. Nothing here is allowed to break scoring.
 *
 * Nothing here is secret. These values are meant to sit in the page; anyone can
 * read them. What protects a tournament is the security rules on the server and
 * the list of domains allowed to sign in, not hiding this block.
 */
const Cloud = (() => {

  const CONFIG = {
    apiKey: 'AIzaSyDfvOEdLsvs_tVgaVl9_P_xvHF8XnWrWgQ',
    authDomain: 'khoscore.firebaseapp.com',
    projectId: 'khoscore',
    storageBucket: 'khoscore.firebasestorage.app',
    messagingSenderId: '211642702726',
    appId: '1:211642702726:web:8e3ce15d790f6fd4fa6a07'
  };

  const SDK = 'https://www.gstatic.com/firebasejs/11.6.0/';

  /** Remembers that this device has signed in, so the next start can restore it
   *  without every other device paying for a download it will never use. */
  const SEEN = 'cloudSeen';

  let parts = null;        // the loaded SDK, once it is up
  let loading = null;      // the load in flight, so two taps share one download
  let store = null;        // Firestore, loaded separately and only for rooms
  let storeLoading = null;
  let account = null;      // the signed-in user, or null
  let ready = false;       // true once Firebase has told us who is signed in

  const watchers = [];

  function tell() {
    watchers.forEach(fn => { try { fn(account); } catch (e) {} });
  }

  /** Fetches Firebase and wires up the sign-in watcher. Resolves to the SDK. */
  function load() {

    if (parts) return Promise.resolve(parts);
    if (loading) return loading;

    loading = (async () => {

      const appMod = await import(SDK + 'firebase-app.js');
      const authMod = await import(SDK + 'firebase-auth.js');

      const app = appMod.initializeApp(CONFIG);
      const auth = authMod.getAuth(app);

      parts = { app, auth, authMod };

      authMod.onAuthStateChanged(auth, user => {
        account = user;
        ready = true;

        // only remember a device that has actually signed in, so a passer-by who
        // opens the sign-in screen and changes their mind pays nothing later
        try {
          if (user) localStorage.setItem(SEEN, '1');
          else localStorage.removeItem(SEEN);
        } catch (e) {}

        tell();
      });

      // a sign-in that went the redirect route finishes here
      try { await authMod.getRedirectResult(auth); } catch (e) {}

      return parts;
    })();

    loading.catch(() => { loading = null; });   // a failed load may be retried

    return loading;
  }

  /**
   * Google's own sign-in window. Falls back to a full-page redirect where a
   * popup cannot open - some in-app browsers and locked-down phones block them.
   */
  async function signIn() {

    const { auth, authMod } = await load();
    const provider = new authMod.GoogleAuthProvider();

    try {
      await authMod.signInWithPopup(auth, provider);
      return true;

    } catch (e) {

      const code = (e && e.code) || '';

      // the person closed the window or tapped twice: not a failure
      if (code === 'auth/popup-closed-by-user'
          || code === 'auth/cancelled-popup-request') return false;

      if (code === 'auth/popup-blocked'
          || code === 'auth/operation-not-supported-in-this-environment') {
        await authMod.signInWithRedirect(auth, provider);
        return false;                       // the page is leaving; nothing to report
      }

      throw e;
    }
  }

  async function signOut() {
    const { auth, authMod } = await load();
    await authMod.signOut(auth);
  }

  /**
   * Restores the signed-in account at startup, but only on a device that has
   * signed in before. Everybody else gets the app they had yesterday: no
   * download, no delay, no network call.
   */
  function restore() {

    let seen = false;
    try { seen = localStorage.getItem(SEEN) === '1'; } catch (e) {}

    if (!seen) { ready = true; tell(); return; }

    load().catch(() => {
      // offline, or Firebase unreachable. The app carries on exactly as before;
      // the account comes back by itself next time there is a signal.
      ready = true;
      tell();
    });
  }

  /**
   * Firestore, where rooms live. A separate download from auth and a much
   * larger one, so it is fetched only when a tournament is actually shared.
   *
   * Offline reads and writes are kept on the device and sent when the signal
   * comes back - the reason this works at a ground at all.
   */
  function firestore() {

    if (store) return Promise.resolve(store);
    if (storeLoading) return storeLoading;

    storeLoading = (async () => {

      const { app } = await load();
      const fs = await import(SDK + 'firebase-firestore.js');

      let db;

      try {
        db = fs.initializeFirestore(app, {
          localCache: fs.persistentLocalCache({
            tabManager: fs.persistentMultipleTabManager()
          })
        });

      } catch (e) {
        // a second tab, a private window, or a browser that will not keep a
        // local copy: the room still works, it just forgets when offline
        db = fs.getFirestore(app);
      }

      store = { db, fs };
      return store;
    })();

    storeLoading.catch(() => { storeLoading = null; });

    return storeLoading;
  }

  /**
   * Whoever is using this device, as far as the server is concerned. A host is
   * signed in with Google; a scorer joining with a code gets an anonymous
   * identity, which is enough for the rules to tell devices apart and for the
   * host to remove one.
   */
  async function ensureUser() {

    const { auth, authMod } = await load();

    // Let a remembered sign-in come back first. Firebase restores it a moment
    // after loading, and deciding nobody is here before that would sign a host
    // in anonymously and shut them out of their own tournament.
    try { if (auth.authStateReady) await auth.authStateReady(); } catch (e) {}

    if (auth.currentUser) return auth.currentUser;

    const cred = await authMod.signInAnonymously(auth);
    return cred.user;
  }

  return {
    /** The signed-in user, or null. */
    user: () => account,

    /** True for a real Google account, false for a scorer's anonymous one. */
    isHost: () => !!account && !account.isAnonymous,

    uid: () => (account && account.uid) || '',

    firestore,
    ensureUser,

    /** True once we know one way or the other, so the screen can avoid a flicker. */
    ready: () => ready,

    /** The signed-in email, for showing on screen. */
    email: () => (account && account.email) || '',

    signIn,
    signOut,
    restore,

    /** Calls back whenever the signed-in account changes, and once right away. */
    watch(fn) {
      watchers.push(fn);
      try { fn(account); } catch (e) {}
    }
  };
})();
