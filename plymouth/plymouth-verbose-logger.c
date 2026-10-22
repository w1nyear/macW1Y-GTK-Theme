#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <fcntl.h>

static int connect_plymouth(void) {
    int s = socket(AF_UNIX, SOCK_STREAM, 0);
    if (s < 0) return -1;

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    const char *path = "/org/freedesktop/plymouthd";
    size_t len = strlen(path);
    addr.sun_path[0] = '\0';
    memcpy(&addr.sun_path[1], path, len);

    socklen_t addrlen = sizeof(sa_family_t) + 1 + len;
    if (connect(s, (struct sockaddr *)&addr, addrlen) < 0) {
        close(s);
        return -1;
    }
    return s;
}

static int send_message(int sock, const char *msg) {
    size_t msg_len = strlen(msg);
    if (msg_len > 180) msg_len = 180;

    unsigned char buf[512];
    buf[0] = 'M';
    buf[1] = 0x02;
    buf[2] = (unsigned char)(msg_len + 1);
    memcpy(&buf[3], msg, msg_len);
    buf[3 + msg_len] = '\0';

    size_t total = 3 + msg_len + 1;
    if (write(sock, buf, total) != (ssize_t)total) return -1;

    unsigned char ack;
    if (read(sock, &ack, 1) != 1) return -1;
    return 0;
}

int main(void) {
    if (access("/usr/share/plymouth/themes/apple-mac/verbose_on.png", F_OK) != 0 &&
        access("/etc/plymouth/verbose_on", F_OK) != 0) {
        return 0;
    }

    int sock = -1;
    for (int i = 0; i < 100; i++) {
        if (access("/run/plymouth/pid", F_OK) == 0) {
            sock = connect_plymouth();
            if (sock >= 0) break;
        }
        usleep(50000);
    }
    if (sock < 0) return 0;

    int kmsg = open("/dev/kmsg", O_RDONLY | O_NONBLOCK);
    if (kmsg < 0) {
        close(sock);
        return 0;
    }

    char kbuf[4096];
    while (access("/run/plymouth/pid", F_OK) == 0) {
        ssize_t n = read(kmsg, kbuf, sizeof(kbuf) - 1);
        if (n <= 0) {
            usleep(4000);
            continue;
        }
        kbuf[n] = '\0';
        char *semicolon = strchr(kbuf, ';');
        char *line = semicolon ? semicolon + 1 : kbuf;

        char *nl = strchr(line, '\n');
        if (nl) *nl = '\0';
        nl = strchr(line, '\r');
        if (nl) *nl = '\0';

        size_t l = strlen(line);
        if (l == 0) continue;
        if (l > 180) {
            line[180] = '\0';
            l = 180;
        }

        if (send_message(sock, line) < 0) {
            close(sock);
            sock = connect_plymouth();
            if (sock < 0) break;
            if (send_message(sock, line) < 0) break;
        }
        usleep(1000);
    }

    close(kmsg);
    if (sock >= 0) close(sock);
    return 0;
}
