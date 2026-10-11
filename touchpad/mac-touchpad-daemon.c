#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <math.h>
#include <time.h>
#include <dirent.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <stdint.h>
#include <linux/input.h>
#include <linux/uinput.h>

#define MAX_SLOTS 16
#define SOCKET_PATH "/run/user/1000/mac_touchpad.sock"
#define CONFIG_PATH "/home/vitaliy/.config/mac-touchpad.conf"

struct slot_data {
    int active;
    int x;
    int y;
};

static struct slot_data slots[MAX_SLOTS];
static int current_slot = 0;

enum GestureMode {
    MODE_IDLE,
    MODE_PENDING_TRI,
    MODE_DRAG,
    MODE_ALTTAB
};

static enum GestureMode current_mode = MODE_IDLE;

static int uinput_fd = -1;
static int sock_fd = -1;

static long long get_time_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static void emit_event(int fd, uint16_t type, uint16_t code, int32_t val) {
    struct input_event ie;
    memset(&ie, 0, sizeof(ie));
    ie.type = type;
    ie.code = code;
    ie.value = val;
    write(fd, &ie, sizeof(ie));
}

static void emit_syn(int fd) {
    emit_event(fd, EV_SYN, SYN_REPORT, 0);
}

static void emit_mouse_btn(int pressed) {
    if (uinput_fd < 0) return;
    emit_event(uinput_fd, EV_KEY, BTN_LEFT, pressed ? 1 : 0);
    emit_syn(uinput_fd);
}

static void emit_mouse_rel(int dx, int dy) {
    if (uinput_fd < 0) return;
    if (dx != 0) emit_event(uinput_fd, EV_REL, REL_X, dx);
    if (dy != 0) emit_event(uinput_fd, EV_REL, REL_Y, dy);
    if (dx != 0 || dy != 0) emit_syn(uinput_fd);
}

static void emit_key_combo(uint16_t mod, uint16_t key) {
    if (uinput_fd < 0) return;
    emit_event(uinput_fd, EV_KEY, mod, 1);
    emit_syn(uinput_fd);
    usleep(25000); // 25ms
    emit_event(uinput_fd, EV_KEY, key, 1);
    emit_syn(uinput_fd);
    usleep(35000); // 35ms
    emit_event(uinput_fd, EV_KEY, key, 0);
    emit_syn(uinput_fd);
    usleep(25000); // 25ms
    emit_event(uinput_fd, EV_KEY, mod, 0);
    emit_syn(uinput_fd);
}

static int get_drag_mode(void) {
    // 0: Fullscreen (Ввесь екран - default), 1: Normal (Звичайний)
    FILE *f = fopen(CONFIG_PATH, "r");
    if (!f) return 0;
    char line[128];
    int mode = 0;
    while (fgets(line, sizeof(line), f)) {
        if (strstr(line, "drag_mode=normal")) mode = 1;
        else if (strstr(line, "drag_mode=fullscreen")) mode = 0;
    }
    fclose(f);
    return mode;
}

static void ensure_socket(void) {
    if (sock_fd >= 0) return;

    sock_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (sock_fd < 0) return;

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, SOCKET_PATH, sizeof(addr.sun_path) - 1);

    if (connect(sock_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        close(sock_fd);
        sock_fd = -1;
    } else {
        int flags = fcntl(sock_fd, F_GETFL, 0);
        fcntl(sock_fd, F_SETFL, flags | O_NONBLOCK);
    }
}

static void send_to_shell(const char *msg) {
    ensure_socket();
    if (sock_fd >= 0) {
        ssize_t written = write(sock_fd, msg, strlen(msg));
        if (written < 0) {
            close(sock_fd);
            sock_fd = -1;
        }
    }
}

static void check_incoming_socket_commands(void) {
    ensure_socket();
    if (sock_fd < 0) return;

    char buf[256];
    ssize_t n = read(sock_fd, buf, sizeof(buf) - 1);
    if (n > 0) {
        buf[n] = '\0';
        if (strstr(buf, "CMD_COPY")) {
            fprintf(stderr, "[mac-touchpad-daemon] Executing hardware Ctrl+C (Copy)\n");
            emit_key_combo(KEY_LEFTCTRL, KEY_C);
        } else if (strstr(buf, "CMD_PASTE")) {
            fprintf(stderr, "[mac-touchpad-daemon] Executing hardware Ctrl+V (Paste)\n");
            emit_key_combo(KEY_LEFTCTRL, KEY_V);
        } else if (strstr(buf, "EMIT_BTN_DOWN")) {
            fprintf(stderr, "[mac-touchpad-daemon] Executing mouse BTN_LEFT DOWN\n");
            emit_mouse_btn(1);
        } else if (strstr(buf, "EMIT_BTN_UP")) {
            fprintf(stderr, "[mac-touchpad-daemon] Executing mouse BTN_LEFT UP\n");
            emit_mouse_btn(0);
        }
    } else if (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK) {
        close(sock_fd);
        sock_fd = -1;
    }
}

