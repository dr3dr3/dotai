#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

static void fail(const char *msg) { perror(msg); exit(1); }
static int endpoint(const char *path, int binding) {
    int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) fail("socket");
    struct sockaddr_un addr = {.sun_family = AF_UNIX};
    if (strlen(path) >= sizeof(addr.sun_path)) { fprintf(stderr,"path too long\n"); exit(1); }
    strcpy(addr.sun_path, path);
    int rc = binding ? bind(fd, (struct sockaddr *)&addr, sizeof(addr))
                     : connect(fd, (struct sockaddr *)&addr, sizeof(addr));
    if (rc < 0) { int saved = errno; close(fd); errno = saved; return -1; }
    return fd;
}
static void connect_check(const char *path, int denied) {
    int fd = endpoint(path, 0);
    if (denied) {
        if (fd >= 0) { close(fd); fprintf(stderr,"FAIL unexpected connect: %s\n",path); exit(1); }
        if (errno != EACCES && errno != EPERM) fail("inconclusive denial (not permission)");
    } else { if (fd < 0) fail("expected connect"); close(fd); }
}
static void bind_check(const char *path, int denied) {
    int fd = endpoint(path, 1);
    if (denied) {
        if (fd >= 0) { close(fd); unlink(path); fprintf(stderr,"FAIL unexpected bind\n"); exit(1); }
        if (errno != EACCES && errno != EPERM) fail("inconclusive bind denial");
    } else { if (fd < 0) fail("expected bind"); close(fd); if (unlink(path)) fail("unlink own socket"); }
}
static int child_status(pid_t pid) {
    int status;
    if (waitpid(pid, &status, 0) < 0) fail("waitpid");
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
int main(int argc, char **argv) {
    setbuf(stdout, NULL);
    alarm(45);
    const char *allowed = "/tmp/probe-sockets/allowed.sock";
    const char *denied = "/tmp/probe-sockets/control.sock";
    if (argc == 2 && !strcmp(argv[1], "child")) {
        connect_check(denied, 1);
        puts("PASS: subprocess cannot connect to live control fixture");
        return 0;
    }
    if (argc == 2 && !strcmp(argv[1], "restricted")) {
        connect_check(allowed, 0);
        connect_check(denied, 1);
        bind_check("/tmp/probe-output/own/runtime.sock", 0);
        bind_check("/tmp/probe-output/ungranted.sock", 1);
        pid_t pid = fork();
        if (pid < 0) fail("fork");
        if (!pid) { execl("/tmp/probe/socket-probe", "socket-probe", "child", NULL); _exit(127); }
        if (child_status(pid)) return 1;
        puts("PASS: live allowed connect, denied control connect, own bind, denied sibling bind, child inheritance");
        return 0;
    }
    if (argc != 1) return 2;
    int a = endpoint(allowed, 1), b = endpoint(denied, 1);
    if (a < 0 || b < 0) fail("fixture bind");
    if (listen(a, 8) || listen(b, 8)) fail("fixture listen");
    connect_check(allowed, 0); connect_check(denied, 0);
    bind_check("/tmp/probe-output/own/runtime.sock", 0);
    bind_check("/tmp/probe-output/ungranted.sock", 0);
    puts("PASS: unsandboxed controls can connect to both live fixtures and bind both paths");
    pid_t pid = fork();
    if (pid < 0) fail("fork");
    if (!pid) {
        execl("/tmp/probe/nono", "nono", "run", "--profile", "/tmp/probe/profile.json", "--allow-cwd", "--no-rollback", "--", "/tmp/probe/socket-probe", "restricted", NULL);
        _exit(127);
    }
    int rc = child_status(pid);
    close(a); close(b);
    if (unlink(allowed) || unlink(denied)) fail("fixture cleanup");
    return rc;
}
