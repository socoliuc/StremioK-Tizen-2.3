const fs = require('fs'), path = require('path'), {spawn, execFileSync} = require('child_process');
const base = path.resolve(__dirname, '..');
const source = path.join(base, '.build/bearssl');
const build = path.join(base, '.build/bearssl-arm');
const bin = path.join(base, '.build/pepper_37/toolchain/win_arm_newlib/bin');
fs.mkdirSync(build, {recursive: true});
function list(dir) {return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? list(path.join(dir,e.name)) : [path.join(dir,e.name)]);}
const files = list(path.join(source, 'src')).filter(p => p.endsWith('.c'));
if (new Set(files.map(p => path.basename(p))).size !== files.length) throw Error('Object name collision');
const relative = file => path.relative(base, file);
const args = ['-std=c99', '-O2', '-DBR_USE_URANDOM=0', '-DBR_USE_WIN32_RAND=0', '-DBR_USE_RDRAND=0', '-DBR_USE_GETENTROPY=0', '-I', relative(path.join(source,'inc')), '-I', relative(path.join(source,'src'))];
let index = 0, count = 0;
async function worker() {
  while (index < files.length) {
    const file = files[index++], target = path.join(build, path.basename(file, '.c') + '.o');
    await new Promise((resolve,reject) => {
      const child = spawn(path.join(bin,'arm-nacl-gcc.exe'), [...args, '-c', relative(file), '-o', relative(target)], {cwd:base,windowsHide: true});
      let error = ''; child.stderr.on('data', b => error += b);
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(Error(path.basename(file) + ': ' + error)));
    });
    if (++count % 50 === 0) console.log('Compiled ' + count + '/' + files.length);
  }
}
(async () => {
  await Promise.all(Array.from({length: 4},worker));
  execFileSync(path.join(bin,'arm-nacl-ar.exe'), ['rcs', 'libbearssl.a', ...files.map(file => path.basename(file, '.c') + '.o')], {cwd: build, windowsHide: true});
  console.log('ARM NaCl BearSSL library built: ' + files.length + ' files.');
})().catch(e => {console.error(e.message); process.exitCode=1;});
