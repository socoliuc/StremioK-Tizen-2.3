import {BtEngine} from '../.build/jstorrent/packages/engine/src/core/bt-engine'
import {MemoryConfigHub} from '../.build/jstorrent/packages/engine/src/config/memory-config-hub'
import {SparseCache} from './sparse-cache'
import {NativeServer,NativeTcp} from './socket-adapter'
import {cacheBudget} from './cache-budget'
import {trackerSockets} from './tracker-sockets'
declare const TVNet:any
const encode=(s:string)=>new TextEncoder().encode(s)
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms))
const exact=(b:Uint8Array)=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)
declare const TV23_CACHE_MIB:number
export const cache=new SparseCache(TV23_CACHE_MIB*1024*1024)
let engine:BtEngine|null=null,torrent:any=null,file:any=null,server:NativeServer|null=null,path='',epoch=0,verified=0,lastError='',phase=0
const clients=new Set<NativeTcp>(),pins=new Map<string,Set<number>>(),controllers=new Set<AbortController>()
let stopping:Promise<void>=Promise.resolve(),evictions=0,windowCount=1
let engineServers=new Set<NativeServer>()
function pieces(start:number,end:number){const result:number[]=[];if(!torrent)return result;for(let i=Math.floor(start/torrent.pieceLength);i<=Math.floor((end-1)/torrent.pieceLength);i++)result.push(i);return result}
function fileForPath(path:string){return torrent?.files.find((f:any)=>path===f.path||path.endsWith('/'+f.path))}
cache.originForPath=path=>fileForPath(path)?.offset??null
function mapping(path:string,start:number,end:number){if(!torrent?.hasMetadata)return null;const f=fileForPath(path);return f?pieces(f.offset+Math.max(0,start),f.offset+Math.min(end,f.length)):null}
function protectedPiece(index:number){for(const set of pins.values())if(set.has(index))return true;return false}
function trackerAllowed(value:string,allowLocal:boolean){
 const m=/^(https?|udp):\/\/([^\/:?#@]+)(?::[0-9]+)?(?:[\/?#]|$)/i.exec(value);if(!m||/[\r\n\x00]/.test(value))return false
 const host=m[2].toLowerCase().replace(/\.+$/,'');if(!/^[a-z0-9.-]+$/.test(host))return false;if(allowLocal)return true
 if(!host.includes('.')||host.endsWith('.local')||host.endsWith('.localhost')||host.endsWith('.lan')||host.endsWith('.home.arpa')||host.endsWith('.internal')||host.endsWith('.localdomain'))return false
 if(/^\d+\.\d+\.\d+\.\d+$/.test(host)){if(host.split('.').some(n=>! /^(0|[1-9][0-9]{0,2})$/.test(n)))return false;const a=host.split('.').map(Number);return a.every(n=>n>=0&&n<=255)&&a[0]!==0&&a[0]!==10&&a[0]!==127&&a[0]<224&&!(a[0]===169&&a[1]===254)&&!(a[0]===172&&a[1]>=16&&a[1]<=31)&&!(a[0]===192&&a[1]===168)&&!(a[0]===100&&a[1]>=64&&a[1]<=127)&&!(a[0]===192&&a[1]===0&&(a[2]===0||a[2]===2))&&!(a[0]===198&&(a[1]===18||a[1]===19))&&!(a[0]===198&&a[1]===51&&a[2]===100)&&!(a[0]===203&&a[1]===0&&a[2]===113)}
 if(/^(?:0x[a-f0-9]*|[0-9]+)$/i.test(host.split('.').pop()||''))return false
 return true
}
cache.canEvict=(path,start,end)=>{const list=mapping(path,start,end);return !!list?.length&&list.every(i=>torrent.hasPiece(i)&&!protectedPiece(i))}
cache.evicted=(path,start,end)=>{evictions++;const list=mapping(path,start,end)||[];for(const i of list){torrent.bitfield.set(i,false);cache.discardGlobal(i*torrent.pieceLength,(i+1)*torrent.pieceLength)}torrent._recalculateFirstNeededPiece();for(const f of torrent.files)f._downloaded=f.computeDownloaded();for(const peer of torrent.peers){torrent.buildPeerPieceIndex(peer);torrent.updateInterest(peer)}}
const hasher={async sha1(data:Uint8Array){return new Uint8Array(TVNet.hash(exact(data)))}}
;(crypto.subtle as any).digest=async(name:any,data:any)=>{if(String(typeof name==='string'?name:name?.name).toUpperCase()!=='SHA-1')throw new Error('Unsupported digest');return TVNet.hash(data instanceof ArrayBuffer?data:exact(data))}
function init(allowLocal:boolean){if(engine)return engine;const ownedServers=engineServers=new Set(),generation=epoch;const factory={...trackerSockets(ip=>trackerAllowed('http://'+ip,allowLocal),()=>generation===epoch),
 createTcpServer(){const s=new NativeServer();ownedServers.add(s);return s}};engine=new BtEngine({socketFactory:factory as any,fileSystem:cache as any,downloadPath:'/cache',hasher,port:0,startSuspended:true,logging:{level:'error'},onLog:()=>{},config:new MemoryConfigHub({maxGlobalPeers:10,maxPeersPerTorrent:10,maxUploadSlots:1,uploadSpeedUnlimited:false,uploadSpeedLimit:65536,activePieceMemoryLimitMiB:8,activeDownloads:1,activeSeeds:1,upnpEnabled:false,downloadManifest:false,dhtEnabled:true,encryptionPolicy:'allow',maxPipelineDepth:32,sendBufferWatermark:65536,maxWebSeedConnections:1} as any)});engine.on('error',()=>{lastError='engine'});engine.resume();return engine}
function demand(token:string,set:Set<number>|null){if(set)pins.set(token,set);else pins.delete(token);torrent?.updateStreamingDemand(token,set,'now')}
export function status(){return{phase,evictions,active:!!torrent,metadata:!!torrent?.hasMetadata,peers:torrent?.numPeers||0,verified,cacheBytes:cache.used,error:lastError}}
export function stop(){epoch++;for(const control of controllers)control.abort();controllers.clear();for(const client of [...clients])client.close();clients.clear();pins.clear();if(server){server.close();server=null}const old=torrent,oldEngine=engine,oldServers=engineServers;torrent=null;engine=null;engineServers=new Set();file=null;path='';oldEngine?.suspend();for(const s of oldServers)s.close();stopping=stopping.catch(()=>{}).then(async()=>{try{if(old&&oldEngine)await oldEngine.removeTorrent(old);if(oldEngine)await oldEngine.destroy()}finally{cache.clear();verified=0;lastError='';phase=0}});return stopping}
export async function prepare(message:any){
 await stop();phase=1;const generation=epoch,e=init(message.allowLocal===true);phase=2;let input:string|Uint8Array
 if(message.torrentBytes){input=Uint8Array.from(message.torrentBytes)}else{
  const hash=String(message.infoHash||'').toLowerCase();if(!/^[a-f0-9]{40}$/.test(hash))throw new Error('Invalid torrent hash')
  input='magnet:?xt=urn:btih:'+hash
  let trackerCount=0;for(const source of (message.sources||[]).slice(0,20)){const s=String(source).replace(/^tracker:/,'');if(trackerAllowed(s,message.allowLocal===true)){input+='&tr='+encodeURIComponent(s);trackerCount++}}
  if(!trackerCount)for(const tracker of ['udp://tracker.opentrackr.org:1337/announce','udp://open.stealth.si:80/announce'])input+='&tr='+encodeURIComponent(tracker)
  for(const peer of (message.peers||[]).slice(0,4))if(/^\d+\.\d+\.\d+\.\d+:\d+$/.test(peer))input+='&x.pe='+encodeURIComponent(peer)
 }
 const added=await e.addTorrent(input);if(generation!==epoch){if(added.torrent)await e.removeTorrent(added.torrent);throw new Error('Cancelled')}
 phase=3;torrent=added.torrent;if(!torrent)throw new Error('Torrent unavailable');torrent.on('piece',()=>{verified++})
 const deadline=Date.now()+110000;while(!torrent.hasMetadata){if(generation!==epoch)throw new Error('Cancelled');if(Date.now()>deadline)throw new Error('No torrent metadata or peers');await delay(250)}
 phase=4;const budget=cacheBudget(cache.limit,torrent.pieceLength,torrent.piecesCount);windowCount=budget.window
 let index=Number(message.fileIdx);if(!Number.isInteger(index)||index<0||index>=torrent.files.length){const videos=torrent.files.filter((f:any)=>/\.(mp4|mkv|avi|m4v|ts|mov|webm)$/i.test(f.path));videos.sort((a:any,b:any)=>b.length-a.length);index=(videos[0]||torrent.files[0])?.index}
 file=torrent.files[index];if(!file?.length)throw new Error('No playable file')
 for(const f of torrent.files)torrent.setFilePriority(f.index,f.index===index?0:1)
 // Prewarm in parallel. AVPlay can ask for the MP4 header/tail immediately;
 // each range reader still waits for SHA1-verified pieces before sending bytes.
 const initial=pieces(file.offset,file.offset+Math.min(file.length,1024*1024));demand('idle',new Set(initial));phase=5
 if(generation!==epoch)throw new Error('Cancelled')
 phase=6;path='/stream/'+Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('')+'/video.'+(file.path.split('.').pop()||'mp4')
 const clientLimit=budget.clients
 server=new NativeServer(true);server.on('connection',client=>{if(clients.size>=clientLimit){client.close();return}clients.add(client);serve(client,generation,clientLimit)});
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Loopback listener unavailable')),10000);server!.listen(0,()=>{clearTimeout(timer);resolve()})})
 phase=7;return{url:'http://127.0.0.1:'+server.port+path,length:file.length,fileIdx:index,name:file.filename,...status()}
}
function serve(client:NativeTcp,generation:number,clientLimit:number){
 const token='http:'+client.id;let header='',started=false,closed=false
 const abort=new AbortController();controllers.add(abort)
 const timer=setTimeout(()=>client.close(),15000)
 client.onClose(()=>{closed=true;clearTimeout(timer);abort.abort();controllers.delete(abort);clients.delete(client);if(torrent&&generation===epoch)demand(token,null)})
 client.onError(()=>client.close())
 client.onData(data=>{if(started)return;header+=new TextDecoder().decode(data);if(header.length>8192){client.close();return}if(!header.includes('\r\n\r\n'))return;started=true;clearTimeout(timer);void respond().catch(()=>client.close())})
 async function respond(){
  const first=/^(GET|HEAD) ([^ ]+) HTTP\/1\.[01]\r\n/.exec(header);if(!first||first[2]!==path){client.close();return}
  const length=file.length,range=/\r\nRange:\s*([^\r\n]+)/i.exec(header);let start=0,end=length-1
  if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range[1].trim());if(!m||(!m[1]&&!m[2]))throw new Error('Range');if(m[1]){start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]))}else start=Math.max(0,length-Number(m[2]));if(start>=length||start>end){client.send(encode('HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */'+length+'\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));await flush();client.close();return}}
  const mime=/\.mkv$/i.test(path)?'video/x-matroska':/\.ts$/i.test(path)?'video/mp2t':/\.webm$/i.test(path)?'video/webm':'video/mp4'
  const headers=['HTTP/1.1 '+(range?'206 Partial Content':'200 OK'),'Content-Type: '+mime,'Accept-Ranges: bytes','Content-Length: '+(end-start+1),'Connection: close'];if(range)headers.push('Content-Range: bytes '+start+'-'+end+'/'+length);headers.push('','');client.send(encode(headers.join('\r\n')))
  if(first[1]==='HEAD'){await flush();client.close();return}
  while(start<=end&&!closed&&generation===epoch){
   const firstPiece=Math.floor((file.offset+start)/torrent.pieceLength)
   const window=pieces(firstPiece*torrent.pieceLength,Math.min(file.offset+end+1,(firstPiece+windowCount)*torrent.pieceLength));demand(token,new Set(window));demand('idle',null)
   const count=Math.min(32768,end-start+1,torrent.pieceLength-((file.offset+start)%torrent.pieceLength)),needed=pieces(file.offset+start,file.offset+start+count)
   const local=torrent,timeout=setTimeout(()=>abort.abort(),90000);try{await local.waitForPieces(needed,abort.signal)}finally{clearTimeout(timeout)}
   if(closed||generation!==epoch)return
   const bytes=await local.readFileBytes(file.index,start,count);await flush();if(closed||generation!==epoch)return;client.send(bytes);start+=bytes.length
  }
  await flush(0);client.close()
 }
 async function flush(target=65536){while(!closed&&TVNet.queued(client.id)>target){await delay(10);if(generation!==epoch)throw new Error('Cancelled')}}
}
