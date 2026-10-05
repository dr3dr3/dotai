#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>
static void fail(const char *s) { perror(s); exit(1); }
static void connect_check(unsigned short port, int deny) {
    int fd=socket(AF_INET,SOCK_STREAM|SOCK_CLOEXEC,0);
    if(fd<0) fail("socket");
    struct sockaddr_in a={.sin_family=AF_INET,.sin_port=htons(port)};
    a.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
    int rc=connect(fd,(struct sockaddr*)&a,sizeof(a)); int err=errno; close(fd);
    if(deny) {
        if(rc==0) {fputs("FAIL direct TCP escaped proxy restriction\n",stderr);exit(1);}
        if(err!=EACCES && err!=EPERM) {errno=err;fail("inconclusive direct denial");}
    } else if(rc) {errno=err;fail("positive TCP control");}
}
int main(int argc,char **argv) {
    setbuf(stdout,NULL);alarm(50);
    if(argc==3 && !strcmp(argv[1],"direct")) {
        char *end;long n=strtol(argv[2],&end,10);
        if(*end || n<1 || n>65535) return 2;
        connect_check((unsigned short)n,1);
        puts("PASS: direct TCP permission denied");return 0;
    }
    if(argc!=1) return 2;
    int fd=socket(AF_INET,SOCK_STREAM|SOCK_CLOEXEC,0);if(fd<0)fail("listener");
    struct sockaddr_in a={.sin_family=AF_INET,.sin_addr.s_addr=htonl(INADDR_LOOPBACK)};
    if(bind(fd,(struct sockaddr*)&a,sizeof(a)) || listen(fd,8))fail("bind/listen");
    socklen_t len=sizeof(a);if(getsockname(fd,(struct sockaddr*)&a,&len))fail("getsockname");
    unsigned short port=ntohs(a.sin_port);connect_check(port,0);
    puts("PASS: unsandboxed direct TCP positive control");
    char number[8];snprintf(number,sizeof(number),"%u",port);
    pid_t pid=fork();if(pid<0)fail("fork");
    if(!pid) {
        execl("/tmp/probe/nono","nono","run","--profile","/tmp/probe/profile.json","--allow-cwd","--no-rollback","--","/bin/sh","/tmp/probe/check.sh",number,NULL);_exit(127);
    }
    int status;if(waitpid(pid,&status,0)<0)fail("waitpid");close(fd);
    return WIFEXITED(status)?WEXITSTATUS(status):1;
}
