const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),zlib=require('zlib');
const root=path.resolve(__dirname,'..'),ctx={Date,Uint8Array,Array,Math,isFinite,atob};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/pako-inflate.js'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(path.join(root,'js/account-history.js'),'utf8'),ctx);const H=ctx.StremioHistory;
const at='2026-10-24T09:00:00Z',items=[{_id:'tt1',type:'movie',name:'Movie',poster:'https://art.test/p.jpg',state:{timeOffset:123000,duration:300000,lastWatched:at}},
 {_id:'tt2',type:'series',name:'Show',removed:true,temp:true,state:{video_id:'tt2:1:2',timeOffset:45000,duration:120000,lastWatched:at}},
 {_id:'gone',type:'movie',name:'Removed',removed:true,temp:false,state:{timeOffset:1000,lastWatched:at}},
 {_id:'seen',type:'movie',name:'Watched',state:{timeOffset:0,timesWatched:1,lastWatched:at}}];
const built=H.build(items);assert.equal(built.progress['movie:tt1'].position,123);assert.equal(built.progress['series:tt2:1:2'].parent,'tt2');assert.equal(built.progress['series:tt2:1:2'].position,45);assert(!built.progress['movie:gone']);assert.equal(built.watched['movie:seen'],Date.parse(at));assert(!built.watched['series:tt2:1:2'],'A show-level count must not mark an unconfirmed current episode watched');
const bad=H.cleanState({timeOffset:-1,duration:Infinity,video_id:{},watched:'x'.repeat(20000)});assert.equal(bad.timeOffset,0);assert.equal(bad.duration,0);assert.equal(bad.video_id,'');assert.equal(bad.watched,'');
const meta={id:'tt2',videos:[{id:'tt2:1:3',season:1,episode:3},{id:'tt2:1:1',season:1,episode:1},{id:'tt2:1:2',season:1,episode:2}]};
const bits=zlib.deflateSync(Buffer.from([5])).toString('base64');const watched=H.decode(meta,'tt2:1:3:3:'+bits);assert(watched['tt2:1:1']);assert(!watched['tt2:1:2']);assert(watched['tt2:1:3']);
assert.equal(Object.keys(H.decode(meta,'not-present:3:'+bits)).length,0);assert.equal(Object.keys(H.decode(meta,'tt2:1:3:3:corrupt')).length,0);
const shifted={id:'tt2',videos:[{id:'tt2:1:2',season:1,episode:2},{id:'tt2:1:3',season:1,episode:3}]};assert(H.decode(shifted,'tt2:1:3:3:'+bits)['tt2:1:3']);
const huge=zlib.deflateSync(Buffer.alloc(100000,255)).toString('base64');assert.equal(Object.keys(H.decode(meta,'tt2:1:3:3:'+huge)).length,0,'Inflated watched data is bounded');
console.log('Account milliseconds, temporary Watching entries, watched flags, anchored bitfield order/shift and malformed/oversized input passed.');
