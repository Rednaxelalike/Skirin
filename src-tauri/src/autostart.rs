//! "Launch Skirin when I sign in".
//!
//! A `Run` value rather than a Startup-folder shortcut: it survives the app
//! moving, needs no shell interop, and is the same key Electron's
//! `setLoginItemSettings` wrote to — so the toggle carries over from the old
//! build instead of appearing off for someone who had it on.

use windows::core::{w, PCWSTR};
use windows::Win32::System::Registry::{
    RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
    KEY_SET_VALUE, REG_SZ,
};

const VALUE: PCWSTR = w!("Skirin");

fn run_key() -> Option<HKEY> {
    let mut key = HKEY::default();
    let opened = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run"),
            None,
            KEY_SET_VALUE,
            &mut key,
        )
    };
    opened.is_ok().then_some(key)
}

pub fn set(enabled: bool) {
    let Some(key) = run_key() else {
        return;
    };

    if enabled {
        // `--tray` keeps a sign-in launch out of the way: the app comes up
        // holding its hotkeys, without throwing the editor at the user.
        let Ok(exe) = std::env::current_exe() else {
            unsafe {
                let _ = RegCloseKey(key);
            }
            return;
        };
        let command = format!("\"{}\" --tray", exe.to_string_lossy());
        let wide: Vec<u16> = command.encode_utf16().chain(std::iter::once(0)).collect();
        let bytes =
            unsafe { std::slice::from_raw_parts(wide.as_ptr() as *const u8, wide.len() * 2) };
        unsafe {
            let _ = RegSetValueExW(key, VALUE, None, REG_SZ, Some(bytes));
        }
    } else {
        unsafe {
            let _ = RegDeleteValueW(key, VALUE);
        }
    }

    unsafe {
        let _ = RegCloseKey(key);
    }
}
