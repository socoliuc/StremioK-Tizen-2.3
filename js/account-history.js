/* Read-only Stremio library state adapter. Times from the API are milliseconds.
   WatchedField layout/order follows Stremio/stremio-core (MIT); no cloud writes. */
var StremioHistory = (function () {
    'use strict';
    function number(n) { return typeof n === 'number' && isFinite(n) && n >= 0 ? Math.min(n, 604800000) : 0; }
    function time(s) { var n = typeof s === 'string' ? Date.parse(s) : 0; return n > 0 && isFinite(n) ? n : 0; }
    function cleanState(s) {
        s = s && typeof s === 'object' ? s : {};
        return { timeOffset: number(s.timeOffset), duration: number(s.duration), lastWatched: time(s.lastWatched) ? s.lastWatched : '',
            video_id: typeof s.video_id === 'string' ? s.video_id.slice(0, 200) : '', timesWatched: number(s.timesWatched), flaggedWatched: s.flaggedWatched === true || +s.flaggedWatched > 0 ? 1 : 0,
            watched: typeof s.watched === 'string' && s.watched.length <= 16384 ? s.watched : '' };
    }
    function build(items) {
        var view = { progress: {}, watched: {}, records: {}, history: [] };
        (items || []).forEach(function (x) {
            if (!x || !x._id || (x.type !== 'movie' && x.type !== 'series')) { return; }
            var s = cleanState(x.state), at = time(s.lastWatched) || time(x._mtime), key = x.type + ':' + x._id;
            view.records[key] = x;
            if (s.timeOffset > 0 && (!x.removed || x.temp) && (x.type === 'movie' || s.video_id)) {
                var id = x.type === 'series' ? s.video_id : x._id;
                var code = x.type === 'series' && id.match(/:(\d+):(\d+)$/);
                view.progress[x.type + ':' + id] = { id: id, type: x.type, parent: x.type === 'series' ? x._id : undefined,
                    name: x.name + (code ? '  S' + code[1] + 'E' + code[2] : ''), poster: x.poster,
                    position: Math.min(s.timeOffset, s.duration || s.timeOffset) / 1000, duration: s.duration / 1000, updated: at, _stremio: true };
            }
            if (x.type === 'movie' && (s.timesWatched > 0 || s.flaggedWatched) && at) { view.watched[key] = at; }
            // Stremio stores one last-watched timestamp per title, not per-episode dates.
            if (time(s.lastWatched) && s.timeOffset === 0 && (s.timesWatched > 0 || s.flaggedWatched || s.watched)) {
                view.history.push({ id: x._id, type: x.type, name: x.name, poster: x.poster, at: time(s.lastWatched) });
            }
        });
        return view;
    }
    function decode(meta, field) {
        var out = {};
        if (!meta || !Array.isArray(meta.videos) || meta.videos.length > 5000 || typeof field !== 'string' || field.length > 16384 || typeof pako === 'undefined') { return out; }
        var parts = field.split(':'), encoded = parts.pop(), len = +parts.pop(), anchor = parts.join(':');
        if (!anchor || len < 1 || len > 65536 || len !== Math.floor(len) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded || '')) { return out; }
        var videos = meta.videos.filter(function (v) { return v && typeof v.id === 'string'; }).slice();
        videos.sort(function (a, b) { return ((+a.season || 0) - (+b.season || 0)) || ((+a.episode || 0) - (+b.episode || 0)) || ((Date.parse(a.released) || 0) - (Date.parse(b.released) || 0)); });
        var ids = videos.map(function (v) { return v.id; }), anchorAt = ids.indexOf(anchor);
        if (anchorAt < 0) { return out; }
        try {
            var binary = atob(encoded), input = new Uint8Array(binary.length), chunks = [], total = 0, i;
            for (i = 0; i < binary.length; i++) { input[i] = binary.charCodeAt(i); }
            var inflate = new pako.Inflate({ chunkSize: 1024 });
            inflate.onData = function (chunk) { total += chunk.length; if (total > 8192) { throw new Error('Watched field too large'); } chunks.push(chunk); };
            inflate.push(input, true); if (inflate.err || !inflate.ended) { return out; }
            var bytes = new Uint8Array(total), at = 0;
            chunks.forEach(function (chunk) { bytes.set(chunk, at); at += chunk.length; });
            var offset = len - anchorAt - 1;
            ids.forEach(function (id, index) { var bit = index + offset; if (bit >= 0 && bit < total * 8 && ((bytes[Math.floor(bit / 8)] >> (bit % 8)) & 1)) { out[id] = true; } });
        } catch (ignore) { return {}; }
        return out;
    }
    return { cleanState: cleanState, build: build, decode: decode };
})();
