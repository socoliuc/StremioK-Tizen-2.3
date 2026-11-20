const fs = require('fs'), path = require('path'), {spawn,execFileSync} = require('child_process');
const base = path.resolve(__dirname, '..'), src = path.join(base,'.build/quickjs-2026-06-04'), out = path.join(base,'.build/quickjs-arm');
const bin = path.join(base,'.build/pepper_37/toolchain/win_arm_newlib/bin');
fs.mkdirSync(out,{recursive:true});
// NaCl is single-threaded at this boundary. Atomics/SAB are unused by this engine.
const original = fs.readFileSync(path.join(src,'quickjs.c'),'utf8').replace(/\r\n/g,'\n');
fs.writeFileSync(path.join(out,'quickjs.c'),original
 .replace('#include <fenv.h>','#if !defined(__native_client__)\n#include <fenv.h>\n#endif')
 .replace('#elif defined(__EMSCRIPTEN__)\n    return 0;','#elif defined(__EMSCRIPTEN__) || defined(__native_client__)\n    return 0;')
 .replace('#if defined(_WIN32)\n    {\n        struct tm *tm;','#if defined(_WIN32) || defined(__native_client__)\n    {\n        struct tm *tm;')
 .replace('#if !defined(__EMSCRIPTEN__)\n#define CONFIG_ATOMICS','#if !defined(__EMSCRIPTEN__) && !defined(__native_client__)\n#define CONFIG_ATOMICS'));
const files = ['quickjs','dtoa','libregexp','libunicode','cutils'];
const relative = file => path.relative(base, file);
const args = ['-std=gnu11','-O2','-D_GNU_SOURCE','-DCONFIG_VERSION="2026-06-04"','-I',relative(src)];
(async()=>{
 await Promise.all(files.map(name=>new Promise((resolve,reject)=>{
  const child=spawn(path.join(bin,'arm-nacl-gcc.exe'),[...args,'-c',relative(path.join(name==='quickjs'?out:src,name+'.c')),'-o',relative(path.join(out,name+'.o'))],{cwd:base,windowsHide:true});
  let error='';child.stderr.on('data',b=>error+=b);child.on('error',reject);child.on('close',code=>{if(code)reject(Error(name+': '+error));else{console.log('Compiled '+name);resolve();}});
 })));
 execFileSync(path.join(bin,'arm-nacl-ar.exe'),['rcs',path.join(out,'libquickjs.a'),...files.map(n=>path.join(out,n+'.o'))],{windowsHide:true});
 console.log('QuickJS ARM NaCl library built.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
