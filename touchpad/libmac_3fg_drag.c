#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <libinput.h>

struct libinput_event *libinput_get_event(struct libinput *li)
{
    static struct libinput_event *(*real_get_event)(struct libinput *) = NULL;
    static struct libinput_device *(*real_get_device)(struct libinput_event *) = NULL;
    static int (*real_get_finger_count)(struct libinput_device *) = NULL;
    static enum libinput_config_3fg_drag_state (*real_get_enabled)(struct libinput_device *) = NULL;
    static enum libinput_config_status (*real_set_enabled)(struct libinput_device *, enum libinput_config_3fg_drag_state) = NULL;
    static const char *(*real_dev_name)(struct libinput_device *) = NULL;
    static int initialized = 0;

    if (!initialized) {
        initialized = 1;
        real_get_event = dlsym(RTLD_NEXT, "libinput_get_event");
        real_get_device = dlsym(RTLD_NEXT, "libinput_event_get_device");
        real_get_finger_count = dlsym(RTLD_NEXT, "libinput_device_config_3fg_drag_get_finger_count");
        real_get_enabled = dlsym(RTLD_NEXT, "libinput_device_config_3fg_drag_get_enabled");
        real_set_enabled = dlsym(RTLD_NEXT, "libinput_device_config_3fg_drag_set_enabled");
        real_dev_name = dlsym(RTLD_NEXT, "libinput_device_get_name");
    }

    if (!real_get_event)
        return NULL;

    struct libinput_event *ev = real_get_event(li);
    if (ev && real_get_device && real_get_finger_count && real_get_enabled && real_set_enabled) {
        struct libinput_device *dev = real_get_device(ev);
        if (dev && real_get_finger_count(dev) >= 3) {
            if (real_get_enabled(dev) != LIBINPUT_CONFIG_3FG_DRAG_ENABLED_3FG) {
                enum libinput_config_status st = real_set_enabled(dev, LIBINPUT_CONFIG_3FG_DRAG_ENABLED_3FG);
                fprintf(stderr, "[libmac_3fg_drag] Auto-enabled native 3-finger drag on '%s' (status: %d)\n",
                        real_dev_name ? real_dev_name(dev) : "touchpad", (int)st);
            }
        }
    }
    return ev;
}

/* Also hook libinput_device_ref just in case devices are held */
struct libinput_device *libinput_device_ref(struct libinput_device *device)
{
    static struct libinput_device *(*real_ref)(struct libinput_device *) = NULL;
    static int (*real_get_finger_count)(struct libinput_device *) = NULL;
    static enum libinput_config_3fg_drag_state (*real_get_enabled)(struct libinput_device *) = NULL;
    static enum libinput_config_status (*real_set_enabled)(struct libinput_device *, enum libinput_config_3fg_drag_state) = NULL;
    static const char *(*real_dev_name)(struct libinput_device *) = NULL;
    static int ref_inited = 0;

    if (!ref_inited) {
        ref_inited = 1;
        real_ref = dlsym(RTLD_NEXT, "libinput_device_ref");
        real_get_finger_count = dlsym(RTLD_NEXT, "libinput_device_config_3fg_drag_get_finger_count");
        real_get_enabled = dlsym(RTLD_NEXT, "libinput_device_config_3fg_drag_get_enabled");
        real_set_enabled = dlsym(RTLD_NEXT, "libinput_device_config_3fg_drag_set_enabled");
        real_dev_name = dlsym(RTLD_NEXT, "libinput_device_get_name");
    }

    if (device && real_get_finger_count && real_get_enabled && real_set_enabled) {
        if (real_get_finger_count(device) >= 3) {
            if (real_get_enabled(device) != LIBINPUT_CONFIG_3FG_DRAG_ENABLED_3FG) {
                enum libinput_config_status st = real_set_enabled(device, LIBINPUT_CONFIG_3FG_DRAG_ENABLED_3FG);
                fprintf(stderr, "[libmac_3fg_drag] (ref) Auto-enabled native 3-finger drag on '%s' (status: %d)\n",
                        real_dev_name ? real_dev_name(device) : "touchpad", (int)st);
            }
        }
    }

    return real_ref ? real_ref(device) : device;
}
