const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const base=path.resolve(__dirname,'..'),src=path.join(base,'native'),out=path.join(base,'.build/quickjs-arm');
const compiler=path.join(base,'.build/pepper_37/toolchain/win_arm_newlib/bin/arm-nacl-gcc.exe');
const common=['-std=gnu11','-O2','-Wall','-Wextra','-Wno-unused-parameter','-I','.build/pepper_37/include','-I','.build/bearssl/inc','-I','.build/quickjs-2026-06-04'];
for(const name of ['host','net'])execFileSync(compiler,[...common,'-c',path.join('native',name+'.c'),'-o',path.relative(base,path.join(out,name+'.o'))],{cwd:base,stdio:'inherit',windowsHide:true});
const unstripped = path.join(out,'host-unstripped.nexe');
execFileSync(compiler,[path.join(out,'host.o'),path.join(out,'net.o'),path.join(out,'libquickjs.a'),path.join(base,'.build/bearssl-arm/libbearssl.a'),'-lppapi','-lm','-o',unstripped],{stdio:'inherit',windowsHide:true});
// SDK startup objects embed absolute toolchain paths in local/debug symbols.
const strip = path.join(path.dirname(compiler),'arm-nacl-strip.exe');
execFileSync(strip,['--strip-debug','--discard-all','-o',path.join(src,'host_arm.nexe'),unstripped],{stdio:'inherit',windowsHide:true});
console.log(JSON.stringify({nativeHostBytes:fs.statSync(path.join(src,'host_arm.nexe')).size}));
