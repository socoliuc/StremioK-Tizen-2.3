/* Small TV-local cache. Binary HTTPS is fetched natively, decoded by the browser. */
var TV23Images=(function(){'use strict';var entries={},order=[],bytes=0,MAX_BYTES=6*1024*1024,MAX_COUNT=64;
 function applies(url){return /^https:\/\//i.test(url)&&typeof NativeBridge!=='undefined'&&NativeBridge.available()&&window.URL&&window.URL.createObjectURL;}
 function touch(url){var i=order.indexOf(url);if(i>=0)order.splice(i,1);order.push(url);}
 function peek(url){var e=entries[url];if(!e)return null;touch(url);return e.url;}
 function remove(url){var e=entries[url];if(!e)return;window.URL.revokeObjectURL(e.url);bytes-=e.bytes;delete entries[url];var i=order.indexOf(url);if(i>=0)order.splice(i,1);}
 function load(url,cancel,allowLocal){var cached=peek(url);if(cached)return Promise.resolve(cached);return NativeBridge.getImage(url,cancel,allowLocal).then(function(r){
  var cachedAgain=peek(url);if(cachedAgain)return cachedAgain;
  var object=window.URL.createObjectURL(new Blob([r.body],{type:r.type}));entries[url]={url:object,bytes:r.body.byteLength};bytes+=r.body.byteLength;touch(url);
  while(bytes>MAX_BYTES||order.length>MAX_COUNT)remove(order[0]);return object;
 });}
 function clear(){order.slice().forEach(remove);}
 window.addEventListener('unload',clear,false);return{applies:applies,peek:peek,load:load,clear:clear};
}());
