#include "mac_memtrim.h"
#include <malloc.h>

int mac_mem_trim(void) {
    return malloc_trim(0);
}
