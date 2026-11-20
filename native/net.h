#ifndef TV23_NET_H
#define TV23_NET_H
#include <stddef.h>
enum {NET_CONNECTED=1,NET_DATA,NET_CLOSED,NET_SECURED,NET_LISTENING,NET_ACCEPT,NET_UDP_BOUND,NET_UDP_DATA,NET_ERROR,NET_RESOLVED};
typedef void (*NetEvent)(int type,int id,int result,const void *data,size_t length,const char *host,int port);
int net_init(int instance,const void *(*get)(const char*),NetEvent event);
int net_open(int udp);
int net_connect(int id,const char *host,int port);
int net_secure(int id,const char *host);
int net_send(int id,const void *data,size_t length);
void net_resume(int id);
void net_close(int id);
int net_listen(int port,int loopback);
int net_udp_bind(int id,const char *host,int port);
int net_udp_send(int id,const char *host,int port,const void *data,size_t length);
int net_queued(int id);
int net_lookup(const char *host);
void net_shutdown(void);
#endif
