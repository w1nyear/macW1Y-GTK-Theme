#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <math.h>
#include <time.h>
#include <signal.h>
#include <dirent.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <stdint.h>
#include <linux/input.h>
#include <linux/uinput.h>

#define MAX_SLOTS 16

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
    MODE_ALTTAB,
    MODE_OVERVIEW,
    MODE_PINCH_DONE
};

static enum GestureMode current_mode = MODE_IDLE;

static int uinput_fd = -1;
static int sock_fd = -1;

struct TouchpadConfig {
    int drag_mode;          // 0: fullscreen, 1: normal
    int copy_paste_enabled; // 0: disabled, 1: enabled
    int gesture_delay_ms;   // delay in ms (default 250)
};

static void read_touchpad_config(struct TouchpadConfig *cfg) {
    cfg->drag_mode = 0;
    cfg->copy_paste_enabled = 1;
    cfg->gesture_delay_ms = 250;
    char conf_path[512] = {0};
    const char *home = getenv("HOME");
    if (home && strcmp(home, "/root") != 0) {
        snprintf(conf_path, sizeof(conf_path), "%s/.config/mac-touchpad.conf", home);
    } else {
        if (access("/home/vitaliy/.config/mac-touchpad.conf", R_OK) == 0) {
            strncpy(conf_path, "/home/vitaliy/.config/mac-touchpad.conf", sizeof(conf_path) - 1);
        } else if (access("/home/vitaliy/MACTHEMEFILES/touchpad/mac-touchpad.conf", R_OK) == 0) {
            strncpy(conf_path, "/home/vitaliy/MACTHEMEFILES/touchpad/mac-touchpad.conf", sizeof(conf_path) - 1);
        } else {
            snprintf(conf_path, sizeof(conf_path), "/etc/mac-touchpad.conf");
        }
    }
    FILE *f = fopen(conf_path, "r");
    if (!f) return;
    char line[256];
    while (fgets(line, sizeof(line), f)) {
        if (strstr(line, "drag_mode=normal")) cfg->drag_mode = 1;
        else if (strstr(line, "drag_mode=fullscreen")) cfg->drag_mode = 0;
        else if (strstr(line, "copy_paste_enabled=0")) cfg->copy_paste_enabled = 0;
        else if (strstr(line, "copy_paste_enabled=1")) cfg->copy_paste_enabled = 1;
        else if (sscanf(line, "gesture_delay_ms=%d", &cfg->gesture_delay_ms) == 1) {}
    }
    fclose(f);
    if (cfg->gesture_delay_ms < 50) cfg->gesture_delay_ms = 50;
    if (cfg->gesture_delay_ms > 1000) cfg->gesture_delay_ms = 1000;
}

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
    ssize_t ret = write(fd, &ie, sizeof(ie));
    (void)ret;
}

