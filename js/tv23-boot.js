/* Temporary TV23 startup indicator. Never displays network URLs or error messages,
   which can contain account data. Normal runtime diagnostics remain in Settings. */
(function () {
    'use strict';
    var errors = [], panel, finished = false, ticks = 0;
    window.addEventListener('error', function (ev) {
        if (finished || errors.length >= 4) { return; }
        var name = (ev && ev.filename ? ev.filename : '').split('/').pop().split('?')[0];
        name = /^[a-z0-9_.-]+\.js$/i.test(name) ? name : 'script';
        errors.push(name + ':' + ((ev && ev.lineno) || '?'));
    }, false);
    var timer = setInterval(function () {
        if (!document.body) { return; }
        if (!errors.length && document.querySelector('.home-header')) {
            finished = true;
            if (panel && panel.parentNode) { panel.parentNode.removeChild(panel); }
            clearInterval(timer);
            return;
        }
        if (!panel) {
            panel = document.createElement('div');
            panel.style.cssText = 'position:fixed;z-index:99999;left:40px;top:40px;max-width:1700px;padding:24px;background:#151525;color:white;font:28px sans-serif;white-space:pre-wrap;';
            document.body.appendChild(panel);
        }
        panel.textContent = 'StremioK TV23 - ' + (errors.length ? 'Startup error: ' + errors.join(', ') : 'Starting...') +
            '\nPromise: ' + (typeof window.Promise === 'function' ? 'OK' : 'missing') +
            ' | Samsung player: ' + (window.webapis && window.webapis.avplay ? 'OK' : 'unavailable');
        if (++ticks >= 80) { clearInterval(timer); }
    }, 250);
})();
