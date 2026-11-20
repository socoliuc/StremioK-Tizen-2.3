#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdio.h>
#include <irt.h>
#include <bearssl.h>
#include <quickjs.h>
#include <ppapi/c/pp_errors.h>
#include <ppapi/c/ppb.h>
#include <ppapi/c/ppb_core.h>
#include <ppapi/c/ppb_messaging.h>
#include <ppapi/c/ppb_var.h>
#include <ppapi/c/ppb_var_dictionary.h>
#include <ppapi/c/ppb_var_array_buffer.h>
#include <ppapi/c/ppp.h>
#include <ppapi/c/ppp_instance.h>
#include <ppapi/c/ppp_messaging.h>
#include "net.h"
#include "engine-bundle.h"
static const struct PPB_Core_1_0 *core;
static const struct PPB_Messaging_1_0 *messages;
static const struct PPB_Var_1_2 *vars;
static const struct PPB_VarDictionary_1_0 *dict;
static const struct PPB_VarArrayBuffer_1_0 *buffers;
static PPB_GetInterface get_browser;
static PP_Instance owner;
static int active;
static JSRuntime *runtime;
static JSContext *context;
static double deadline;
typedef union {size_t size;double alignment;} Header;
static void *qmalloc(JSMallocState *s,size_t n){if(n>128*1024*1024||s->malloc_size+n+sizeof(Header)>s->malloc_limit)return NULL;Header *p=malloc(n+sizeof(Header));if(!p)return NULL;p->size=n;s->malloc_count++;s->malloc_size+=n+sizeof(Header);return p+1;}
static void qfree(JSMallocState *s,void *p){if(!p)return;Header *h=(Header*)p-1;s->malloc_count--;s->malloc_size-=h->size+sizeof(Header);free(h);}
static void *qrealloc(JSMallocState *s,void *p,size_t n){if(!p)return qmalloc(s,n);if(!n){qfree(s,p);return NULL;}Header *old=(Header*)p-1;size_t before=old->size;if(n>128*1024*1024||s->malloc_size-before+n>s->malloc_limit)return NULL;Header *h=realloc(old,n+sizeof(Header));if(!h)return NULL;h->size=n;s->malloc_size=s->malloc_size-before+n;return h+1;}
static size_t qusable(const void *p){return p?((const Header*)p-1)->size:0;}
static int interrupt(JSRuntime *rt,void *opaque){(void)rt;(void)opaque;return !active||core->GetTimeTicks()>deadline;}
static struct PP_Var pv_string(const char *text){return vars->VarFromUtf8(text,strlen(text));}
static struct PP_Var pv_int(int n){struct PP_Var v;memset(&v,0,sizeof(v));v.type=PP_VARTYPE_INT32;v.value.as_int=n;return v;}
static void pv_set(struct PP_Var object,const char *key,struct PP_Var value){struct PP_Var name=pv_string(key);dict->Set(object,name,value);vars->Release(name);}
static void post_type(const char *type){if(!active)return;struct PP_Var message=dict->Create(),v=pv_string(type);pv_set(message,"type",v);vars->Release(v);messages->PostMessage(owner,message);vars->Release(message);}
static void clear_exception(void){JSValue exception=JS_GetException(context);JS_FreeValue(context,exception);}
static void drain_jobs(void){if(!active||!runtime)return;deadline=core->GetTimeTicks()+1.0;JSContext *ctx;double until=core->GetTimeTicks()+0.020;for(int n=0;n<32&&JS_IsJobPending(runtime)&&core->GetTimeTicks()<until;n++){if(JS_ExecutePendingJob(runtime,&ctx)<0){clear_exception();break;}}}
static JSValue host_api(int magic,int argc,JSValueConst *argv);
enum {OPEN,CONNECT,SECURE,SEND,RESUME,CLOSE,QUEUED,LISTEN,UDP_BIND,UDP_SEND,LOOKUP,HASH,REPLY,TEXT_ENCODE,TEXT_DECODE,RANDOM,TIMEOUT,INTERVAL,CLEAR_TIMER,LOG};
static JSValue binding(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv,int magic){(void)ctx;(void)self;return host_api(magic,argc,argv);}
typedef struct {unsigned id;double at,interval;JSValue callback;} Timer;
static Timer timers[512];static unsigned next_timer;static unsigned timer_cursor;
static JSValue make_timer(JSValueConst callback,int ms,int repeat){if(!JS_IsFunction(context,callback))return JS_ThrowTypeError(context,"Timer callback required");for(int n=0;n<512;n++)if(!timers[n].id){Timer *t=&timers[n];t->id=++next_timer;if(!t->id)t->id=++next_timer;t->callback=JS_DupValue(context,callback);t->interval=repeat?(ms>0?ms:1)/1000.0:0;t->at=core->GetTimeTicks()+(ms>0?ms:0)/1000.0;return JS_NewUint32(context,t->id);}return JS_ThrowInternalError(context,"Timer limit");}
static void clear_timer(unsigned id){for(int n=0;n<512;n++)if(timers[n].id==id){timers[n].id=0;JS_FreeValue(context,timers[n].callback);break;}}
static void tick(void *unused,int32_t result){(void)unused;(void)result;if(!active)return;double now=core->GetTimeTicks();double until=now+0.020;int fired=0;for(int checked=0;checked<512&&fired<8&&core->GetTimeTicks()<until;checked++){int n=timer_cursor++%512;Timer *t=&timers[n];if(!t->id||t->at>now)continue;fired++;JSValue fn=JS_DupValue(context,t->callback);unsigned id=t->id;if(t->interval)t->at=now+t->interval;else clear_timer(id);deadline=core->GetTimeTicks()+1.0;JSValue value=JS_Call(context,fn,JS_UNDEFINED,0,NULL);if(JS_IsException(value))clear_exception();JS_FreeValue(context,value);JS_FreeValue(context,fn);}drain_jobs();struct PP_CompletionCallback callback={tick,NULL,0};core->CallOnMainThread(10,callback,0);}
typedef struct {int type,id,result,port;size_t len;char host[256];unsigned char data[];} Event;
static void event_ready(void *data,int32_t ignored){(void)ignored;Event *e=data;if(active&&context){deadline=core->GetTimeTicks()+1.0;JSValue global=JS_GetGlobalObject(context),host=JS_GetPropertyStr(context,global,"TVHost"),fn=JS_GetPropertyStr(context,host,"onNet");JSValue args[6]={JS_NewInt32(context,e->type),JS_NewInt32(context,e->id),JS_NewInt32(context,e->result),JS_NewArrayBufferCopy(context,e->data,e->len),JS_NewString(context,e->host),JS_NewInt32(context,e->port)};JSValue value=JS_Call(context,fn,host,6,args);if(JS_IsException(value))clear_exception();JS_FreeValue(context,value);for(int n=0;n<6;n++)JS_FreeValue(context,args[n]);JS_FreeValue(context,fn);JS_FreeValue(context,host);JS_FreeValue(context,global);drain_jobs();if(e->type==NET_DATA||e->type==NET_UDP_DATA)net_resume(e->id);}free(e);}
static void net_event(int type,int id,int result,const void *data,size_t len,const char *host,int port){if(!active||len>65536)return;Event *e=malloc(sizeof(*e)+len);if(!e)return;e->type=type;e->id=id;e->result=result;e->port=port;e->len=len;snprintf(e->host,sizeof(e->host),"%s",host?host:"");if(len)memcpy(e->data,data,len);struct PP_CompletionCallback callback={event_ready,e,0};core->CallOnMainThread(0,callback,0);}
static void send_reply(int id,int status,const char *headers,const unsigned char *data,size_t len,const char *error){
 if(!active||len>8*1024*1024)return;struct PP_Var m=dict->Create(),h=pv_string(headers?headers:"{}"),e=pv_string(error?error:""),body=buffers->Create(len);
 pv_set(m,"id",pv_int(id));pv_set(m,"status",pv_int(status));pv_set(m,"headersJson",h);if(error&&*error)pv_set(m,"error",e);
 if(len){void *dest=buffers->Map(body);if(!dest){vars->Release(body);vars->Release(e);vars->Release(h);vars->Release(m);return;}memcpy(dest,data,len);buffers->Unmap(body);}pv_set(m,"body",body);messages->PostMessage(owner,m);vars->Release(body);vars->Release(e);vars->Release(h);vars->Release(m);
}
static JSValue host_api(int magic,int argc,JSValueConst *argv){
 int32_t id=0,port=0,value=0;size_t len=0;uint8_t *data=NULL;const char *text=NULL,*second=NULL;int result=-4;
 if(argc)JS_ToInt32(context,&id,argv[0]);
 if(magic==LOG)return JS_UNDEFINED;
 if(magic==OPEN)return JS_NewInt32(context,net_open(id));
 if(magic==RESUME){net_resume(id);return JS_UNDEFINED;}
 if(magic==QUEUED)return JS_NewInt32(context,net_queued(id));
 if(magic==CLOSE){net_close(id);return JS_UNDEFINED;}
 if(magic==CLEAR_TIMER){clear_timer((unsigned)id);return JS_UNDEFINED;}
 if(magic==TIMEOUT||magic==INTERVAL){if(argc>1)JS_ToInt32(context,&value,argv[1]);return make_timer(argv[0],value,magic==INTERVAL);}
 if(magic==LISTEN){if(argc>1)JS_ToInt32(context,&value,argv[1]);return JS_NewInt32(context,net_listen(id,value));}
 if(magic==TEXT_ENCODE){text=JS_ToCStringLen(context,&len,argv[0]);if(!text)return JS_EXCEPTION;JSValue v=JS_NewArrayBufferCopy(context,(const uint8_t*)text,len);JS_FreeCString(context,text);return v;}
 if(magic==TEXT_DECODE){data=JS_GetArrayBuffer(context,&len,argv[0]);if(!data&&len)return JS_EXCEPTION;return JS_NewStringLen(context,(char*)data,len);}
 if(magic==RANDOM){if(id<0||id>65536)return JS_ThrowRangeError(context,"Random size limit");uint8_t *bytes=malloc(id?id:1);struct nacl_irt_random random;size_t count=0;if(!bytes||nacl_interface_query(NACL_IRT_RANDOM_v0_1,&random,sizeof(random))!=sizeof(random)||random.get_random_bytes(bytes,id,&count)||count!=(size_t)id){free(bytes);return JS_ThrowInternalError(context,"Random unavailable");}JSValue v=JS_NewArrayBufferCopy(context,bytes,id);memset(bytes,0,id);free(bytes);return v;}
 if(magic==HASH){data=JS_GetArrayBuffer(context,&len,argv[0]);if((!data&&len)||len>32*1024*1024)return JS_ThrowRangeError(context,"Hash size limit");br_sha1_context hash;unsigned char digest[20];br_sha1_init(&hash);br_sha1_update(&hash,data,len);br_sha1_out(&hash,digest);return JS_NewArrayBufferCopy(context,digest,sizeof(digest));}
 if(magic==REPLY){if(argc<5)return JS_UNDEFINED;JS_ToInt32(context,&value,argv[1]);text=JS_ToCString(context,argv[2]);data=JS_GetArrayBuffer(context,&len,argv[3]);second=JS_ToCString(context,argv[4]);send_reply(id,value,text,data,len,second);JS_FreeCString(context,text);JS_FreeCString(context,second);return JS_UNDEFINED;}
 if(magic==SEND){if(argc<2)return JS_NewInt32(context,-4);data=JS_GetArrayBuffer(context,&len,argv[1]);return JS_NewInt32(context,net_send(id,data,len));}
 if(magic==LOOKUP){text=JS_ToCString(context,argv[0]);if(!text)return JS_EXCEPTION;result=net_lookup(text);JS_FreeCString(context,text);return JS_NewInt32(context,result);}
 if(argc<2)return JS_NewInt32(context,-4);text=JS_ToCString(context,argv[1]);if(!text)return JS_EXCEPTION;if(argc>2)JS_ToInt32(context,&port,argv[2]);
 if(magic==CONNECT)result=net_connect(id,text,port);
 else if(magic==SECURE)result=net_secure(id,text);
 else if(magic==UDP_BIND)result=net_udp_bind(id,text,port);
 else if(magic==UDP_SEND&&argc>3){data=JS_GetArrayBuffer(context,&len,argv[3]);result=net_udp_send(id,text,port,data,len);}
 JS_FreeCString(context,text);return JS_NewInt32(context,result);
}
static void define(JSValue object,const char *name,int op,int nargs){JS_SetPropertyStr(context,object,name,JS_NewCFunctionMagic(context,binding,name,nargs,JS_CFUNC_generic_magic,op));}
static void message(PP_Instance i,struct PP_Var value){(void)i;if(!active||!context||value.type!=PP_VARTYPE_STRING)return;uint32_t length=0;const char *text=vars->VarToUtf8(value,&length);if(!text||length>131072)return;deadline=core->GetTimeTicks()+1.0;JSValue request=JS_ParseJSON(context,text,length,"tv-command");if(JS_IsException(request)){clear_exception();return;}JSValue global=JS_GetGlobalObject(context),host=JS_GetPropertyStr(context,global,"TVHost"),fn=JS_GetPropertyStr(context,host,"handle"),result=JS_Call(context,fn,host,1,&request);if(JS_IsException(result))clear_exception();JS_FreeValue(context,result);JS_FreeValue(context,fn);JS_FreeValue(context,host);JS_FreeValue(context,global);JS_FreeValue(context,request);drain_jobs();}
static PP_Bool create(PP_Instance i,uint32_t n,const char *keys[],const char *values[]){
 (void)n;(void)keys;(void)values;owner=i;active=1;if(!net_init(i,get_browser,net_event)){post_type("fatal");return PP_TRUE;}
 const JSMallocFunctions allocator={qmalloc,qfree,qrealloc,qusable};runtime=JS_NewRuntime2(&allocator,NULL);if(!runtime){post_type("fatal");return PP_TRUE;}JS_SetMemoryLimit(runtime,128*1024*1024);JS_SetMaxStackSize(runtime,1024*1024);JS_SetInterruptHandler(runtime,interrupt,NULL);context=JS_NewContext(runtime);if(!context){post_type("fatal");return PP_TRUE;}
 JSValue global=JS_GetGlobalObject(context),net=JS_NewObject(context);
 define(net,"open",OPEN,1);define(net,"connect",CONNECT,3);define(net,"secure",SECURE,2);define(net,"send",SEND,2);define(net,"resume",RESUME,1);define(net,"queued",QUEUED,1);define(net,"close",CLOSE,1);define(net,"listen",LISTEN,2);define(net,"udpBind",UDP_BIND,3);define(net,"udpSend",UDP_SEND,4);define(net,"lookup",LOOKUP,1);define(net,"hash",HASH,1);define(net,"reply",REPLY,5);JS_SetPropertyStr(context,global,"TVNet",net);
 define(global,"__jstorrent_text_encode",TEXT_ENCODE,1);define(global,"__jstorrent_text_decode",TEXT_DECODE,1);define(global,"__jstorrent_random_bytes",RANDOM,1);define(global,"__jstorrent_set_timeout",TIMEOUT,2);define(global,"__jstorrent_set_interval",INTERVAL,2);define(global,"__jstorrent_clear_timeout",CLEAR_TIMER,1);define(global,"__jstorrent_clear_interval",CLEAR_TIMER,1);define(global,"__jstorrent_console_log",LOG,2);JS_FreeValue(context,global);
 deadline=core->GetTimeTicks()+15.0;JSValue result=JS_Eval(context,(char*)engine_js,sizeof(engine_js)-1,"tv-engine.js",JS_EVAL_TYPE_GLOBAL);
 if(JS_IsException(result)){clear_exception();post_type("fatal");}else post_type("ready");JS_FreeValue(context,result);drain_jobs();struct PP_CompletionCallback callback={tick,NULL,0};core->CallOnMainThread(10,callback,0);return PP_TRUE;
}
static void destroy(PP_Instance i){(void)i;active=0;net_shutdown();if(context){for(int n=0;n<512;n++)if(timers[n].id){JS_FreeValue(context,timers[n].callback);timers[n].id=0;}JS_FreeContext(context);context=NULL;}if(runtime){JS_FreeRuntime(runtime);runtime=NULL;}}
static void view(PP_Instance i,PP_Resource r){(void)i;(void)r;}
static void focus(PP_Instance i,PP_Bool b){(void)i;(void)b;}
static PP_Bool document(PP_Instance i,PP_Resource r){(void)i;(void)r;return PP_FALSE;}
PP_EXPORT int32_t PPP_InitializeModule(PP_Module m,PPB_GetInterface get){(void)m;get_browser=get;core=get(PPB_CORE_INTERFACE_1_0);messages=get(PPB_MESSAGING_INTERFACE_1_0);vars=get(PPB_VAR_INTERFACE_1_2);dict=get(PPB_VAR_DICTIONARY_INTERFACE_1_0);buffers=get(PPB_VAR_ARRAY_BUFFER_INTERFACE_1_0);return core&&messages&&vars&&dict&&buffers?PP_OK:PP_ERROR_NOINTERFACE;}
PP_EXPORT void PPP_ShutdownModule(void){}
PP_EXPORT const void *PPP_GetInterface(const char *name){static const struct PPP_Instance_1_1 instance={create,destroy,view,focus,document};static const struct PPP_Messaging_1_0 messaging={message};if(!strcmp(name,PPP_INSTANCE_INTERFACE_1_1))return &instance;if(!strcmp(name,PPP_MESSAGING_INTERFACE_1_0))return &messaging;return NULL;}
