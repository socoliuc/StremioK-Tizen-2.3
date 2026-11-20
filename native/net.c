#include "net.h"
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <time.h>
#include <irt.h>
#include <bearssl.h>
#include "trust-anchors.h"
#include <ppapi/c/pp_errors.h>
#include <ppapi/c/ppb_core.h>
#include <ppapi/c/ppb_var.h>
#include <ppapi/c/ppb_tcp_socket.h>
#include <ppapi/c/ppb_udp_socket.h>
#include <ppapi/c/ppb_net_address.h>
#include <ppapi/c/ppb_host_resolver.h>
#define SLOTS 40
#define READ_SIZE 65536
#define QUEUE_MAX (512*1024)
#define QUEUE_TOTAL (4*1024*1024)
typedef struct Chunk {struct Chunk *next;size_t len,offset;unsigned char data[];} Chunk;
typedef struct {br_ssl_client_context client;br_x509_minimal_context validator;unsigned char buffer[BR_SSL_BUFSIZE_BIDI],output[32768];size_t received,receive_offset;int secured,busy;} TLS;
typedef struct {int id,kind,port,connected,reading,writing,want_read,pumping,repump;PP_Resource socket,resolver,peer,accepted;char host[256];unsigned char input[READ_SIZE];Chunk *head,*tail;size_t queued;TLS *tls;} Socket;
static Socket sockets[SLOTS];
static unsigned generation;
static size_t total_queued;
static PP_Instance instance;
static NetEvent emit;
static const struct PPB_Core_1_0 *core;
static const struct PPB_Var_1_2 *vars;
static const struct PPB_TCPSocket_1_1 *tcp;
static const struct PPB_UDPSocket_1_0 *udp;
static const struct PPB_NetAddress_1_0 *addresses;
static const struct PPB_HostResolver_1_0 *dns;
static Socket *find(int id){if(id<=0)return NULL;Socket *s=&sockets[(id-1)%SLOTS];return s->id==id?s:NULL;}
static Socket *allocate(int kind){for(int n=0;n<SLOTS;n++)if(!sockets[n].id){Socket *s=&sockets[n];memset(s,0,sizeof(*s));if(++generation>40000000)return NULL;s->id=generation*SLOTS+n+1;s->kind=kind;return s;}return NULL;}
static struct PP_CompletionCallback cb(PP_CompletionCallback_Func fn,int id){struct PP_CompletionCallback c={fn,(void*)(intptr_t)id,PP_COMPLETIONCALLBACK_FLAG_OPTIONAL};return c;}
static void dispatch(int r,PP_CompletionCallback_Func fn,int id){if(r!=PP_OK_COMPLETIONPENDING)fn((void*)(intptr_t)id,r);}
static void release(PP_Resource *r){if(*r){core->ReleaseResource(*r);*r=0;}}
static void endpoint(PP_Resource r,char host[64],int *port){struct PP_NetAddress_IPv4 a;host[0]=0;*port=0;if(addresses->DescribeAsIPv4Address(r,&a)){snprintf(host,64,"%u.%u.%u.%u",a.addr[0],a.addr[1],a.addr[2],a.addr[3]);*port=(a.port>>8)|(a.port<<8&65535);}}
static PP_Resource ipv4(const char *host,int port){unsigned a,b,c,d;char tail;if(port<0||port>65535||sscanf(host,"%u.%u.%u.%u%c",&a,&b,&c,&d,&tail)!=4||a>255||b>255||c>255||d>255)return 0;struct PP_NetAddress_IPv4 ip={(uint16_t)((port<<8)|(port>>8)),{a,b,c,d}};return addresses->CreateFromIPv4Address(instance,&ip);}
static void close_socket(Socket *s,int result){
 if(!s||!s->id)return;int id=s->id,kind=s->kind;s->id=0;
 if(s->socket){if(kind==2)udp->Close(s->socket);else tcp->Close(s->socket);release(&s->socket);}
 release(&s->resolver);release(&s->peer);
 if(s->accepted){tcp->Close(s->accepted);release(&s->accepted);}
 while(s->head){Chunk *c=s->head;s->head=c->next;total_queued-=c->len-c->offset;free(c);}s->tail=NULL;s->queued=0;
 free(s->tls);s->tls=NULL;if(kind!=4)emit(NET_CLOSED,id,result,NULL,0,NULL,0);
}
void net_close(int id){close_socket(find(id),0);}
static void pump(Socket *s);
static void on_read(void *data,int32_t result){Socket *s=find((int)(intptr_t)data);if(!s)return;s->reading=0;
 if(result<=0){close_socket(s,s->tls&&result==0?-1001:result);return;}
 if(s->tls){s->tls->received=result;s->tls->receive_offset=0;pump(s);}else{s->want_read=0;emit(NET_DATA,s->id,0,s->input,result,NULL,0);}
}
static void consume(Socket *s,size_t count){while(count&&s->head){Chunk *c=s->head;size_t n=c->len-c->offset;if(n>count)n=count;c->offset+=n;s->queued-=n;total_queued-=n;count-=n;if(c->offset==c->len){s->head=c->next;if(!s->head)s->tail=NULL;free(c);}}}
static void on_write(void *data,int32_t result){Socket *s=find((int)(intptr_t)data);if(!s)return;s->writing=0;if(result<=0){close_socket(s,s->tls&&result==0?-1001:result);return;}if(s->tls){size_t len;br_ssl_engine_sendrec_buf(&s->tls->client.eng,&len);if((size_t)result>len){close_socket(s,-2);return;}br_ssl_engine_sendrec_ack(&s->tls->client.eng,result);}else consume(s,result);pump(s);}
static void pump(Socket *s){
 if(!s||!s->id||!s->connected)return;if(s->pumping){s->repump=1;return;}s->pumping=1;int id=s->id;
 if(!s->tls){
  if(s->head&&!s->writing){Chunk *c=s->head;s->writing=1;dispatch(tcp->Write(s->socket,(char*)c->data+c->offset,c->len-c->offset,cb(on_write,id)),on_write,id);}
  if(find(id)&&s->want_read&&!s->reading){s->reading=1;dispatch(tcp->Read(s->socket,(char*)s->input,sizeof(s->input),cb(on_read,id)),on_read,id);}
 }else while(find(id)){
  TLS *t=s->tls;unsigned state=br_ssl_engine_current_state(&t->client.eng);size_t len;unsigned char *buffer;
  if(state&BR_SSL_CLOSED){int error=br_ssl_engine_last_error(&t->client.eng);close_socket(s,error?-1000-error:0);break;}
  if((state&BR_SSL_RECVREC)&&t->receive_offset<t->received){buffer=br_ssl_engine_recvrec_buf(&t->client.eng,&len);if(len>t->received-t->receive_offset)len=t->received-t->receive_offset;memcpy(buffer,s->input+t->receive_offset,len);t->receive_offset+=len;br_ssl_engine_recvrec_ack(&t->client.eng,len);continue;}
  if((state&BR_SSL_SENDAPP)&&!t->secured){t->secured=1;emit(NET_SECURED,id,0,NULL,0,NULL,0);}
  if((state&BR_SSL_RECVAPP)&&s->want_read){buffer=br_ssl_engine_recvapp_buf(&t->client.eng,&len);s->want_read=0;emit(NET_DATA,id,0,buffer,len,NULL,0);br_ssl_engine_recvapp_ack(&t->client.eng,len);continue;}
  if((state&BR_SSL_SENDAPP)&&s->head){Chunk *c=s->head;buffer=br_ssl_engine_sendapp_buf(&t->client.eng,&len);if(len>c->len-c->offset)len=c->len-c->offset;memcpy(buffer,c->data+c->offset,len);consume(s,len);br_ssl_engine_sendapp_ack(&t->client.eng,len);br_ssl_engine_flush(&t->client.eng,0);continue;}
  if((state&BR_SSL_SENDREC)&&!s->writing){buffer=br_ssl_engine_sendrec_buf(&t->client.eng,&len);if(len>sizeof(t->output))len=sizeof(t->output);memcpy(t->output,buffer,len);s->writing=1;dispatch(tcp->Write(s->socket,(char*)t->output,len,cb(on_write,id)),on_write,id);if(!find(id))break;}
  state=br_ssl_engine_current_state(&t->client.eng);
  if((state&BR_SSL_RECVREC)&&!s->reading&&t->received==t->receive_offset&&(!t->secured||s->want_read)){br_ssl_engine_recvrec_buf(&t->client.eng,&len);if(len>sizeof(s->input))len=sizeof(s->input);t->received=t->receive_offset=0;s->reading=1;dispatch(tcp->Read(s->socket,(char*)s->input,len,cb(on_read,id)),on_read,id);}
  break;
 }
 if(find(id)){s->pumping=0;if(s->repump){s->repump=0;pump(s);}}
}
int net_send(int id,const void *data,size_t length){Socket *s=find(id);if(!s||!s->connected||s->kind!=1)return -1;if(length>QUEUE_MAX||s->queued+length>QUEUE_MAX||total_queued+length>QUEUE_TOTAL)return -8;if(!length)return 0;Chunk *c=malloc(sizeof(*c)+length);if(!c)return -8;c->next=NULL;c->len=length;c->offset=0;memcpy(c->data,data,length);if(s->tail)s->tail->next=c;else s->head=c;s->tail=c;s->queued+=length;total_queued+=length;pump(s);return 0;}
static void on_udp_read(void *data,int32_t result){Socket *s=find((int)(intptr_t)data);if(!s)return;s->reading=0;if(result<0){close_socket(s,result);return;}char host[64];int port;endpoint(s->peer,host,&port);emit(NET_UDP_DATA,s->id,0,s->input,result,host,port);release(&s->peer);}
void net_resume(int id){Socket *s=find(id);if(!s)return;s->want_read=1;if(s->kind==2){if(!s->reading){s->reading=1;dispatch(udp->RecvFrom(s->socket,(char*)s->input,sizeof(s->input),&s->peer,cb(on_udp_read,id)),on_udp_read,id);}}else pump(s);}
static void on_connect(void *data,int32_t result){Socket *s=find((int)(intptr_t)data);if(!s)return;release(&s->resolver);if(result!=PP_OK){emit(NET_CONNECTED,s->id,result,NULL,0,NULL,0);close_socket(s,result);return;}s->connected=1;PP_Resource peer=tcp->GetRemoteAddress(s->socket);char host[64];int port;endpoint(peer,host,&port);core->ReleaseResource(peer);emit(NET_CONNECTED,s->id,0,NULL,0,host,port);}
static void on_resolve(void *data,int32_t result){Socket *s=find((int)(intptr_t)data);if(!s)return;if(result!=PP_OK||!dns->GetNetAddressCount(s->resolver)){int id=s->id;emit(s->kind==4?NET_RESOLVED:NET_CONNECTED,id,result?result:-105,NULL,0,NULL,0);close_socket(s,result?result:-105);return;}PP_Resource addr=dns->GetNetAddress(s->resolver,0);
 if(s->kind==4){char host[64];int port;endpoint(addr,host,&port);emit(NET_RESOLVED,s->id,0,NULL,0,host,port);core->ReleaseResource(addr);close_socket(s,0);return;}
 int r=tcp->Connect(s->socket,addr,cb(on_connect,s->id));core->ReleaseResource(addr);dispatch(r,on_connect,s->id);
}
int net_open(int is_udp){Socket *s=allocate(is_udp?2:1);if(!s)return -8;s->socket=is_udp?udp->Create(instance):tcp->Create(instance);if(!s->socket){s->id=0;return -2;}return s->id;}
int net_connect(int id,const char *host,int port){Socket *s=find(id);if(!s||s->kind!=1||s->resolver||s->connected||!host||strlen(host)>253||port<1||port>65535)return -4;strcpy(s->host,host);s->port=port;s->resolver=dns->Create(instance);struct PP_HostResolver_Hint hint={PP_NETADDRESS_FAMILY_IPV4,0};dispatch(dns->Resolve(s->resolver,host,port,&hint,cb(on_resolve,id)),on_resolve,id);return 0;}
int net_lookup(const char *host){if(!host||strlen(host)>253)return -4;Socket *s=allocate(4);if(!s)return -8;s->resolver=dns->Create(instance);struct PP_HostResolver_Hint hint={PP_NETADDRESS_FAMILY_IPV4,0};int id=s->id;dispatch(dns->Resolve(s->resolver,host,0,&hint,cb(on_resolve,id)),on_resolve,id);return id;}
int net_secure(int id,const char *host){Socket *s=find(id);if(!s||!s->connected||s->reading||s->writing||s->tls||s->head||!host||strlen(host)>253)return -4;
 TLS *t=calloc(1,sizeof(*t));if(!t)return -8;struct nacl_irt_random random;unsigned char seed[48];size_t count=0;
 if(nacl_interface_query(NACL_IRT_RANDOM_v0_1,&random,sizeof(random))!=sizeof(random)||random.get_random_bytes(seed,sizeof(seed),&count)||count!=sizeof(seed)){free(t);return -2;}
 br_ssl_client_init_full(&t->client,&t->validator,trust_anchors,sizeof(trust_anchors)/sizeof(trust_anchors[0]));br_ssl_engine_set_buffer(&t->client.eng,t->buffer,sizeof(t->buffer),1);br_ssl_engine_set_versions(&t->client.eng,BR_TLS12,BR_TLS12);br_ssl_engine_inject_entropy(&t->client.eng,seed,sizeof(seed));memset(seed,0,sizeof(seed));
 time_t now=time(NULL);if(now<1609459200){free(t);return -2;}br_x509_minimal_set_time(&t->validator,(uint32_t)(now/86400)+719528,(uint32_t)(now%86400));
 if(!br_ssl_client_reset(&t->client,host,0)){free(t);return -2;}s->tls=t;pump(s);return 0;
}
static void accept_next(Socket *s);
static void on_accept(void *data,int32_t result){Socket *s=find((int)(intptr_t)data);if(!s)return;if(result!=PP_OK){emit(NET_ERROR,s->id,result,NULL,0,NULL,0);return;}Socket *child=allocate(1);if(!child){tcp->Close(s->accepted);release(&s->accepted);}else{child->socket=s->accepted;s->accepted=0;child->connected=1;char host[64];int port;PP_Resource addr=tcp->GetRemoteAddress(child->socket);endpoint(addr,host,&port);core->ReleaseResource(addr);emit(NET_ACCEPT,s->id,child->id,NULL,0,host,port);}accept_next(s);}
static void accept_next(Socket *s){dispatch(tcp->Accept(s->socket,&s->accepted,cb(on_accept,s->id)),on_accept,s->id);}
static void on_listen(void *data,int32_t result){Socket *s=find((int)(intptr_t)data);if(!s)return;if(result!=PP_OK){emit(NET_LISTENING,s->id,result,NULL,0,NULL,0);close_socket(s,result);return;}PP_Resource addr=tcp->GetLocalAddress(s->socket);char host[64];int port;endpoint(addr,host,&port);core->ReleaseResource(addr);emit(NET_LISTENING,s->id,0,NULL,0,host,port);accept_next(s);}
static void on_bind(void *data,int32_t result){Socket *s=find((int)(intptr_t)data);if(!s)return;if(result!=PP_OK){emit(NET_LISTENING,s->id,result,NULL,0,NULL,0);close_socket(s,result);return;}dispatch(tcp->Listen(s->socket,8,cb(on_listen,s->id)),on_listen,s->id);}
int net_listen(int port,int loopback){Socket *s=allocate(3);if(!s)return -8;s->socket=tcp->Create(instance);PP_Resource addr=ipv4(loopback?"127.0.0.1":"0.0.0.0",port);if(!addr){close_socket(s,-4);return -4;}int id=s->id;int r=tcp->Bind(s->socket,addr,cb(on_bind,id));core->ReleaseResource(addr);dispatch(r,on_bind,id);return id;}
static void udp_bound(void *data,int32_t result){Socket *s=find((int)(intptr_t)data);if(!s)return;if(result!=PP_OK){emit(NET_UDP_BOUND,s->id,result,NULL,0,NULL,0);close_socket(s,result);return;}PP_Resource a=udp->GetBoundAddress(s->socket);char host[64];int port;endpoint(a,host,&port);core->ReleaseResource(a);emit(NET_UDP_BOUND,s->id,0,NULL,0,host,port);}
int net_udp_bind(int id,const char *host,int port){Socket *s=find(id);if(!s||s->kind!=2)return -4;PP_Resource addr=ipv4(host,port);if(!addr)return -4;int r=udp->Bind(s->socket,addr,cb(udp_bound,id));core->ReleaseResource(addr);dispatch(r,udp_bound,id);return 0;}
static void udp_sent(void *data,int32_t result){Socket *s=find((int)(intptr_t)data);if(!s)return;s->writing=0;if(s->head)consume(s,s->head->len-s->head->offset);if(result<0)emit(NET_ERROR,s->id,result,NULL,0,NULL,0);}
int net_udp_send(int id,const char *host,int port,const void *data,size_t len){Socket *s=find(id);if(!s||s->kind!=2||s->writing||!len||len>65507||total_queued+len>QUEUE_TOTAL)return -4;PP_Resource addr=ipv4(host,port);if(!addr)return -4;Chunk *c=malloc(sizeof(*c)+len);if(!c){core->ReleaseResource(addr);return -8;}c->next=NULL;c->len=len;c->offset=0;memcpy(c->data,data,len);s->head=s->tail=c;s->queued=len;total_queued+=len;s->writing=1;int r=udp->SendTo(s->socket,(char*)c->data,len,addr,cb(udp_sent,id));core->ReleaseResource(addr);dispatch(r,udp_sent,id);return 0;}
int net_init(int app_instance,const void *(*get)(const char*),NetEvent event){instance=app_instance;emit=event;core=get(PPB_CORE_INTERFACE_1_0);vars=get(PPB_VAR_INTERFACE_1_2);tcp=get(PPB_TCPSOCKET_INTERFACE_1_1);udp=get(PPB_UDPSOCKET_INTERFACE_1_0);addresses=get(PPB_NETADDRESS_INTERFACE_1_0);dns=get(PPB_HOSTRESOLVER_INTERFACE_1_0);return core&&vars&&tcp&&udp&&addresses&&dns;}
void net_shutdown(void){for(int i=0;i<SLOTS;i++)if(sockets[i].id)close_socket(&sockets[i],0);}
int net_queued(int id){Socket *s=find(id);return s?(int)s->queued:-1;}
