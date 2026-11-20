const fs=require('fs'),path=require('path'),esbuild=require('esbuild');
const base=path.resolve(__dirname,'..'),source=path.join(base,'native'),out=path.join(base,'.build/quickjs-arm');
function transform(args){let code=fs.readFileSync(args.path,'utf8');
 if(args.path.endsWith('parts-file.ts')){const before='this.data.set(index, data)';if(!code.includes(before))throw Error('Boundary storage reference drift');code=code.replace(before,'this.data.set(index, data.slice())')}
 if(args.path.endsWith('streaming-scheduler.ts')){const before='const effectivePriority = new Uint8Array(basePiecePriority)';if(!code.includes(before))throw Error('Streaming scheduler reference drift');code=code.replace(before,'const effectivePriority = new Uint8Array(piecesCount)');const idle='if (demands.length === 0) {\n    return {\n      effectivePriority: basePiecePriority,';if(!code.includes(idle))throw Error('Idle scheduler reference drift');code=code.replace(idle,'if (demands.length === 0) {\n    return {\n      effectivePriority: new Uint8Array(piecesCount),')}
 if(args.path.endsWith('torrent-content-storage.ts')){
  const before='): Promise<boolean> {\n    const torrentOffset = pieceIndex * this.pieceLength';
  if(!code.includes(before))throw Error('Verified write reference drift');
  code=code.replace(before,`): Promise<boolean> {
    if(expectedHash){
      const bytes=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
      const actual=new Uint8Array((globalThis as any).TVNet.hash(bytes));
      if(actual.length!==expectedHash.length||actual.some((b,i)=>b!==expectedHash[i])){const error=new Error('Piece hash mismatch');error.name='HashMismatchError';throw error;}
    }
    const torrentOffset = pieceIndex * this.pieceLength`);
  code=code.replace('await this.write(pieceIndex, 0, data)\n      return false','await this.write(pieceIndex, 0, data)\n      return !!expectedHash');
 }
 return{contents:code,loader:'ts'}
}
const plugin={name:'tv-native-adaptations',setup(build){
 build.onLoad({filter:/(streaming-scheduler|torrent-content-storage|parts-file)\.ts$/},transform);
 build.onResolve({filter:/^\.\/ipv4-country-data$/},()=>({path:path.join(base,'.build/jstorrent/packages/engine/src/geo/ipv4-country-data.stub.ts')}));
}};
if(require.main===module)esbuild.build({entryPoints:[path.join(source,'engine-entry.ts')],bundle:true,write:false,format:'iife',target:'es2020',platform:'neutral',mainFields:['main','module'],nodePaths:[path.join(base,'node_modules')],plugins:[plugin],define:{TV23_CACHE_MIB:String(Math.max(8,Math.min(32,Number(process.env.TV23_CACHE_MIB)||32))),'process.env.NODE_ENV':'"production"',JSTORRENT_VERSION:'"1.0.2-tv23"'},legalComments:'none',minify:true}).then(result=>{
 const code=result.outputFiles[0].text;fs.writeFileSync(path.join(out,'engine.js'),code);
 const bytes=Buffer.from(code);fs.writeFileSync(path.join(source,'engine-bundle.h'),'static const unsigned char engine_js[]={'+Array.from(bytes).join(',')+',0};\n');
 console.log(JSON.stringify({engineBundleBytes:bytes.length}));
}).catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={plugin,transform};
