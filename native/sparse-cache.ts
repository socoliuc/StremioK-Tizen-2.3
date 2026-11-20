// Sparse, disposable RAM storage. Logical file length never allocates the movie.
const BLOCK=16384
interface Entry {size:number,origin:number|null,blocks:Map<number,Uint8Array>}
export class SparseCache {
 files=new Map<string,Entry>();dirs=new Set<string>(['','/','/cache']);used=0
 originForPath:(path:string)=>number|null=()=>null
 canEvict:(path:string,start:number,end:number)=>boolean=()=>false
 evicted:(path:string,start:number,end:number)=>void=()=>{}
 constructor(public limit=32*1024*1024){}
 private room(){
  if(this.used+BLOCK<=this.limit)return
  for(const [path,file] of this.files)for(const [index] of file.blocks){
   const start=index*BLOCK-(file.origin||0);if(!this.canEvict(path,start,start+BLOCK))continue
   this.evicted(path,start,start+BLOCK);if(file.blocks.delete(index))this.used-=BLOCK
   if(this.used+BLOCK<=this.limit)return
  }
  throw new Error('Streaming cache full')
 }
 async open(path:string,mode:string){
  let file=this.files.get(path);if(!file){if(mode==='r')throw new Error('ENOENT');file={size:0,origin:null,blocks:new Map()};this.files.set(path,file)}
  const fs=this,f=file
  return {
   async read(buffer:Uint8Array,offset:number,length:number,position:number){
    const count=Math.max(0,Math.min(length,f.size-position));let done=0
    while(done<count){const pos=position+done+(f.origin||0),index=Math.floor(pos/BLOCK),inside=pos%BLOCK,n=Math.min(count-done,BLOCK-inside),block=f.blocks.get(index);if(!block)throw new Error('Cache miss');buffer.set(block.subarray(inside,inside+n),offset+done);done+=n}return{bytesRead:count}
   },
   async write(buffer:Uint8Array,offset:number,length:number,position:number){
    if(!Number.isSafeInteger(position)||position<0||length<0||offset<0||offset+length>buffer.length)throw new Error('Invalid write')
    if(!f.blocks.size)f.origin=fs.originForPath(path)
    let done=0;while(done<length){const pos=position+done+(f.origin||0),index=Math.floor(pos/BLOCK),inside=pos%BLOCK,n=Math.min(length-done,BLOCK-inside);let block=f.blocks.get(index);if(!block){fs.room();block=new Uint8Array(BLOCK);f.blocks.set(index,block);fs.used+=BLOCK}block.set(buffer.subarray(offset+done,offset+done+n),inside);done+=n}f.size=Math.max(f.size,position+length);return{bytesWritten:length}
   },
   async truncate(length:number){f.size=length;for(const [i] of f.blocks)if(i*BLOCK>=(f.origin||0)+length){f.blocks.delete(i);fs.used-=BLOCK}},async sync(){},async close(){}
  }
 }
 async stat(path:string){const f=this.files.get(path),dir=this.dirs.has(path);if(!f&&!dir)throw new Error('ENOENT');return{size:f?.size||0,mtime:new Date(),isDirectory:dir,isFile:!!f}}
 async mkdir(path:string){this.dirs.add(path)}
 async exists(path:string){return this.files.has(path)||this.dirs.has(path)}
 async readdir(path:string){const prefix=path.replace(/\/$/,'')+'/';return [...new Set([...this.files.keys(),...this.dirs].filter(p=>p.startsWith(prefix)&&p!==path).map(p=>p.slice(prefix.length).split('/')[0]))]}
 async delete(path:string){const f=this.files.get(path);if(f){this.used-=f.blocks.size*BLOCK;this.files.delete(path)}this.dirs.delete(path)}
 async listTree(path:string){const prefix=path.replace(/\/$/,'')+'/';return [...this.files].filter(([p])=>p.startsWith(prefix)).map(([p,f])=>({path:p.slice(prefix.length),size:f.size}))}
 async batchDelete(path:string,entries:string[]){for(const name of entries)await this.delete(path+'/'+name);return []}
 async getFreeDiskSpace(){return this.limit-this.used}
 async writeAtomic(path:string,data:Uint8Array){await this.delete(path);const f=await this.open(path,'w');await f.write(data,0,data.length,0)}
 async verifyChunks(request:any){return new Uint8Array(request.chunkCount??Math.ceil(request.files.reduce((n:number,f:any)=>n+f.length,0)/request.chunkSize)).fill(2)}
 discardGlobal(start:number,end:number){for(const [,f] of this.files){if(f.origin===null)continue;for(const [i] of f.blocks)if(i*BLOCK>=start&&i*BLOCK<end){f.blocks.delete(i);this.used-=BLOCK}}}
 clear(){this.files.clear();this.dirs=new Set(['','/','/cache']);this.used=0}
}
