/* ES5 control bridge. Private addon URLs stay inside this TV application. */
var NativeBridge = (function () {
 'use strict';
 var module=document.createElement('embed'), pending={}, next=1, failed=false, online=false, readyResolve,readyReject;
 var ready=new Promise(function(resolve,reject){readyResolve=resolve;readyReject=reject;});
 ready.catch(function(){});
 function unavailable(){var e=new Error('Native runtime unavailable');e.nativeUnavailable=true;return e;}
 function canceled(){var e=new Error('Cancelled');e.cancelled=true;return e;}
 function failAll(){if(failed)return;failed=true;readyReject(unavailable());Object.keys(pending).forEach(function(id){pending[id].finish(unavailable());});}
 function post(message){module.postMessage(JSON.stringify(message));}
 module.addEventListener('message',function(event){
  var message=event.data;
  if(!message||typeof message!=='object')return;
  if(message.type==='fatal'){failAll();return;}
  if(message.type==='ready'){online=true;readyResolve();return;}
  if(typeof message.headersJson==='string'){try{message.headers=JSON.parse(message.headersJson);}catch(ignore){message.headers={};}}
  var p=pending[message.id];if(p)p.finish(message.error?new Error('Native request failed ('+message.error+')'):null,message);
 });
 module.addEventListener('error',failAll);module.addEventListener('crash',failAll);
 module.width='1';module.height='1';if(module.style){module.style.position='absolute';module.style.left='-10px';}
 module.setAttribute('type','application/x-nacl');module.setAttribute('src','native/host.nmf');
 document.body.appendChild(module);
 setTimeout(function(){if(!online)failAll();},30000);
 function request(message,timeout,cancel){
  return new Promise(function(resolve,reject){
   var id=next++,done=false,off=null,timer=null,posted=false;message.id=id;
   function finish(error,result){if(done)return;done=true;if(timer!==null)clearTimeout(timer);if(off)off();delete pending[id];if(error)reject(error);else resolve(result);}
   function abort(error){if(posted)try{post({op:'cancel',id:id});}catch(ignore){}finish(error);}
   pending[id]={finish:finish};
   if(cancel){if(cancel.cancelled){finish(canceled());return;}off=cancel.onCancel(function(){abort(canceled());});}
   timer=setTimeout(function(){abort(new Error('Native request timeout'));},Math.min(120000,Math.max(1000,timeout||15000))+30000);
   ready.then(function(){if(done)return;if(failed){finish(unavailable());return;}posted=true;try{post(message);}catch(ignore){finish(unavailable());}},function(){finish(unavailable());});
  });
 }
 function origin(url){return (url.match(/^https?:\/\/[^/]+/i)||[''])[0].toLowerCase();}
 function redirected(url,location){
  if(!location||/[\r\n\x00]/.test(location))throw new Error('Invalid redirect');
  var root=origin(url),protocol=url.slice(0,url.indexOf(':'));
  if(/^https?:\/\//i.test(location))return location;
  if(location.indexOf('//')===0)return protocol+':'+location;
  if(location.charAt(0)==='/')return root+location;
  if(location.charAt(0)==='?')return url.split(/[?#]/)[0]+location;
  var joined=url.split(/[?#]/)[0].replace(/[^/]*$/,'')+location,parts=joined.slice(root.length).split('/'),clean=[];
  parts.forEach(function(p){if(p==='..'){if(clean.length>1)clean.pop();}else if(p!=='.')clean.push(p);});return root+clean.join('/');
 }
 function decode(buffer){
  var bytes=new Uint8Array(buffer||new ArrayBuffer(0));
  if(typeof TextDecoder!=='undefined')return new TextDecoder('utf-8').decode(bytes);
  var parts=[],part='',i=0,c,n,min,j,b;
  while(i<bytes.length){
   c=bytes[i++];n=0;min=0;
   if(c<128){}else if(c>=194&&c<=223){c&=31;n=1;min=128;}else if(c>=224&&c<=239){c&=15;n=2;min=2048;}else if(c>=240&&c<=244){c&=7;n=3;min=65536;}else throw new Error('Invalid UTF-8 response');
   if(i+n>bytes.length)throw new Error('Invalid UTF-8 response');
   for(j=0;j<n;j++){b=bytes[i++];if((b&192)!==128)throw new Error('Invalid UTF-8 response');c=(c<<6)|(b&63);}
   if(c<min||c>1114111||(c>=55296&&c<=57343))throw new Error('Invalid UTF-8 response');
   if(c>65535){c-=65536;part+=String.fromCharCode(55296+(c>>10),56320+(c&1023));}else part+=String.fromCharCode(c);
   if(part.length>=1024){parts.push(part);part='';}
  }
  parts.push(part);return parts.join('');
 }
 function getText(url,timeout,maxBytes,cancel,headers,body,allowLocal,binary){
  maxBytes=Math.min(8*1024*1024,Math.max(1,maxBytes||5*1024*1024));
  var deadline=Date.now()+(timeout||15000);
  function fetchNext(target,h,payload,hops){
   if(!/^https?:\/\/[^\s/@]+(?::[0-9]+)?(?:\/|$)/i.test(target)||/[\r\n\x00]/.test(target))return Promise.reject(new Error('Invalid native URL'));
   return request({op:'fetch',url:target,headers:h||{},body:payload==null?null:String(payload),maxBytes:maxBytes,priority:binary?'image':'interactive',timeout:Math.max(1000,deadline-Date.now())},timeout,cancel).then(function(result){
    if(result.status>=300&&result.status<400&&result.headers&&result.headers.location){
     if(hops>=5)throw new Error('Too many redirects');
     var nextUrl=redirected(target,result.headers.location),cross=origin(target)!==origin(nextUrl);
     if(!allowLocal&&typeof U!=='undefined'&&U.urlIsPrivate(nextUrl)&&!U.urlIsPrivate(target))throw new Error('Redirected into the home network');
     if(cross&&payload!=null&&result.status!==303&&result.status!==301&&result.status!==302)throw new Error('Cross-origin body redirect blocked');
     var nextBody=(result.status===303||result.status===301||result.status===302)?null:payload;
     // Keep safe format negotiation for old decoders, while dropping credentials.
     return fetchNext(nextUrl,cross?(binary?{Accept:'image/jpeg,image/png,image/svg+xml,image/gif;q=0.8'}:{}):h,nextBody,hops+1);
    }
    if(result.status<200||result.status>=300)throw new Error('HTTP '+result.status);
    var bytes=new Uint8Array(result.body||new ArrayBuffer(0));if(bytes.byteLength>maxBytes)throw new Error('Too large');
    if(binary){var type=String((result.headers&&result.headers['content-type'])||'').split(';')[0].toLowerCase();if(!/^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(type))throw new Error('Unsupported image type');return{body:bytes.buffer,type:type};}
    return decode(bytes.buffer);
   });
  }
  return fetchNext(url,headers,body,0);
 }
 function prepareTorrent(stream,cancel){
  return request({op:'prepareTorrent',infoHash:stream.infoHash,fileIdx:stream.fileIdx,sources:Array.isArray(stream.sources)?stream.sources:[],allowLocal:stream._torrentAllowLocal===true || (typeof Stremio!=='undefined' && Stremio.getPrefs && Stremio.getPrefs().allowLocal===true)},120000,cancel).then(function(r){return JSON.parse(decode(r.body));});
 }
 function torrentStatus(cancel){
  return request({op:'torrentStatus'},3000,cancel).then(function(r){return JSON.parse(decode(r.body));});
 }
 function stopTorrent(){return request({op:'stopTorrent'},15000).catch(function(){});}
 function getImage(url,cancel,allowLocal){
  // This public CDN sometimes caches a WebP at its extensionless address.
  // Isolate the old-TV JPEG preference without rewriting arbitrary addon URLs.
  url=String(url).replace(/^(https:\/\/images\.metahub\.space\/(?:poster|background)\/(?:small|medium|large)\/tt[0-9]+\/img)$/i,'$1?format=jpg&tv23=1');
  return getText(url,8000,2*1024*1024,cancel,{Accept:'image/jpeg,image/png,image/svg+xml,image/gif;q=0.8'},null,allowLocal,true);
 }
 return {available:function(){return !failed;},ready:ready,getText:getText,getImage:getImage,request:request,prepareTorrent:prepareTorrent,torrentStatus:torrentStatus,stopTorrent:stopTorrent};
}());
