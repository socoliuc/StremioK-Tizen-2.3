import {socketFactory,resolveHost} from './socket-adapter'

/* Connect to the checked DNS result; the HTTP client still supplies the original TLS name. */
export function trackerSockets(allowed:(ip:string)=>boolean,active:()=>boolean){
 return{...socketFactory,
  async createTcpSocket(options:any={}){
   if(options.purpose!=='http-tracker')return socketFactory.createTcpSocket(options)
   const ip=await resolveHost(options.host)
   if(!active()||!allowed(ip))throw new Error('Tracker destination blocked')
   const socket=await socketFactory.createTcpSocket({...options,host:ip})
   if(!active()){socket.close();throw new Error('Cancelled')}
   return socket
  },
  async createUdpSocket(options:any={}){
   const socket=await socketFactory.createUdpSocket(options)
   if(!active()){socket.close();throw new Error('Cancelled')}
   if(options.purpose==='udp-tracker')socket.destinationGuard=ip=>active()&&allowed(ip)
   return socket
  }
 }
}
