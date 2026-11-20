const fs = require('fs');
const path = require('path');
const vm = require('vm');
const acorn = require('acorn');
const root = path.resolve(process.argv[2]);
const failures = [];
function check(ok, message) { if (!ok) failures.push(message); }
const manifest = fs.readFileSync(path.join(root, 'config.xml'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
check(/required_version="2\.3"/.test(manifest), 'Requires a newer Tizen version');
check(!/feature\/web.service|<tizen:service|use.preview/.test(manifest), 'Contains unsupported background services');
check(/package="StrTzEs5v1"/.test(manifest), 'Trial must use a distinct package');
const scripts = [...html.matchAll(/<script[^>]+src="([^"?]+)(?:\?[^\"]*)?"/g)].map(m => m[1]);
check(scripts[0] === 'js/tv23-boot.js', 'Early diagnostic must load first');
check(scripts.indexOf('js/promise-polyfill.js') > -1 && scripts.indexOf('js/promise-polyfill.js') < scripts.indexOf('js/util.js'), 'Promise support must precede app code');
check(scripts.includes('$WEBAPIS/webapis/webapis.js'), 'Samsung AVPlay API must be loaded');
for (const name of fs.readdirSync(path.join(root, 'js')).filter(n => n.endsWith('.js'))) {
  try {
    const ast = acorn.parse(fs.readFileSync(path.join(root, 'js', name), 'utf8'), { ecmaVersion: 5, allowReserved: true, locations: true });
    // Acorn accepts block-level declarations as an ES5 extension; the old TV's
    // strict WebKit parser rejects them. A function body itself remains valid.
    function walk(node, parent, grandparent) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'FunctionDeclaration' && parent.type !== 'Program' &&
          !(parent.type === 'BlockStatement' && grandparent && /Function/.test(grandparent.type) && grandparent.body === parent)) {
        failures.push(name + ':' + node.loc.start.line + ' has a function declaration in a statement block');
      }
      for (const key in node) {
        if (key === 'loc') continue;
        const value = node[key];
        if (Array.isArray(value)) value.forEach(child => walk(child, node, parent));
        else if (value && typeof value === 'object') walk(value, node, parent);
      }
    }
    walk(ast, null, null);
  }
  catch (e) { failures.push(name + ' is not ES5: ' + e.message); }
}
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
check(/display:\s*-webkit-flex/.test(css), 'Layout lacks old WebKit flex prefix');
if (fs.existsSync(path.join(root, 'js/promise-polyfill.js'))) {
  const ctx = vm.createContext({setTimeout, clearTimeout, Promise: undefined, console});
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(root, 'js/promise-polyfill.js'), 'utf8'), ctx);
  vm.runInContext('Promise.all([Promise.resolve(3), Promise.resolve(4)]).then(function(v){if(v.join()!=="3,4")throw Error("Promise failure");})', ctx);
}
for (const issue of failures) console.error('FAIL: ' + issue);
console.log('Checked ES5 application scripts and TV23 boot requirements; failures=' + failures.length);
process.exitCode = failures.length ? 1 : 0;