static int open_touchpad_device(void) {
    DIR *dir = opendir("/dev/input");
    if (!dir) return -1;

    struct dirent *ent;
    char path[256];
    char name[256];

    while ((ent = readdir(dir)) != NULL) {
        if (strncmp(ent->d_name, "event", 5) != 0) continue;
        snprintf(path, sizeof(path), "/dev/input/%s", ent->d_name);
        int fd = open(path, O_RDONLY | O_NONBLOCK);
        if (fd < 0) continue;

        memset(name, 0, sizeof(name));
        if (ioctl(fd, EVIOCGNAME(sizeof(name)), name) >= 0) {
            if (strstr(name, "Touchpad") || strstr(name, "touchpad") || strstr(name, "TOUCHPAD")) {
                closedir(dir);
                return fd;
            }
        }
        close(fd);
    }
    closedir(dir);
    return -1;
}

static int create_uinput_device(void) {
    int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (fd < 0) return -1;

    // Keys & Buttons
    ioctl(fd, UI_SET_EVBIT, EV_KEY);
    ioctl(fd, UI_SET_KEYBIT, BTN_LEFT);
    ioctl(fd, UI_SET_KEYBIT, BTN_RIGHT);
    ioctl(fd, UI_SET_KEYBIT, BTN_MIDDLE);
    ioctl(fd, UI_SET_KEYBIT, KEY_LEFTCTRL);
    ioctl(fd, UI_SET_KEYBIT, KEY_C);
    ioctl(fd, UI_SET_KEYBIT, KEY_V);
    ioctl(fd, UI_SET_KEYBIT, KEY_LEFTMETA);

    // Relative Pointer
    ioctl(fd, UI_SET_EVBIT, EV_REL);
    ioctl(fd, UI_SET_RELBIT, REL_X);
    ioctl(fd, UI_SET_RELBIT, REL_Y);

    struct uinput_setup us;
    memset(&us, 0, sizeof(us));
    us.id.bustype = BUS_USB;
    us.id.vendor = 0x1234;
    us.id.product = 0x5678;
    strcpy(us.name, "macOS Virtual Touchpad Drag Mouse");

    if (ioctl(fd, UI_DEV_SETUP, &us) < 0) {
        close(fd);
        return -1;
    }
    if (ioctl(fd, UI_DEV_CREATE) < 0) {
        close(fd);
        return -1;
    }

    return fd;
}

