import {HttpResponseParser as Parser} from '../.build/jstorrent/packages/engine/src/http/http-parser'
// Bound bytes before the upstream parser can retain an incomplete header/chunk.
export class BoundedHttpParser extends Parser {
 private wire=0;private headers=false;private prefix=''
 constructor(private max:number){super()}
 push(data:Uint8Array):any[]{
  this.wire+=data.length;if(this.wire>this.max+65536)throw new Error('Response limit')
  if(!this.headers){for(let i=0;i<data.length;i++){this.prefix+=String.fromCharCode(data[i]);if(this.prefix.length>32768)throw new Error('Header limit');if(this.prefix.endsWith('\r\n\r\n')){this.headers=true;this.prefix='';break}}}
  return super.push(data)
 }
}
