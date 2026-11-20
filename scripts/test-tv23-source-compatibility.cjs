'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const settings = {};
const context = vm.createContext({
    ViewParts: {},
    NativeBridge: { available: () => true },
    U: {
        lru: () => new Map(), parseUrl: (url) => URL.canParse(url) ? new URL(url) : null,
        sanitizeHeaders: () => null, drawable: (text) => text, listOf: (items) => items || [],
        store: { get: (key, fallback) => settings[key] ?? fallback, set: (key, value) => { settings[key] = value; } }
    }
});
function load(name, before, expose) {
    const source = fs.readFileSync(path.join(__dirname, '../js', name), 'utf8');
    if (before) {
        const end = source.lastIndexOf(before);
        assert(end >= 0);
        vm.runInContext(source.slice(0, end) + expose + source.slice(end), context, { filename: name });
    } else {
        vm.runInContext(source, context, { filename: name });
    }
}
load('stremio.js');
load('view-detail.js', '})(ViewParts);', `
    V.test = { rankStreams: rankStreams, visibleRows: visibleRows, filterOptions: filterOptions,
        nextSourceFor: nextSourceFor, pickLikeLast: pickLikeLast, setDetail: function (rows) {
            _d = { id: 'test', streams: rows.map(function (r) { return r.st; }), rankRows: rows, filter: {} };
        } };
`);
const { Stremio, ViewParts: { test } } = context;
const stream = (hash, filename, more = {}) => ({ infoHash: hash.repeat(40), behaviorHints: { filename }, ...more });
const av1 = stream('a', 'Sample.2160p.AV1.mkv');
const hi10 = stream('b', 'Sample.1080p.x264.Hi10P.mkv');
const h264 = stream('c', 'Sample.1080p.x264.AAC.mp4', { name: 'Provider AV1 x264', seeders: 0 });
const hevc = stream('d', 'Sample.1080p.HEVC.10-bit.mkv', { title: 'Sample 8 GB', seeders: 1 });
const unknown = stream('e', 'Sample.720p.mkv');
assert.equal(Stremio.incompatibleVideo(av1), 'AV1 video');
assert.equal(Stremio.incompatibleVideo(hi10), '10-bit H.264 video');
assert.equal(Stremio.incompatibleVideo({ title: '1080p AVC 10-bit' }), '10-bit H.264 video');
assert.equal(Stremio.incompatibleVideo({ title: '1080p AV1 / H.265' }), '');
assert.equal(Stremio.incompatibleVideo({ url: 'https://media.example/Sample%20av01.mp4?name=x264' }), 'AV1 video');
assert.equal(Stremio.incompatibleVideo({ url: 'https://av1.media.example?file=123' }), '');
assert.equal(Stremio.incompatibleVideo({ url: 'https://media.example/Sample.AV1.mp4', behaviorHints: { filename: 'video.mp4' } }), 'AV1 video');
assert.equal(Stremio.incompatibleVideo({ description: '1080p AVC 10-bit', behaviorHints: { filename: 'Sample.x264.mkv' } }), '10-bit H.264 video');
assert.equal(Stremio.incompatibleVideo({ description: '1080p AVC 10-bit', behaviorHints: { filename: 'Sample.x264.8-bit.mkv' } }), '');
assert.equal(Stremio.incompatibleVideo({ description: '1080p AVC 10-bit', behaviorHints: { filename: 'Sample.1080p.8-bit.mkv' } }), '');
assert.equal(Stremio.incompatibleVideo({ description: '1080p AVC', behaviorHints: { filename: 'Sample.1080p.10-bit.mkv' } }), '10-bit H.264 video');
assert.equal(Stremio.incompatibleVideo({ url: 'https://media.example/download/8-bit', behaviorHints: { filename: 'Sample.x264.10-bit.mkv' } }), '10-bit H.264 video');
assert.equal(Stremio.incompatibleVideo({ url: 'https://media.example/download/HEVC-10-bit', behaviorHints: { filename: 'Sample.x264.mkv' } }), '');
['avc1', 'hvc1', 'hev1'].forEach(codec => {
    assert.equal(Stremio.incompatibleVideo({ description: '1080p AV1', behaviorHints: { filename: 'Sample.' + codec + '.8-bit.mp4' } }), '');
});
assert.equal(Stremio.incompatibleVideo({ title: 'AV1', behaviorHints: { filename: 'Sample.1080p.VP9.webm' } }), '');
assert.equal(Stremio.incompatibleVideo({ title: 'VP9 / AV1' }), '');
assert.equal(Stremio.incompatibleVideo({ title: 'WVC1 / AV1' }), '');
assert.equal(Stremio.incompatibleVideo({ title: 'AV1', behaviorHints: { filename: 'Sample.MJPG.avi' } }), '');
[h264, hevc, unknown].forEach(source => assert.equal(Stremio.incompatibleVideo(source), ''));