static void emit_syn(int fd) {
    emit_event(fd, EV_SYN, SYN_REPORT, 0);
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

static void ensure_socket(void) {
    if (sock_fd >= 0) return;

    static long long last_attempt = 0;
    long long now = get_time_ms();
    if (now - last_attempt < 500) return;
    last_attempt = now;

    char sock_path[512] = {0};
    const char *runtime_dir = getenv("XDG_RUNTIME_DIR");
    if (runtime_dir && runtime_dir[0] != '\0') {
        snprintf(sock_path, sizeof(sock_path), "%s/mac_touchpad.sock", runtime_dir);
    }

    if (sock_path[0] == '\0' || access(sock_path, F_OK) != 0) {
        if (access("/run/user/1000/mac_touchpad.sock", F_OK) == 0) {
            snprintf(sock_path, sizeof(sock_path), "/run/user/1000/mac_touchpad.sock");
        } else {
            DIR *d = opendir("/run/user");
            if (d) {
                struct dirent *de;
                while ((de = readdir(d)) != NULL) {
                    if (de->d_name[0] >= '1' && de->d_name[0] <= '9') {
                        char candidate[512];
                        snprintf(candidate, sizeof(candidate), "/run/user/%s/mac_touchpad.sock", de->d_name);
                        if (access(candidate, F_OK) == 0) {
                            snprintf(sock_path, sizeof(sock_path), "%s", candidate);
                            break;
                        }
                    }
                }
                closedir(d);
            }
        }
    }

    if (sock_path[0] == '\0') {
        snprintf(sock_path, sizeof(sock_path), "/run/user/%d/mac_touchpad.sock", getuid());
    }

    sock_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (sock_fd < 0) return;

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", sock_path);

    if (connect(sock_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        close(sock_fd);
        sock_fd = -1;
    } else {
        int flags = fcntl(sock_fd, F_GETFL, 0);
        fcntl(sock_fd, F_SETFL, flags | O_NONBLOCK);
        fprintf(stderr, "[mac-touchpad-daemon] Connected to GNOME Shell socket: %s\n", sock_path);
    }
}

static void send_to_shell(const char *msg) {
    ensure_socket();
    if (sock_fd >= 0) {
        ssize_t written = send(sock_fd, msg, strlen(msg), MSG_NOSIGNAL);
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
        }
    } else if (n == 0 || (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK)) {
        close(sock_fd);
        sock_fd = -1;
    }
}

static int open_touchpad_device(void) {
    DIR *dir = opendir("/dev/input");
    if (!dir) return -1;

    struct dirent *ent;
    char path[512];
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

    // Keyboard keys only for Ctrl+C, Ctrl+V, Super
    ioctl(fd, UI_SET_EVBIT, EV_KEY);
    ioctl(fd, UI_SET_KEYBIT, KEY_LEFTCTRL);
    ioctl(fd, UI_SET_KEYBIT, KEY_C);
    ioctl(fd, UI_SET_KEYBIT, KEY_V);
    ioctl(fd, UI_SET_KEYBIT, KEY_LEFTMETA);

    struct uinput_setup us;
    memset(&us, 0, sizeof(us));
    us.id.bustype = BUS_USB;
    us.id.vendor = 0x1234;
    us.id.product = 0x5678;
    strcpy(us.name, "macOS Virtual Touchpad Drag Device");

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
    signal(SIGPIPE, SIG_IGN);

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

    struct TouchpadConfig config;
    read_touchpad_config(&config);

    int tripletap = 0;
    int quadrap = 0;
    long long quad_down_time = 0;
    long long last_quad_tap_time = 0;
    long long last_quad_event_time = 0;
    int quad_start_x = 0, quad_start_y = 0;
    int quad_max_dist = 0;

    long long tri_down_time = 0;
    int tri_down_x = 0, tri_down_y = 0;
    double tri_initial_spread = 0.0;
    int tri_start_slots_captured = 0;
    int drag_last_x = 0, drag_last_y = 0;
    double drag_accum_x = 0.0, drag_accum_y = 0.0;
    int alttab_last_x = 0;
    int alttab_accum_x = 0;
    long long last_alttab_step_time = 0;

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
                        send_to_shell("DRAG_END\n");
                    } else if (current_mode == MODE_ALTTAB) {
                        send_to_shell("ALTTAB_END\n");
                    }
                    current_mode = MODE_IDLE;
                    drag_accum_x = 0.0;
                    drag_accum_y = 0.0;

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
                    // Reliable 4-finger tap: duration between 30ms and 450ms, max motion < 180 units
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
                        read_touchpad_config(&config);
                        current_mode = MODE_PENDING_TRI;
                        tri_down_time = now;
                        tri_start_slots_captured = 0;
                        send_to_shell("TRI_DOWN\n");

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
                    } else if (current_mode == MODE_ALTTAB) {
                        fprintf(stderr, "[mac-touchpad-daemon] 3-finger ALTTAB ended\n");
                        send_to_shell("ALTTAB_END\n");
                    }
                    send_to_shell("TRI_UP\n");
                    current_mode = MODE_IDLE;
                    tri_start_slots_captured = 0;
                    drag_accum_x = 0.0;
                    drag_accum_y = 0.0;
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

                    double d01 = hypot(xs[0] - xs[1], ys[0] - ys[1]);
                    double d12 = hypot(xs[1] - xs[2], ys[1] - ys[2]);
                    double d02 = hypot(xs[0] - xs[2], ys[0] - ys[2]);
                    double current_spread = (d01 + d12 + d02) / 3.0;

                    int centroid_x = (xs[0] + xs[1] + xs[2]) / 3;
                    int centroid_y = (ys[0] + ys[1] + ys[2]) / 3;

                    if (!tri_start_slots_captured) {
                        tri_down_x = centroid_x;
                        tri_down_y = centroid_y;
                        tri_initial_spread = current_spread;
                        tri_start_slots_captured = 1;
                    }

                    int delta_x_start = centroid_x - tri_down_x;
                    int delta_y_start = centroid_y - tri_down_y;
                    long long elapsed = now - tri_down_time;

                    // Sort fingers by y (top to bottom: y increases downwards)
                    int it = 0, im = 1, ib = 2;
                    if (ys[it] > ys[im]) { int t = it; it = im; im = t; }
                    if (ys[im] > ys[ib]) { int t = im; im = ib; ib = t; }
                    if (ys[it] > ys[im]) { int t = it; it = im; im = t; }
                    int x_T = xs[it], y_T = ys[it]; // Top (середній палець зверху)
                    int x_M = xs[im], y_M = ys[im]; // Mid (вказівний палець зліва)
                    int x_B = xs[ib], y_B = ys[ib]; // Bottom (головний/великий палець внизу)

                    // Enclosed triangle area (S = 0.5 * |x_T*(y_M - y_B) + x_M*(y_B - y_T) + x_B*(y_T - y_M)|)
                    double area = 0.5 * fabs((double)(x_T - x_M) * (y_B - y_M) - (double)(x_B - x_M) * (y_T - y_M));

                    // Geometry classification
                    int is_horizontal_row = 0;
                    if (span_x >= 70) {
                        if (span_y <= (int)(span_x * 0.45) || span_y <= 90) {
                            if (area <= 0.20 * ((double)span_x * span_y + 1000.0) || span_y <= 65) {
                                is_horizontal_row = 1;
                            }
                        }
                    }

                    int is_vertical_column = (span_y >= 300 && span_x <= (int)(span_y * 0.35));

                    // PENDING MODE CLASSIFICATION
                    if (current_mode == MODE_PENDING_TRI) {
                        // 1. PINCH GESTURES (Copy & Paste)
                        if (config.copy_paste_enabled && tri_start_slots_captured) {
                            // 1A. Pinch In (Copy): fingers converge together
                            if (tri_initial_spread >= 140.0) {
                                if ((current_spread <= tri_initial_spread * 0.70) || (tri_initial_spread - current_spread >= 110.0)) {
                                    current_mode = MODE_PINCH_DONE;
                                    fprintf(stderr, "[mac-touchpad-daemon] 3-finger PINCH IN -> Copy (init=%.1f, curr=%.1f)\n", tri_initial_spread, current_spread);
                                    send_to_shell("CMD_COPY\n");
                                    emit_key_combo(KEY_LEFTCTRL, KEY_C);
                                }
                            }
                            // 1B. Pinch Out / Spread (Paste): fingers expand outwards
                            if (tri_initial_spread <= 400.0 && current_mode == MODE_PENDING_TRI) {
                                if ((current_spread >= tri_initial_spread * 1.35) || (current_spread - tri_initial_spread >= 110.0)) {
                                    current_mode = MODE_PINCH_DONE;
                                    fprintf(stderr, "[mac-touchpad-daemon] 3-finger PINCH OUT -> Paste (init=%.1f, curr=%.1f)\n", tri_initial_spread, current_spread);
                                    send_to_shell("CMD_PASTE\n");
                                    emit_key_combo(KEY_LEFTCTRL, KEY_V);
                                }
                            }
                        }

                        // 2. HORIZONTAL ROW -> OVERVIEW (Swipe Up / Down)
                        // Even if fingers are close together in a row, smoothly trigger overview!
                        if (current_mode == MODE_PENDING_TRI && is_horizontal_row) {
                            if (delta_y_start <= -35) {
                                current_mode = MODE_OVERVIEW;
                                fprintf(stderr, "[mac-touchpad-daemon] HORIZONTAL ROW -> OVERVIEW_OPEN (dy=%d, span_x=%d, span_y=%d)\n",
                                        delta_y_start, span_x, span_y);
                                send_to_shell("OVERVIEW_OPEN\n");
                            } else if (delta_y_start >= 35) {
                                current_mode = MODE_OVERVIEW;
                                fprintf(stderr, "[mac-touchpad-daemon] HORIZONTAL ROW -> OVERVIEW_CLOSE (dy=%d, span_x=%d, span_y=%d)\n",
                                        delta_y_start, span_x, span_y);
                                send_to_shell("OVERVIEW_CLOSE\n");
                            }
                        }

                        // 3. VERTICAL COLUMN -> ALTTAB (Horizontal swipe)
                        if (current_mode == MODE_PENDING_TRI && is_vertical_column) {
                            if (abs(delta_x_start) >= 40) {
                                current_mode = MODE_ALTTAB;
                                alttab_last_x = centroid_x;
                                alttab_accum_x = 0;
                                last_alttab_step_time = now;
                                fprintf(stderr, "[mac-touchpad-daemon] VERTICAL COLUMN -> ALTTAB_START (span_y=%d, span_x=%d, dx=%d)\n",
                                        span_y, span_x, delta_x_start);
                                send_to_shell("ALTTAB_START\n");
                            }
                        }

                        // 4. MOVE / DRAG (CIRCLE FORMATION: "якщо розташувати кругом")
                        if (current_mode == MODE_PENDING_TRI) {
                            int is_circle_formation = 0;
                            if (!is_horizontal_row && !is_vertical_column) {
                                // Three fingers form a 2D circle/cluster
                                if (span_x >= 35 && span_y >= 35 && area >= 250.0) {
                                    // Spread must be stable (not pinching in or spreading out)
                                    if (tri_initial_spread > 0 &&
                                        current_spread >= tri_initial_spread * 0.68 &&
                                        current_spread <= tri_initial_spread * 1.32) {
                                        is_circle_formation = 1;
                                    }
                                }
                            }

                            if (is_circle_formation) {
                                int dist = (int)hypot(delta_x_start, delta_y_start);
                                if ((dist >= 20 && elapsed >= 50) ||
                                    (dist >= 12 && elapsed >= config.gesture_delay_ms)) {
                                    current_mode = MODE_DRAG;
                                    drag_last_x = centroid_x;
                                    drag_last_y = centroid_y;
                                    drag_accum_x = 0.0;
                                    drag_accum_y = 0.0;
                                    fprintf(stderr, "[mac-touchpad-daemon] 3-finger CIRCLE MOVE CONFIRMED (span_x=%d, span_y=%d, area=%.0f, spread=%.1f, dist=%d)\n",
                                            span_x, span_y, area, current_spread, dist);
                                    char msg[64];
                                    snprintf(msg, sizeof(msg), "DRAG_START %d %d\n", centroid_x, centroid_y);
                                    send_to_shell(msg);
                                }
                            }
                        }
                    }

                    // ACTIVE EXECUTION
                    if (current_mode == MODE_DRAG) {
                        int dx = centroid_x - drag_last_x;
                        int dy = centroid_y - drag_last_y;
                        if (dx != 0 || dy != 0) {
                            double scale_x = (config.drag_mode == 0) ? (1920.0 / 3815.0 * 1.45) : 0.65;
                            double scale_y = (config.drag_mode == 0) ? (1080.0 / 2377.0 * 1.45) : 0.65;
                            drag_accum_x += (double)dx * scale_x;
                            drag_accum_y += (double)dy * scale_y;
                            int mx = (int)round(drag_accum_x);
                            int my = (int)round(drag_accum_y);
                            if (mx != 0 || my != 0) {
                                char msg[128];
                                snprintf(msg, sizeof(msg), "DRAG_MOVE %d %d\n", mx, my);
                                send_to_shell(msg);
                                drag_accum_x -= (double)mx;
                                drag_accum_y -= (double)my;
                            }

                            drag_last_x = centroid_x;
                            drag_last_y = centroid_y;
                        }
                    } else if (current_mode == MODE_ALTTAB) {
                        int dx = centroid_x - alttab_last_x;
                        alttab_accum_x += dx;
                        alttab_last_x = centroid_x;

                        if (alttab_accum_x >= 350 && (now - last_alttab_step_time >= 220)) {
                            send_to_shell("ALTTAB_STEP +1\n");
                            alttab_accum_x = 0;
                            last_alttab_step_time = now;
                        } else if (alttab_accum_x <= -350 && (now - last_alttab_step_time >= 220)) {
                            send_to_shell("ALTTAB_STEP -1\n");
                            alttab_accum_x = 0;
                            last_alttab_step_time = now;
                        }
                    } else if (current_mode == MODE_OVERVIEW || current_mode == MODE_PINCH_DONE) {
                        // Handled; wait for finger release
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
