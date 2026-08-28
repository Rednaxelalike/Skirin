//! Windows' own screenshot keys, borrowed.
//!
//! Neither key can be taken with `RegisterHotKey`. Explorer holds `Win+Shift+S`
//! for the whole session, and Print Screen belongs to Snipping Tool through a
//! value under Explorer's `Advanced` key — so the accelerator path the other
//! shortcuts use fails on both. A low-level keyboard hook runs before the
//! shell's hotkey table is consulted, so it is the one place either key can be
//! taken without editing the user's Windows settings behind their back.
//! Nothing here outlives the toggle: drop the hook and Windows has its keys
//! back, no sign-out and no registry to put right.
//!
//! The hook sees every key, so it does the least it can — reads a virtual key
//! code, compares it against two combinations, and forgets it. No keystroke
//! is recorded, and nothing about one leaves this file.

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_S, VK_SHIFT,
    VK_SNAPSHOT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION, HHOOK, KBDLLHOOKSTRUCT,
    LLKHF_INJECTED, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
};

use crate::app::CaptureKind;
use crate::state::App;

/// The installed hook, as a plain integer because `HHOOK` is a raw pointer and
/// this has to be reachable from whichever thread flips the setting.
static HOOK: AtomicIsize = AtomicIsize::new(0);

/// Which of the two keys the hook should currently swallow. Read on every
/// keystroke, so it is a pair of flags rather than a lock.
static WATCH_PRINT_SCREEN: AtomicBool = AtomicBool::new(false);
static WATCH_SNIP: AtomicBool = AtomicBool::new(false);

fn held(key: VIRTUAL_KEY) -> bool {
    unsafe { GetAsyncKeyState(key.0 as i32) as u16 & 0x8000 != 0 }
}

fn windows_key_held() -> bool {
    held(VK_LWIN) || held(VK_RWIN)
}

/// True for the key on its own. `Alt+PrtScn` and `Win+PrtScn` are separate
/// Windows features — the active window, and a shot filed into Pictures — and
/// taking the bare key should not quietly take those too.
fn unmodified() -> bool {
    !held(VK_CONTROL) && !held(VK_MENU) && !held(VK_SHIFT) && !windows_key_held()
}

unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let message = wparam.0 as u32;

    if code == HC_ACTION as i32 && (message == WM_KEYDOWN || message == WM_SYSKEYDOWN) {
        let event = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        // Only what a person actually pressed: a synthetic key is another
        // program's business, including our own if this ever sends one.
        let real = !event.flags.contains(LLKHF_INJECTED);

        let print_screen = event.vkCode == VK_SNAPSHOT.0 as u32
            && WATCH_PRINT_SCREEN.load(Ordering::Relaxed)
            && unmodified();
        let snip = event.vkCode == VK_S.0 as u32
            && WATCH_SNIP.load(Ordering::Relaxed)
            && held(VK_SHIFT)
            && windows_key_held();

        if real && (print_screen || snip) {
            fire();
            // Swallowed, so the shell never sees the combination and Snipping
            // Tool stays out of it. Shift's own key-down has already reached
            // the system, so letting go of the Windows key will not fall back
            // to opening the Start menu.
            return LRESULT(1);
        }
    }

    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

/// Hands the capture to a worker and returns immediately: a low-level hook
/// that overruns `LowLevelHooksTimeout` is dropped from the chain without
/// warning, and a capture is orders of magnitude slower than that budget.
fn fire() {
    let Some(app) = crate::state::handle() else {
        return;
    };
    tauri::async_runtime::spawn_blocking(move || {
        crate::app::run_capture(&app, CaptureKind::SystemArea);
    });
}

/// Installs, drops or leaves the hook to match the current settings.
///
/// Called on boot and whenever the toggles change, so — like `shortcuts::apply`
/// — there is one code path deciding what is live.
pub fn apply(app: &AppHandle) {
    let keys = app.state::<App>().store.settings().system_keys;
    WATCH_PRINT_SCREEN.store(keys.print_screen, Ordering::Relaxed);
    WATCH_SNIP.store(keys.snip, Ordering::Relaxed);

    let wanted = keys.print_screen || keys.snip;
    if wanted == (HOOK.load(Ordering::SeqCst) != 0) {
        return;
    }

    // A low-level hook is called on the thread that installed it, and that
    // thread has to be pumping messages — which here means the main one.
    let _ = app.run_on_main_thread(move || {
        let previous = HOOK.swap(0, Ordering::SeqCst);
        if previous != 0 {
            unsafe {
                let _ = UnhookWindowsHookEx(HHOOK(previous as *mut _));
            }
        }
        if !wanted {
            return;
        }

        match unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), None, 0) } {
            Ok(hook) => HOOK.store(hook.0 as isize, Ordering::SeqCst),
            Err(error) => eprintln!("[skirin] could not watch the Windows capture keys: {error}"),
        }
    });
}
