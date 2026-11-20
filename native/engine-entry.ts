import '../.build/jstorrent/packages/engine/src/adapters/native/polyfills'
import {BoundedHttpParser} from './http-parser'
import * as torrentRuntime from './torrent-runtime'
import {socketFactory,NativeTcp,onNet,closeAll} from './socket-adapter'
import {FetchQueue} from './fetch-queue'
declare const TVNet:any
const fetches=new Map<number,{abort:()=>void}>()
const queue=new FetchQueue(fetchOne,message=>TVNet.reply(message.id,0,'{}',new ArrayBuffer(0),'timeout'))
let preparing:number|null=null
let torrentChain:Promise<any>=Promise.resolve()
const torrentCommands=new Map<number,{cancelled:boolean}>()
function replyJSON(id:number,value:any){TVNet.reply(id,200,'{}',new TextEncoder().encode(JSON.stringify(value)).buffer,'')}
function prepareQueued(message:any){
 if(torrentCommands.size>=2){TVNet.reply(message.id,0,'{}',new ArrayBuffer(0),'busy');return}
 const command={cancelled:false};torrentCommands.set(message.id,command)
 torrentChain=torrentChain.catch(()=>{}).then(async()=>{
  if(command.cancelled){TVNet.reply(message.id,0,'{}',new ArrayBuffer(0),'cancelled');return}
  preparing=message.id
  try{const result=await torrentRuntime.prepare(message);if(command.cancelled){await torrentRuntime.stop();throw new Error('Cancelled')}replyJSON(message.id,result)}
  catch{await torrentRuntime.stop();TVNet.reply(message.id,0,'{}',new ArrayBuffer(0),'torrent-start')}
  finally{preparing=null}
 }).finally(()=>{torrentCommands.delete(message.id)})
}
function stopQueued(id:number){
 for(const command of torrentCommands.values())command.cancelled=true
 const immediate=torrentRuntime.stop()
 torrentChain=torrentChain.catch(()=>{}).then(()=>immediate).then(()=>torrentRuntime.stop())
 void torrentChain.then(()=>TVNet.reply(id,200,'{}',new ArrayBuffer(0),''),()=>TVNet.reply(id,0,'{}',new ArrayBuffer(0),'stop'))
}
async function fetchOne(message:any){
 let socket:any=null,timer:any=null,complete=false,size=0,head:any=null,chunks:Uint8Array[]=[]
 const finish=(error:string|null)=>{if(complete)return;complete=true;if(timer!==null)clearTimeout(timer);fetches.delete(message.id);socket?.close();if(error){TVNet.reply(message.id,0,'{}',new ArrayBuffer(0),error);return}const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length}TVNet.reply(message.id,head?.statusCode||0,JSON.stringify(head?.headers||{}),body.buffer,'')}
 const aborted=new Promise<void>(resolve=>fetches.set(message.id,{abort:()=>{finish('cancelled');resolve()}}))
 try{
  const url=new URL(message.url)
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||/[\r\n\x00]/.test(url.href))throw new Error('url')
  const timeout=Math.max(1,Math.min(120000,Number(message.timeout)||15000));timer=setTimeout(()=>finish('timeout'),timeout)
  socket=new NativeTcp();await socket.connect(Number(url.port)||(url.protocol==='https:'?443:80),url.hostname)
  if(complete){socket.close();return}
  if(url.protocol==='https:')await socket.secure(url.hostname)
  if(complete){socket.close();return}
  const max=Math.max(1,Math.min(8*1024*1024,Number(message.maxBytes)||5*1024*1024))
  const parser=new BoundedHttpParser(max)
  let resolveEnd:()=>void=()=>{}
  const end=new Promise<void>(resolve=>{resolveEnd=resolve})
  function events(items:any[]){for(const event of items){if(complete)break;if(event.type==='head'){head=event.head;if(head.contentLength!==null&&head.contentLength>max){finish('too-large');resolveEnd();return}}else if(event.type==='body'){size+=event.chunk.length;if(size>max){finish('too-large');resolveEnd();return}chunks.push(event.chunk.slice())}else if(event.type==='end'){finish(null);resolveEnd()}}}
  socket.onData((data:Uint8Array)=>{try{events(parser.push(data))}catch{finish('http');resolveEnd()}})
  socket.onError(()=>{finish('network');resolveEnd()})
  socket.onClose((error:boolean)=>{if(complete){resolveEnd();return}if(error){finish('network');resolveEnd();return}try{events(parser.close());if(!complete)finish('truncated')}catch{finish('http')}resolveEnd()})
  const body=message.body==null?'':String(message.body),payload=new TextEncoder().encode(body)
  const lines=[`${message.body==null?'GET':'POST'} ${url.pathname||'/'}${url.search||''} HTTP/1.1`,`Host: ${url.hostname}${url.port?':'+url.port:''}`,'Connection: close','Accept-Encoding: identity','User-Agent: StremioK-TV23/2.3']
  for(const [name,value] of Object.entries(message.headers||{})){if(!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)||/[\r\n\x00]/.test(String(value)))throw new Error('header');if(/^(host|connection|content-length|transfer-encoding|accept-encoding)$/i.test(name))continue;lines.push(name+': '+String(value))}
  if(message.body!=null)lines.push('Content-Length: '+payload.length)
  lines.push('','');socket.send(new TextEncoder().encode(lines.join('\r\n')));if(payload.length)socket.send(payload)
  await Promise.race([end,aborted])
 }catch{finish('network')}
}
const TVHost={
 onNet,
 handle(message:any){
  if(!message||!Number.isSafeInteger(message.id))return
  if(message.op==='cancel'){queue.cancel(message.id);fetches.get(message.id)?.abort();const command=torrentCommands.get(message.id);if(command)command.cancelled=true;if(preparing===message.id)void torrentRuntime.stop();return}
  if(message.op==='fetch'){if(!queue.push(message))TVNet.reply(message.id,0,'{}',new ArrayBuffer(0),'busy');return}
  if(message.op==='prepareTorrent'){prepareQueued(message);return}
  if(message.op==='stopTorrent'){stopQueued(message.id);return}
  if(message.op==='torrentStatus'){TVNet.reply(message.id,200,'{}',new TextEncoder().encode(JSON.stringify(torrentRuntime.status())).buffer,'');return}
  if(message.op==='shutdown'){void torrentRuntime.stop();closeAll();return}
  if(message.op==='engineInfo'){TVNet.reply(message.id,200,'{}',new TextEncoder().encode(JSON.stringify({engine:true,...torrentRuntime.status()})).buffer,'')}
 }
}
;(globalThis as any).TVHost=TVHost
