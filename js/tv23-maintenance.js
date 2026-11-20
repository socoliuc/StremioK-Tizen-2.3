/* Optional, time-bounded local test window. No network or permanent TV setting. */
(function () {
    'use strict';
    var meta = document.querySelector('meta[name="tv23-maintenance-until"]');
    var until = meta && Date.parse(meta.getAttribute('content')), timer = null;
    if (!until || until <= Date.now() || until - Date.now() > 6 * 60 * 60 * 1000) { return; }
    function screensaver(on) { try { webapis.appcommon.setScreenSaver(on ? 1 : 0, function () {}, function () {}); } catch (ignore) {} }
    function update() {
        if (Date.now() >= until) {
            if (timer !== null) { clearInterval(timer); timer = null; }
            document.removeEventListener('visibilitychange', update, false);
            if (typeof Player === 'undefined' || !Player.isActive()) { screensaver(true); }
            return;
        }
        if (typeof Player === 'undefined' || !Player.isActive()) { screensaver(!!document.hidden); }
    }
    update(); timer = setInterval(update, 30000);
    document.addEventListener('visibilitychange', update, false);
    window.addEventListener('unload', function () { if (timer !== null) { clearInterval(timer); } screensaver(true); }, false);
}());
