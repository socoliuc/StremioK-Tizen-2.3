/* ES5 source health hints. No network probes are performed here. */
(function (root) {
    'use strict';
    var KEY = 'stremiok.sourceHealth.v1';
    var DAY = 24 * 60 * 60 * 1000;
    var MAX = 80;
    var TTL = 30 * DAY;
    var FAILURE_TTL = 6 * 60 * 60 * 1000;
    var SUCCESS_TTL = 7 * DAY;

    function number(v) {
        if (typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v) { return v; }
        if (typeof v === 'string') {
            var m = v.match(/^\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*([kKmM])?\s*$/), n;
            if (!m) { return null; }
            n = parseFloat(m[1].replace(/,/g, '') + (m[2] || ''));
            if (m[3]) { n *= m[3].toLowerCase() === 'k' ? 1000 : 1000000; }
            return isFinite(n) ? Math.floor(n) : null;
        }
        return null;
    }
    function parseSeeders(stream) {
        var b = stream && stream.behaviorHints || {}, keys = ['seeders', 'seederCount', 'seeder_count', 'seeds'];
        var i, n, d = stream && stream.description;
        for (i = 0; i < keys.length; i++) {
            n = number(stream && stream[keys[i]]);
            if (n === null) { n = number(b[keys[i]]); }
            if (n !== null) { return n; }
        }
        if (stream && stream.swarm) {
            n = number(stream.swarm.seeders);
            if (n !== null) { return n; }
        }
        if (typeof d === 'string') {
            var m = d.match(/(?:^|[\s|,;])seeders?\s*:\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*[kKmM]?)/i);
            if (m) { return number(m[1]); }
            m = d.match(/👤\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*[kKmM]?)/);
            if (m) { return number(m[1]); }
        }
        return null;
    }
    function sourceKey(stream) {
        var hash = stream && stream.infoHash, idx;
        if (!/^[a-f0-9]{40}$/i.test(hash || '')) { return ''; }
        if (stream.fileIdx == null) { idx = ''; }
        else if (typeof stream.fileIdx === 'number' && isFinite(stream.fileIdx) && Math.floor(stream.fileIdx) === stream.fileIdx && stream.fileIdx >= 0 && stream.fileIdx <= 1000000) { idx = String(stream.fileIdx); }
        else { return ''; }
        return hash.toLowerCase() + '|' + idx;
    }
    function create(storage, options) {
        options = options || {};
        var max = options.maxEntries || MAX, ttl = options.ttlMs || TTL, now = options.now || function () { return new Date().getTime(); };
        var loaded = false, entries = [], byKey = {};
        function load() {
            var time, raw, valid = [], i, x;
            if (loaded) { return; }
            loaded = true; time = now();
            try { raw = JSON.parse(storage.getItem(KEY) || '[]'); } catch (e) { raw = []; }
            if (Object.prototype.toString.call(raw) !== '[object Array]') { raw = []; }
            for (i = 0; i < raw.length; i++) {
                x = raw[i];
                if (!x || typeof x.k !== 'string' || !/^[a-f0-9]{40}\|(?:|\d{1,7})$/i.test(x.k) || (x.s !== 'ok' && x.s !== 'bad') || typeof x.t !== 'number' || !isFinite(x.t) || time - x.t > ttl || x.t > time) { continue; }
                if (x.k.split('|')[1] && parseInt(x.k.split('|')[1], 10) > 1000000) { continue; }
                if (byKey[x.k]) { continue; }
                valid.push({ k: x.k.toLowerCase(), s: x.s, t: x.t }); byKey[x.k.toLowerCase()] = valid[valid.length - 1];
            }
            valid.sort(function (a, b) { return b.t - a.t; });
            entries = valid.slice(0, max); byKey = {};
            for (i = 0; i < entries.length; i++) { byKey[entries[i].k] = entries[i]; }
            if (entries.length !== raw.length) { save(entries); }
        }
        function save(list) { try { storage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }
        function get(stream) {
            var k = sourceKey(stream), x, age;
            load();
            if (!k) { return null; }
            x = byKey[k]; if (!x) { return null; }
            age = now() - x.t;
            return age <= (x.s === 'bad' ? FAILURE_TTL : SUCCESS_TTL) ? x.s : null;
        }
        function label(stream) {
            var state = get(stream);
            return state === 'ok' ? 'Recently worked' : state === 'bad' ? 'Recent failure' : '';
        }
        function record(stream, outcome) {
            var k = sourceKey(stream), time = now(), list, i;
            if (!k || (outcome !== 'success' && outcome !== 'failure')) { return false; }
            load();
            list = entries.filter(function (x) { return x.k !== k; });
            list.unshift({ k: k, s: outcome === 'success' ? 'ok' : 'bad', t: time });
            entries = list.slice(0, max); byKey = {};
            for (i = 0; i < entries.length; i++) { byKey[entries[i].k] = entries[i]; }
            save(entries); return true;
        }
        function compare(a, b) {
            var as = parseSeeders(a), bs = parseSeeders(b), ah = get(a), bh = get(b);
            var at = [ah === 'bad' ? 0 : 1, as === null ? 1 : as === 0 ? 0 : 2, as === null ? 0 : as, ah === 'ok' ? 1 : 0];
            var bt = [bh === 'bad' ? 0 : 1, bs === null ? 1 : bs === 0 ? 0 : 2, bs === null ? 0 : bs, bh === 'ok' ? 1 : 0];
            var i;
            for (i = 0; i < at.length; i++) { if (at[i] !== bt[i]) { return bt[i] - at[i]; } }
            return 0;
        }
        return { seeders: parseSeeders, key: sourceKey, get: get, label: label, record: record, compare: compare };
    }
    var api = { create: create, parseSeeders: parseSeeders, sourceKey: sourceKey, storageKey: KEY, maxEntries: MAX, ttlMs: TTL };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    root.StremioSourceHealth = api;
}(this));
