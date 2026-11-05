#include <windows.h>
#include <stdio.h>

static HMODULE g_hReal = NULL;
static PVOID g_veh = NULL;

static void log_msg(const char* msg) {
    FILE* f = fopen("C:\\metasec_proxy.log", "a");
    if (f) {
        fprintf(f, "%s\n", msg);
        fclose(f);
    }
}

static LONG WINAPI MetasecVehHandler(PEXCEPTION_POINTERS p) {
    if (p && p->ExceptionRecord) {
        DWORD code = p->ExceptionRecord->ExceptionCode;
        void* pc = p->ExceptionRecord->ExceptionAddress;
        
        if (code == EXCEPTION_ACCESS_VIOLATION) {
            ULONG_PTR fault_addr = p->ExceptionRecord->ExceptionInformation[1];
            HMODULE hMod = NULL;
            GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS, (LPCSTR)pc, &hMod);
            HMODULE hReal = g_hReal ? g_hReal : GetModuleHandleA("metasecml_real.dll");
            
            if ((hMod && hReal && hMod == hReal) || fault_addr == (ULONG_PTR)-1) {
                log_msg("[VEH] Intercepted metasec AV! Calling ExitThread(0)...");
                ExitThread(0);
                return EXCEPTION_CONTINUE_EXECUTION;
            }
        }
    }
    return EXCEPTION_CONTINUE_SEARCH;
}

BOOL WINAPI DllMain(HINSTANCE hinst, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hinst);
        g_hReal = LoadLibraryA("metasecml_real.dll");
        g_veh = AddVectoredExceptionHandler(1, MetasecVehHandler);
        log_msg("Proxy metasecml.dll attached, VEH registered, real DLL loaded.");
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_veh) {
            RemoveVectoredExceptionHandler(g_veh);
            g_veh = NULL;
        }
        if (g_hReal) {
            FreeLibrary(g_hReal);
            g_hReal = NULL;
        }
        log_msg("Proxy metasecml.dll detached.");
    }
    return TRUE;
}
