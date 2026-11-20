const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),acorn=require('acorn');
const source=fs.readFileSync(path.resolve(__dirname,'../js/util.js'),'utf8');
function functionSource(name){let found=null;function walk(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration'&&n.id.name===name)found=source.slice(n.start,n.end);for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v)}walk(acorn.parse(source,{ecmaVersion:5}));assert(found,'Missing '+name);return found;}
function node(classes,rect,parent){return{classList:{contains(c){return classes.indexOf(c)!==-1}},parentNode:parent,getBoundingClientRect(){return rect}};}
const docRoot={classList:{contains(){return false}},parentNode:null,contains(){return true},getBoundingClientRect(){return{left:0,right:1280,top:0,bottom:720}}};
const hidden=node(['screen','hidden'],{left:0,right:0,top:0,bottom:0},docRoot);
const shown=node(['screen'],{left:20,right:900,top:0,bottom:700},docRoot);
const body=node([],{left:0,right:1280,top:0,bottom:720},docRoot);
const hiddenPoster=node(['poster'],{left:0,right:0,top:0,bottom:0},hidden);
const visibleLogo=node(['logo'],{left:0,right:0,top:0,bottom:0},shown);
visibleLogo.parentNode=node(['logo-wrap'],{left:20,right:80,top:30,bottom:90},shown);
const context={document:{documentElement:docRoot},window:{innerWidth:1280,innerHeight:720},_imageQueue:[]};
vm.createContext(context);
vm.runInContext(functionSource('onPage')+'\n'+functionSource('inHiddenScreen')+'\n'+functionSource('visiblePage')+'\n'+functionSource('imageNearViewport')+'\n'+functionSource('queueCancelledItem'),context);
assert.equal(context.inHiddenScreen(hiddenPoster),true);
assert.equal(context.visiblePage(hiddenPoster),false);
assert.equal(context.imageNearViewport(hiddenPoster),false,'A hidden screen must not become visible by climbing to a sized body');
assert.equal(context.imageNearViewport(visibleLogo),true,'A visible unsized logo may still use its sized ancestor');

let cancelled=0;const loading={it:{img:hiddenPoster,src:'same'},cancel(){cancelled++;}};
const shared={it:{img:hiddenPoster,src:'shared'},cancel(){cancelled++;}};
const inflight={same:[],shared:[{img:node(['poster'],{left:10,right:100,top:10,bottom:100},shown)}]};
context._loading=[loading,shared];context._inflight=inflight;
vm.runInContext(functionSource('dropUnwanted'),context);context.dropUnwanted();
assert.equal(cancelled,1,'A download used only by a hidden screen is cancelled');
assert.equal(shared.it.img.__queuedImage,undefined,'A hidden owner does not invalidate a shared download still needed by a visible waiter');

// Model entry.cancel restoring the original item after a hidden screen is left. It must
// remain queued while hidden, then start from the same node when that screen is shown again.
const returned=node(['screen','hidden'],{left:0,right:0,top:0,bottom:0},docRoot);
const returnedPoster=node(['poster'],{left:20,right:300,top:20,bottom:180},returned);
const item={img:returnedPoster,src:'https://art.example/episode.jpg',bg:false};returnedPoster.__queuedImage=item;
context.queueCancelledItem(item);
assert.equal(context._imageQueue.length,1,'A cancelled retained item is re-enqueued');
let assigned='';let listeners={};returnedPoster.addEventListener=(n,f)=>{listeners[n]=f};returnedPoster.removeEventListener=()=>{};returnedPoster.removeAttribute=()=>{};
const pumpContext={document:{documentElement:docRoot,createElement(){throw new Error('image node should be reused')}},window:{innerWidth:1280,innerHeight:720},
 _imageQueue:context._imageQueue,_imageActive:0,IMAGE_LOAD_LIMIT:1,IMAGE_TIMEOUT_MS:12000,_loading:[],_inflight:{},_loadedSrc:{},_failedAt:{get(){return null}},
 dropUnwanted(){},isHidden(){return false},onPage:context.onPage,inHiddenScreen:context.inHiddenScreen,visiblePage:context.visiblePage,imageNearViewport:context.imageNearViewport,
 setTimeout(){return 1},clearTimeout(){},Date,console,log(){},markLoaded(){},scheduleImagePump(){},cancelToken(){},
 U:undefined,TV23Images:undefined};
Object.defineProperty(returnedPoster,'src',{set(v){assigned=v},get(){return assigned}});
vm.createContext(pumpContext);vm.runInContext(functionSource('pumpImages'),pumpContext);
pumpContext.pumpImages();assert.equal(assigned,'','Hidden retained work must stay deferred');
returned.classList={contains(c){return c==='screen'}};
pumpContext.pumpImages();assert.equal(assigned,item.src,'The same retained item loads when its screen returns, without rebuilding it');
assert.equal(pumpContext._failedAt.get(item.src),null,'Cancellation does not negative-cache the artwork');
console.log('Hidden-screen artwork stays deferred; visible unsized logos still load; hidden-only work is cancelled and requeued for return; shared visible work continues.');
