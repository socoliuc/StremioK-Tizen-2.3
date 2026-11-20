/* Stremio's device-link QR flow. One-time addon import still revokes its temporary key.
   Settings > Stremio account explicitly retains a session in this app's TV storage,
   pulls library/addons, and revokes the key on sign-out. Passwords stay on Stremio's
   website. The cloud library and addon collection are never overwritten by sync.
   Global namespace: StremioAccount */
var StremioAccount = (function () {
    'use strict';
    var LINK = 'https://link.stremio.com/api/v2/', API = 'https://api.strem.io/api/';
    var POLL_MS = 3000, WAIT_MS = 5 * 60 * 1000, MAX_BYTES = 1048576;
    var SESSION_KEY = 'stremiok.account.session', LIBRARY_KEY = 'stremiok.account.library';
    var revision = 0, syncing = null, listeners = [], syncError = false;
    var emptyItems = [], viewItems = null, savedView = null, episodeViews = [];
    function session() { var x = U.store.get(SESSION_KEY, null); return x && typeof x.key === 'string' && x.key.length < 200 ? x : null; }
    function notify(change) { listeners.forEach(function (fn) { try { fn(change || {}); } catch (ignore) {} }); }
    function isConnected() { return !!session(); }
    function profile() { var x = session(); return x ? { label: x.label, syncedAt: x.syncedAt || 0, syncError: syncError } : null; }

    // A code to approve: { code, link }.
    function start() {
        return U.getJSON(LINK + 'create?type=Create', 15000, 65536).then(function (r) {
            var x = (r && r.result) || r || {};
            if (!/^[A-Za-z0-9]{2,16}$/.test(x.code || '') || !U.parseUrl(x.link)) { throw new Error('Stremio didn’t give a code'); }
            return { code: x.code, link: x.link };
        });
    }
    // The sign-in key once the code is approved on the phone; asked every POLL_MS until WAIT_MS
    // (an answer without one: not yet). stopped(): true once the screen asking has gone.
    function wait(code, stopped) {
        var until = Date.now() + WAIT_MS;
        return new Promise(function (resolve, reject) {
            function ask() {
                if (stopped && stopped()) { reject(new Error('stopped')); return; }
                if (Date.now() > until) { reject(new Error('The code expired: try again')); return; }
                U.getJSON(LINK + 'read?type=Read&code=' + encodeURIComponent(code), 15000, 65536).then(function (r) {
                    var key = r && r.result && r.result.authKey;
                    if (typeof key === 'string' && key && key.length < 200) { if (stopped && stopped()) { signOut(key); reject(new Error('stopped')); return; } resolve(key); return; }
                    setTimeout(ask, POLL_MS);
                }, function () { setTimeout(ask, POLL_MS); });   // (a dropped answer: asked again)
            }
            setTimeout(ask, POLL_MS);
        });
    }
    // POST a request to Stremio's API: its result.
    function call(method, body) {
        // The TV's browser TLS cannot reach every current Stremio endpoint.
        // The key only goes in a POST body to this fixed HTTPS API origin.
        if (typeof NativeBridge !== 'undefined' && NativeBridge.available && NativeBridge.available()) {
            return NativeBridge.getText(API + method, 20000, 8 * MAX_BYTES, null, { 'Content-Type': 'application/json' }, JSON.stringify(body)).then(function (text) {
                var data = JSON.parse(text);
                if (data && Object.prototype.hasOwnProperty.call(data, 'result')) { return data.result; }
                throw new Error('Stremio rejected this session. Reconnect in Settings.');
            });
        }
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest(), done = false;
            try { xhr.open('POST', API + method, true); } catch (e) { reject(new Error('couldn’t reach Stremio')); return; }
            xhr.timeout = 20000;
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onprogress = function (ev) {   // (an answer over MAX_BYTES: stopped as it arrives, as every other request is)
                if (!done && ev && ev.loaded > MAX_BYTES) { done = true; try { xhr.abort(); } catch (e) {} reject(new Error('too large an answer')); }
            };
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4 || done) { return; }
                done = true;
                var text = '' + (xhr.responseText || ''), data = null;
                if (text.length > MAX_BYTES) { reject(new Error('too large an answer')); return; }
                try { data = JSON.parse(text); } catch (e2) { data = null; }
                if (xhr.status >= 200 && xhr.status < 300 && data && data.result) { resolve(data.result); return; }
                reject(new Error((data && data.error && data.error.message) || ('HTTP ' + xhr.status)));
            };
            xhr.ontimeout = function () { if (!done) { done = true; reject(new Error('Stremio didn’t answer')); } };
            xhr.onerror = function () { if (!done) { done = true; reject(new Error('couldn’t reach Stremio')); } };
            try { xhr.send(JSON.stringify(body)); } catch (e3) { reject(new Error('couldn’t reach Stremio')); }
        });
    }
    // The account's addons StremioK can use: [{ url, name, description }] (a link on the
    // computer Stremio runs on, or that isn't a web address, left out).
    function addons(key) {
        return call('addonCollectionGet', { type: 'AddonCollectionGet', authKey: key, update: true }).then(function (r) {
            var seen = {};
            return (Array.isArray(r.addons) ? r.addons : []).map(function (a) {
                var url = a && typeof a.transportUrl === 'string' ? a.transportUrl.trim() : '', p = U.parseUrl(url), m = (a && a.manifest) || {};
                if (!p || /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?$)/i.test(p.host || '') || seen[url]) { return null; }
                seen[url] = 1;
                return { url: url, name: U.drawable('' + (m.name || p.host)).slice(0, 60), description: U.drawable('' + (m.description || '')).slice(0, 140) };
            }).filter(Boolean);
        });
    }
    // The key given up (Stremio's own sign-out): whatever happens, nothing is kept here.
    function signOut(key) { return call('logout', { type: 'Logout', authKey: key }).then(function () {}, function () {}); }

    function library() {
        if (!session()) { return []; }
        var saved = U.store.get(LIBRARY_KEY, []);
        return (Array.isArray(saved) ? saved : []).filter(function (x) { return x && !x.removed && !x.temp && (x.type === 'movie' || x.type === 'series') && typeof x._id === 'string' && typeof x.name === 'string'; }).slice(0, 1000).map(function (x) {
            return { id: x._id.slice(0, 200), type: x.type, name: x.name.slice(0, 200), poster: U.cardImage(x.poster, 'poster'), posterShape: x.posterShape || 'poster', _account: true };
        });
    }
    // Derived once per cached response, not once per episode/card. Account state is
    // an overlay: logging out never deletes this TV's own playback data.
    function historyView() {
        var items = session() ? U.store.get(LIBRARY_KEY, emptyItems) : emptyItems;
        if (!Array.isArray(items)) { items = emptyItems; }
        if (items !== viewItems) { viewItems = items; savedView = StremioHistory.build(items); episodeViews = []; }
        return savedView;
    }
    function progressFor(type, id) { return historyView().progress[type + ':' + id] || null; }
    function continueList() { var all = historyView().progress; return Object.keys(all).map(function (k) { return all[k]; }); }
    function watchedAt(type, id) {
        var at = historyView().watched[type + ':' + id] || 0;
        if (type === 'series') { episodeViews.forEach(function (v) { if ((v.id === id && v.complete) || (Object.prototype.hasOwnProperty.call(v.bits, id) && v.bits[id])) { at = Math.max(at, v.at); } }); }
        return at;
    }
    function hydrateWatched(meta) {
        var record = meta && historyView().records['series:' + meta.id];
        if (!record || !record.state || !record.state.watched) { return; }
        if (episodeViews.some(function (v) { return v.meta === meta; })) { return; }
        episodeViews = episodeViews.filter(function (v) { return v.id !== meta.id; });
        episodeViews.push({ id: meta.id, meta: meta, bits: StremioHistory.decode(meta, record.state.watched), at: Date.parse(record.state.lastWatched) || Date.parse(record._mtime) || 1 });
        if (episodeViews.length > 8) { episodeViews.shift(); }
    }
    function historySince(since) { return historyView().history.filter(function (h) { return h.at >= since; }); }
    function deriveSeriesCompletion(meta, all) {
        hydrateWatched(meta);
        var found = false;
        episodeViews.forEach(function (v) { if (v.id === meta.id) { v.complete = !!all; found = true; } });
        return found;
    }
    function sync() {
        var saved = session();
        if (!saved) { return Promise.resolve(); }
        if (syncing) { return syncing; }
        var generation = revision, key = saved.key;
        var task = Promise.all([addons(key), call('datastoreGet', { authKey: key, collection: 'libraryItem', ids: [], all: true })]).then(function (answers) {
            if (generation !== revision || !session() || session().key !== key) { return; }
            var list = answers[0], items = answers[1];
            if (!Array.isArray(items)) { throw new Error('Stremio library could not be read'); }
            // A bounded local copy, filtered to fields used by this client.
            var clean = items.filter(function (x) { return x && typeof x._id === 'string' && typeof x.name === 'string' && (x.type === 'movie' || x.type === 'series'); }).slice(0, 1000).map(function (x) {
                return { _id: x._id.slice(0, 200), name: x.name.slice(0, 200), type: x.type, poster: U.cardImage(x.poster, 'poster'), posterShape: x.posterShape, removed: !!x.removed, temp: !!x.temp, _mtime: x._mtime, state: StremioHistory.cleanState(x.state) };
            });
            clean.sort(function (a, b) { return (Date.parse(b._mtime) || 0) - (Date.parse(a._mtime) || 0); });
            var watchedBudget = 1000000;
            clean.forEach(function (x) { if (x.state.watched.length > watchedBudget) { x.state.watched = ''; } watchedBudget -= x.state.watched.length; });
            var libraryChanged = JSON.stringify(clean) !== JSON.stringify(U.store.get(LIBRARY_KEY, []));
            if (libraryChanged && U.store.set(LIBRARY_KEY, clean) === false) { throw new Error('The TV could not save your library'); }
            var changed = false, installed = Stremio.getAddonUrls();
            list.forEach(function (a) { if (installed.indexOf(a.url) !== -1) { return; } var added = Stremio.addAddon(a.url); if (added) { Stremio.setAddonOrigin(added, 'stremio'); changed = true; } });
            saved.syncedAt = Date.now(); U.store.set(SESSION_KEY, saved); syncError = false;
            // Consumers must see a committed local addon change even if the user
            // cancels while its manifest downloads are still pending.
            notify({ addonsChanged: changed, libraryChanged: libraryChanged });
            return (changed ? Stremio.refreshAddons() : Promise.resolve()).then(function () { return { addonsChanged: changed, libraryChanged: libraryChanged }; });
        });
        syncing = task.then(function (r) { if (syncing === wrapped) { syncing = null; } return r; }, function () { if (generation === revision) { syncError = true; notify(); } if (syncing === wrapped) { syncing = null; } throw new Error('Sync failed. Your saved TV library is still available.'); });
        var wrapped = syncing;
        return syncing;
    }
    function connect(key, stopped) {
        if (typeof key !== 'string' || !key || key.length >= 200) { return Promise.reject(new Error('Invalid Stremio session')); }
        var generation = revision;
        return call('getUser', { type: 'GetUser', authKey: key }).then(function (user) {
            if (generation !== revision || (stopped && stopped())) { signOut(key); throw new Error('Sign-in cancelled'); }
            var old = session(), label = user && (user.email || user.fullname || user.name);
            if (!user || typeof user !== 'object') { signOut(key); throw new Error('Stremio did not confirm your account'); }
            if (U.store.set(SESSION_KEY, { key: key, label: typeof label === 'string' ? label.slice(0, 120) : 'Stremio account', syncedAt: 0 }) === false) { signOut(key); throw new Error('The TV could not save your session'); }
            revision++; syncing = null; U.store.remove(LIBRARY_KEY); syncError = false;
            if (old && old.key !== key) { signOut(old.key); }
            notify();
            return sync().then(function (changes) {
                if ((stopped && stopped()) || !session() || session().key !== key) {
                    if (session() && session().key === key) { disconnect(); }
                    throw new Error('Sign-in cancelled');
                }
                return changes;
            });
        });
    }
    function disconnect() {
        var old = session(); revision++; syncing = null;
        U.store.remove(SESSION_KEY); U.store.remove(LIBRARY_KEY); syncError = false; notify();
        return old ? signOut(old.key) : Promise.resolve();
    }
    function cancelConnection(key) {
        var saved = session();
        return saved && saved.key === key ? disconnect() : signOut(key);
    }
    return { start: start, wait: wait, addons: addons, signOut: signOut, connect: connect, cancelConnection: cancelConnection, disconnect: disconnect, isConnected: isConnected, profile: profile, sync: sync, library: library,
        progressFor: progressFor, continueList: continueList, watchedAt: watchedAt, hydrateWatched: hydrateWatched, deriveSeriesCompletion: deriveSeriesCompletion, historySince: historySince, onChange: function (fn) { listeners.push(fn); } };
})();
