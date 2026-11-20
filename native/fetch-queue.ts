/* Two bounded transfers; artwork leaves capacity for interactive metadata. */
export class FetchQueue {
 private waiting:Array<{message:any,deadline:number,timer:any}>=[]
 private active=0
 private artwork=0
 constructor(private run:(message:any)=>Promise<void>,private expired:(message:any)=>void){}
 push(message:any){
  if(this.waiting.length>=64)return false
  const timeout=Math.max(1000,Math.min(120000,Number(message.timeout)||15000))
  const entry={message,deadline:Date.now()+timeout,timer:null as any}
  entry.timer=setTimeout(()=>{const i=this.waiting.indexOf(entry);if(i<0)return;this.waiting.splice(i,1);this.expired(message);this.drain()},timeout)
  this.waiting.push(entry);this.drain();return true
 }
 cancel(id:number){const i=this.waiting.findIndex(e=>e.message.id===id);if(i<0)return;clearTimeout(this.waiting[i].timer);this.waiting.splice(i,1);this.drain()}
 private drain(){
  while(this.active<2&&this.waiting.length){
   let index=this.waiting.findIndex(e=>e.message.priority!=='image')
   if(index<0){if(this.artwork>=1)return;index=0}
   const entry=this.waiting.splice(index,1)[0],remaining=entry.deadline-Date.now()
   clearTimeout(entry.timer)
   if(remaining<=0){this.expired(entry.message);continue}
   entry.message.timeout=remaining
   const image=entry.message.priority==='image';this.active++;if(image)this.artwork++
   void Promise.resolve().then(()=>this.run(entry.message)).catch(()=>{}).finally(()=>{this.active--;if(image)this.artwork--;this.drain()})
  }
 }
}