int main(void) {
    int touch_fd = open_touchpad_device();
    if (touch_fd < 0) {
        fprintf(stderr, "[mac-touchpad-daemon] Error: Touchpad device not found in /dev/input!\n");
        return 1;
    }

    uinput_fd = create_uinput_device();
    if (uinput_fd < 0) {
        fprintf(stderr, "[mac-touchpad-daemon] Warning: /dev/uinput access failed, continuing without virtual device\n");
    }

    fprintf(stderr, "[mac-touchpad-daemon] Started successfully. Listening on touchpad...\n");

    int tripletap = 0;
    int quadrap = 0;
    long long quad_down_time = 0;
    long long last_quad_tap_time = 0;
    long long last_quad_event_time = 0;
    int quad_start_x = 0, quad_start_y = 0;
    int quad_max_dist = 0;

    long long tri_down_time = 0;
    int tri_down_x = 0, tri_down_y = 0;
    int drag_last_x = 0, drag_last_y = 0;
    int alttab_last_x = 0;
    int alttab_accum_x = 0;

    struct input_event ev;

    while (1) {
        check_incoming_socket_commands();

        ssize_t n = read(touch_fd, &ev, sizeof(ev));
        if (n < (ssize_t)sizeof(ev)) {
            usleep(2000); // 2ms sleep when idle
            continue;
        }

        if (ev.type == EV_ABS) {
            if (ev.code == ABS_MT_SLOT) {
                if (ev.value >= 0 && ev.value < MAX_SLOTS) {
                    current_slot = ev.value;
                }
            } else if (ev.code == ABS_MT_TRACKING_ID) {
                if (ev.value == -1) {
                    slots[current_slot].active = 0;
                } else {
                    slots[current_slot].active = 1;
                }
            } else if (ev.code == ABS_MT_POSITION_X) {
                slots[current_slot].x = ev.value;
            } else if (ev.code == ABS_MT_POSITION_Y) {
                slots[current_slot].y = ev.value;
            }
        } else if (ev.type == EV_KEY) {
            if (ev.code == BTN_TOOL_QUADTAP) {
                quadrap = ev.value;
                long long now = get_time_ms();
                last_quad_event_time = now;

                if (quadrap == 1) {
                    quad_down_time = now;
                    quad_max_dist = 0;

                    // Immediately cancel any active 3-finger gesture
                    if (current_mode == MODE_DRAG) {
                        emit_mouse_btn(0);
                        send_to_shell("DRAG_END\n");
                    } else if (current_mode == MODE_ALTTAB) {
                        send_to_shell("ALTTAB_END\n");
                    }
                    current_mode = MODE_IDLE;

                    int count = 0, sum_x = 0, sum_y = 0;
                    for (int i = 0; i < MAX_SLOTS; i++) {
                        if (slots[i].active) {
                            sum_x += slots[i].x; sum_y += slots[i].y; count++;
                        }
                    }
                    if (count > 0) {
                        quad_start_x = sum_x / count;
                        quad_start_y = sum_y / count;
                    }
                } else if (quadrap == 0) {
                    long long duration = now - quad_down_time;
                    // Reliable 4-finger tap: duration between 30ms and 450ms, max motion < 180 units (~5.8mm)
                    if (duration >= 30 && duration <= 450 && quad_max_dist < 180) {
                        long long time_since_last = now - last_quad_tap_time;
                        if (last_quad_tap_time > 0 && time_since_last <= 400) {
                            // Double tap -> Launchpad / App Grid
                            fprintf(stderr, "[mac-touchpad-daemon] 4-finger DOUBLE tap detected!\n");
                            send_to_shell("4FG_DOUBLE_TAP\n");
                            last_quad_tap_time = 0;
                        } else {
                            // Single tap -> Overview toggle
                            fprintf(stderr, "[mac-touchpad-daemon] 4-finger SINGLE tap detected!\n");
                            send_to_shell("4FG_TAP\n");
                            last_quad_tap_time = now;
                        }
                    }
                }
            } else if (ev.code == BTN_TOOL_TRIPLETAP) {
                tripletap = ev.value;
                long long now = get_time_ms();

                if (tripletap == 1) {
                    // Do not initiate 3-finger gestures immediately after 4-finger events
                    if (now - last_quad_event_time >= 180 && !quadrap) {
                        current_mode = MODE_PENDING_TRI;
                        tri_down_time = now;

                        int count = 0, sum_x = 0, sum_y = 0;
                        for (int i = 0; i < MAX_SLOTS; i++) {
                            if (slots[i].active) {
                                sum_x += slots[i].x; sum_y += slots[i].y; count++;
                            }
                        }
                        if (count > 0) {
                            tri_down_x = sum_x / count;
                            tri_down_y = sum_y / count;
                        } else {
                            tri_down_x = 0; tri_down_y = 0;
                        }
                    }
                } else if (tripletap == 0) {
                    if (current_mode == MODE_DRAG) {
                        fprintf(stderr, "[mac-touchpad-daemon] 3-finger DRAG ended\n");
                        send_to_shell("DRAG_END\n");
                        emit_mouse_btn(0);
                    } else if (current_mode == MODE_ALTTAB) {
                        fprintf(stderr, "[mac-touchpad-daemon] 3-finger ALTTAB ended\n");
                        send_to_shell("ALTTAB_END\n");
                    }
                    current_mode = MODE_IDLE;
                }
            }
        } else if (ev.type == EV_SYN && ev.code == SYN_REPORT) {
            long long now = get_time_ms();

            // Track 4-finger displacement
            if (quadrap) {
                int count = 0, sum_x = 0, sum_y = 0;
                for (int i = 0; i < MAX_SLOTS; i++) {
                    if (slots[i].active) {
                        sum_x += slots[i].x; sum_y += slots[i].y; count++;
                    }
                }
                if (count > 0) {
                    int cx = sum_x / count;
                    int cy = sum_y / count;
                    int dist = (int)hypot(cx - quad_start_x, cy - quad_start_y);
                    if (dist > quad_max_dist) quad_max_dist = dist;
                }
            }

            // Process 3-finger gestures
            if (tripletap && !quadrap && (now - last_quad_event_time >= 180)) {
                int xs[3], ys[3];
                int found = 0;
                for (int i = 0; i < MAX_SLOTS && found < 3; i++) {
                    if (slots[i].active) {
                        xs[found] = slots[i].x;
                        ys[found] = slots[i].y;
                        found++;
                    }
                }

                if (found == 3) {
                    int min_x = xs[0], max_x = xs[0];
                    int min_y = ys[0], max_y = ys[0];
                    for (int i = 1; i < 3; i++) {
                        if (xs[i] < min_x) min_x = xs[i];
                        if (xs[i] > max_x) max_x = xs[i];
                        if (ys[i] < min_y) min_y = ys[i];
                        if (ys[i] > max_y) max_y = ys[i];
                    }
                    int span_x = max_x - min_x;
                    int span_y = max_y - min_y;

                    int d01 = (int)hypot(xs[0] - xs[1], ys[0] - ys[1]);
                    int d12 = (int)hypot(xs[1] - xs[2], ys[1] - ys[2]);
                    int d02 = (int)hypot(xs[0] - xs[2], ys[0] - ys[2]);
                    int max_pair_dist = d01 > d12 ? (d01 > d02 ? d01 : d02) : (d12 > d02 ? d12 : d02);

                    int centroid_x = (xs[0] + xs[1] + xs[2]) / 3;
                    int centroid_y = (ys[0] + ys[1] + ys[2]) / 3;

                    int delta_x_start = centroid_x - tri_down_x;
                    int delta_y_start = centroid_y - tri_down_y;

                    // Classification if still pending
                    if (current_mode == MODE_PENDING_TRI) {
                        // 1. Circle cluster for Drag: tight group without spacing
                        // Compact span_x and span_y (< 800 units / ~25mm), max_pair_dist < 900
                        if (span_x < 800 && span_y < 800 && max_pair_dist < 900) {
                            current_mode = MODE_DRAG;
                            drag_last_x = centroid_x;
                            drag_last_y = centroid_y;
                            fprintf(stderr, "[mac-touchpad-daemon] 3-finger DRAG initiated (cluster: span_x=%d, span_y=%d, max_dist=%d)\n",
                                    span_x, span_y, max_pair_dist);
                            char msg[64];
                            snprintf(msg, sizeof(msg), "DRAG_START %d %d\n", centroid_x, centroid_y);
                            send_to_shell(msg);
                        }
                        // 2. Alt+Tab: Spaced vertically (span_y >= 750) or horizontally (span_x >= 750),
                        // and moving horizontally (|delta_x| >= 40)
                        else if ((span_y >= 750 || span_x >= 750 || abs(delta_x_start) >= 45) && abs(delta_x_start) >= 40) {
                            current_mode = MODE_ALTTAB;
                            alttab_last_x = centroid_x;
                            alttab_accum_x = 0;
                            fprintf(stderr, "[mac-touchpad-daemon] 3-finger ALTTAB initiated (span_y=%d, span_x=%d, dx=%d)\n",
                                    span_y, span_x, delta_x_start);
                            send_to_shell("ALTTAB_START\n");
                        }
                    }

                    // Active mode execution
                    if (current_mode == MODE_DRAG) {
                        int dx = centroid_x - drag_last_x;
                        int dy = centroid_y - drag_last_y;
                        if (dx != 0 || dy != 0) {
                            int mode = get_drag_mode();
                            int mx, my;
                            if (mode == 0) {
                                // Fullscreen: complete screen coverage (Ввесь екран)
                                mx = (int)round(dx * (1920.0 / 3815.0) * 1.4);
                                my = (int)round(dy * (1080.0 / 2377.0) * 1.4);
                            } else {
                                // Normal: standard relative sensitivity (Звичайний)
                                mx = (int)round(dx * 0.55);
                                my = (int)round(dy * 0.55);
                            }

                            emit_mouse_rel(mx, my);
                            char msg[128];
                            snprintf(msg, sizeof(msg), "DRAG_MOVE %d %d\n", mx, my);
                            send_to_shell(msg);

                            drag_last_x = centroid_x;
                            drag_last_y = centroid_y;
                        }
                    } else if (current_mode == MODE_ALTTAB) {
                        int dx = centroid_x - alttab_last_x;
                        alttab_accum_x += dx;
                        alttab_last_x = centroid_x;

                        // Step threshold: ~70 units of horizontal movement
                        if (alttab_accum_x >= 70) {
                            send_to_shell("ALTTAB_STEP +1\n");
                            alttab_accum_x = 0;
                        } else if (alttab_accum_x <= -70) {
                            send_to_shell("ALTTAB_STEP -1\n");
                            alttab_accum_x = 0;
                        }
                    }
                }
            }
        }
    }

    if (touch_fd >= 0) close(touch_fd);
    if (uinput_fd >= 0) {
        ioctl(uinput_fd, UI_DEV_DESTROY);
        close(uinput_fd);
    }
    if (sock_fd >= 0) close(sock_fd);
    return 0;
}