const rows = test.rankStreams([av1, hi10, h264, hevc, unknown], 'test');
test.setDetail(rows);
const visible = test.visibleRows(rows, Stremio.getPrefs());
assert.equal(visible.length, 3);
assert.deepEqual(Array.from(test.filterOptions('res', visible), option => [option[0], option[2]]), [['1080', 2], ['720', 1]]);
assert.equal(test.pickLikeLast('test', [av1, hi10, h264]), h264);
assert.equal(test.pickLikeLast('test', [av1, hi10]), null);
Stremio.setPref('hideIncompatible', false);
assert.equal(test.visibleRows(rows, Stremio.getPrefs()).length, 5);
assert.equal(test.nextSourceFor([Stremio.sourceId(h264), Stremio.sourceId(hevc), Stremio.sourceId(unknown)], []), null);

const keys = ['p:1080|h264|8|sdr'];
const formatSample = { title: 'Sample.1080p.x264.AAC.mp4' };
['', 'NETWORK', 'TIMEOUT', 'PLAYER_ERROR_GENEREIC', 'PLAYER_ERROR_CONNECTION_FAILED'].forEach((error, i) => {
    Stremio.recordFormats(keys, false, error, 'file' + i);
});
assert.equal(Stremio.badFormats(formatSample).length, 0);
assert.equal(Stremio.formatList().length, 0);
Stremio.recordFormats(keys, false, 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT', 'file1');
Stremio.recordFormats(keys, false, 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT', 'file2');
assert.equal(Stremio.badFormats(formatSample).length, 1);
Stremio.recordFormats(keys, true);
assert.equal(Stremio.badFormats(formatSample).length, 0);

async function testTorrentProgress() {
    const timers = new Map();
    const messages = [];
    let nextTimer = 0;
    let finish;
    let fail;
    const util = fs.readFileSync(path.join(__dirname, '../js/util.js'), 'utf8');
    vm.runInContext(util.slice(util.indexOf('    function cancelToken()'), util.indexOf('    function isHidden()')) + '\nU.cancelToken = cancelToken;', context);
    context.window = {};
    context.setTimeout = callback => { timers.set(++nextTimer, callback); return nextTimer; };
    context.clearTimeout = id => timers.delete(id);
    context.U.spinner = (on, message) => messages.push(message);
    context.NativeBridge.torrentStatus = cancel => new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
        cancel.onCancel(() => resolve({ active: true, metadata: false, peers: 99 }));
    });
    load('player-core.js', '})(PlayerParts);', 'P.watchTorrentStartup = watchTorrentStartup;');
    async function advance(status) {
        const [id, cb] = [...timers][0];
        timers.delete(id);
        cb();
        if (status) { finish(status); }
        await Promise.resolve();
    }
    const cancel = context.U.cancelToken();
    const stop = context.PlayerParts.watchTorrentStartup(cancel);
    await advance({ active: true, metadata: false, peers: 0 });
    assert.match(messages.at(-1), /0 peers connected/);
    await advance();
    fail(new Error('Transient status failure'));
    await Promise.resolve();
    assert.equal(timers.size, 1);
    await advance({ active: true, metadata: false, peers: 1 });
    assert.match(messages.at(-1), /1 peer connected/);
    await advance({ active: true, metadata: true, peers: 5 });
    assert.match(messages.at(-1), /Preparing torrent file/);
    await advance();
    cancel.cancel();
    await Promise.resolve();
    assert.equal(timers.size, 0);
    assert.equal(messages.length, 3);
    stop();
}

testTorrentProgress().then(() => {
    console.log('TV23 source lists, fallback, format learning and torrent status polling passed.');
}, error => { console.error(error); process.exitCode = 1; });
