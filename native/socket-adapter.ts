/* Native Pepper sockets exposed to the embedded torrent/HTTP engine. */
declare const TVNet: any
const tcpSockets = new Map<number, NativeTcp>()
const udpSockets = new Map<number, NativeUdp>()
const servers = new Map<number, NativeServer>()
const lookups = new Map<number, {resolve:(host:string)=>void,reject:(error:Error)=>void}>()
const dnsCache = new Map<string,{at:number,promise:Promise<string>}>()
const copyBuffer=(data:Uint8Array)=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)
export function resolveHost(host:string):Promise<string>{
 if(/^\d+\.\d+\.\d+\.\d+$/.test(host))return Promise.resolve(host)
 const cached=dnsCache.get(host);if(cached&&Date.now()-cached.at<60000)return cached.promise
 const promise=new Promise<string>((resolve,reject)=>{const id=TVNet.lookup(host);if(id<0){reject(new Error('DNS unavailable'));return}lookups.set(id,{resolve,reject})})
 dnsCache.set(host,{at:Date.now(),promise});if(dnsCache.size>64)dnsCache.delete(dnsCache.keys().next().value!);return promise
}
export class NativeTcp{
 id:number;remoteAddress?:string;remotePort?:number;isSecure=false;closed=false
 dataCb:((data:Uint8Array)=>void)|null=null;closeCb:((error:boolean)=>void)|null=null;errorCb:((error:Error)=>void)|null=null
 connectWait:any=null;secureWait:any=null;pendingData:Uint8Array[]=[];pendingClose:boolean|null=null
 constructor(id?:number,host?:string,port?:number){this.id=id??TVNet.open(0);if(this.id<0)throw new Error('Socket limit');this.remoteAddress=host;this.remotePort=port;tcpSockets.set(this.id,this)}
 connect(port:number,host:string){return new Promise<void>((resolve,reject)=>{this.connectWait={resolve,reject};const r=TVNet.connect(this.id,host,port);if(r<0){this.connectWait=null;reject(new Error('Connect failed'));this.close()}})}
 secure(host:string){return new Promise<void>((resolve,reject)=>{this.secureWait={resolve,reject};const r=TVNet.secure(this.id,host);if(r<0){this.secureWait=null;reject(new Error('TLS unavailable'));this.close()}})}
 send(data:Uint8Array){if(this.closed)throw new Error('Socket closed');if(TVNet.send(this.id,copyBuffer(data))<0){this.close();throw new Error('Socket send limit')}TVNet.resume(this.id)}
 onData(cb:(data:Uint8Array)=>void){this.dataCb=cb;for(const data of this.pendingData)cb(data);this.pendingData=[];if(!this.closed)TVNet.resume(this.id)}
 onClose(cb:(error:boolean)=>void){this.closeCb=cb;if(this.pendingClose!==null){const error=this.pendingClose;this.pendingClose=null;cb(error)}}
 onError(cb:(error:Error)=>void){this.errorCb=cb}
 close(){if(this.closed)return;this.closed=true;tcpSockets.delete(this.id);TVNet.close(this.id);this.connectWait?.reject(new Error('Socket closed'));this.secureWait?.reject(new Error('Socket closed'));this.connectWait=this.secureWait=null;if(this.closeCb)this.closeCb(false);else this.pendingClose=false}
 event(type:number,result:number,data:ArrayBuffer,host:string,port:number){
  if(type===1){this.remoteAddress=host;this.remotePort=port;const wait=this.connectWait;this.connectWait=null;if(result===0)wait?.resolve();else wait?.reject(new Error('Connect failed'));return}
  if(type===4){this.isSecure=result===0;const wait=this.secureWait;this.secureWait=null;if(!result)wait?.resolve();else wait?.reject(new Error('TLS failed'));return}
  if(type===2){const bytes=new Uint8Array(data);if(this.dataCb)this.dataCb(bytes);else{if(this.pendingData.reduce((n,b)=>n+b.length,0)+bytes.length>131072){this.close();return}this.pendingData.push(bytes)}return}
  if(type===3){this.closed=true;tcpSockets.delete(this.id);this.connectWait?.reject(new Error('Connect closed'));this.secureWait?.reject(new Error('TLS closed'));this.connectWait=this.secureWait=null;if(this.closeCb)this.closeCb(result<0);else this.pendingClose=result<0;return}
  if(type===9)this.errorCb?.(new Error('Native socket error'))
 }
}
export class NativeServer{
 constructor(private loopback=false){}
 id=0;port=0;connection:((socket:NativeTcp)=>void)|null=null;ready:(()=>void)|null=null
 listen(port:number,callback?:()=>void){this.ready=callback||null;this.id=TVNet.listen(port,this.loopback?1:0);if(this.id<0)throw new Error('Listen unavailable');servers.set(this.id,this)}
 address(){return this.port?{port:this.port}:null}
 on(_event:string,callback:(socket:NativeTcp)=>void){this.connection=callback}
 close(){if(this.id){TVNet.close(this.id);servers.delete(this.id);this.id=0}}
}
class NativeUdp{
 destinationGuard:((ip:string)=>boolean)|null=null
 id=TVNet.open(1);closed=false;message:((source:any,data:Uint8Array)=>void)|null=null;bound:any=null;queue:Array<{host:string,port:number,data:Uint8Array}>=[];sending=false
 constructor(){if(this.id<0)throw new Error('UDP limit');udpSockets.set(this.id,this)}
 bind(host:string,port:number){return new Promise<void>((resolve,reject)=>{this.bound={resolve,reject};if(TVNet.udpBind(this.id,host,port)<0){this.close();reject(new Error('UDP bind failed'))}})}
 onMessage(cb:(source:any,data:Uint8Array)=>void){this.message=cb;if(!this.closed)TVNet.resume(this.id)}
 send(host:string,port:number,data:Uint8Array){if(this.closed)return;if(this.queue.length>=32||data.length>65507)return;this.queue.push({host,port,data:data.slice()});void this.flush()}
 async flush(){if(this.sending)return;this.sending=true;try{while(!this.closed&&this.queue.length){const item=this.queue[0];try{const ip=await resolveHost(item.host);if(this.closed||(this.destinationGuard&&!this.destinationGuard(ip)))throw new Error('Destination blocked');let result=TVNet.udpSend(this.id,ip,item.port,copyBuffer(item.data));while(result===-4&&!this.closed){await new Promise(r=>setTimeout(r,3));result=TVNet.udpSend(this.id,ip,item.port,copyBuffer(item.data))}}catch{}this.queue.shift()}}finally{this.sending=false}}
 close(){if(this.closed)return;this.closed=true;this.queue=[];udpSockets.delete(this.id);TVNet.close(this.id);this.bound?.reject(new Error('UDP closed'));this.bound=null}
 joinMulticast(){return Promise.reject(new Error('Multicast disabled'))}
 leaveMulticast(){return Promise.resolve()}
}
export function onNet(type:number,id:number,result:number,data:ArrayBuffer,host:string,port:number){
 if(type===10){const wait=lookups.get(id);lookups.delete(id);if(result===0&&host)wait?.resolve(host);else wait?.reject(new Error('DNS failed'));return}
 const server=servers.get(id)
 if(server){if(type===5){if(result===0){server.port=port;server.ready?.()}else server.close()}else if(type===6){const socket=new NativeTcp(result,host,port);if(server.connection)server.connection(socket);else socket.close()}return}
 const udp=udpSockets.get(id)
 if(udp){if(type===7){const wait=udp.bound;udp.bound=null;if(result===0)wait?.resolve();else wait?.reject(new Error('UDP bind failed'))}else if(type===8)udp.message?.({addr:host,port},new Uint8Array(data));else if(type===3)udp.close();return}
 tcpSockets.get(id)?.event(type,result,data,host,port)
}
export const socketFactory={
 async createTcpSocket(options:any={}){const socket=new NativeTcp();if(options.host&&options.port)await socket.connect(options.port,options.host);return socket},
 async createUdpSocket(options:any={}){const socket=new NativeUdp();await socket.bind(options.bindAddr||'0.0.0.0',options.bindPort||0);return socket},
 createTcpServer(){return new NativeServer()},wrapTcpSocket(socket:NativeTcp){return socket}
}
export function closeAll(){for(const socket of [...tcpSockets.values()])socket.close();for(const socket of [...udpSockets.values()])socket.close();for(const server of [...servers.values()])server.close()}
