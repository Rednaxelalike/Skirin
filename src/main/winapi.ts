import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Rect } from '../shared/types'

export interface NativeWindow {
  title: string
  process: string
  /** Screen coordinates in physical pixels. */
  rect: Rect
}

/**
 * Enumerates visible top-level windows in z-order (front-most first) using
 * user32/dwmapi through PowerShell, so we can offer Xnapper-style
 * snap-to-window highlighting without shipping a native module.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class SkirinWin {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT r, int size);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT r);

  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  const int GWL_STYLE = -16;
  const int GWL_EXSTYLE = -20;
  const int WS_CHILD = 0x40000000;
  const int WS_EX_TOOLWINDOW = 0x00000080;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  const int DWMWA_CLOAKED = 14;

  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int v, int size);

  public static string List() {
    var sb = new StringBuilder();
    sb.Append("[");
    bool first = true;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      int style = GetWindowLong(h, GWL_STYLE);
      int ex = GetWindowLong(h, GWL_EXSTYLE);
      if ((style & WS_CHILD) != 0) return true;
      if ((ex & WS_EX_TOOLWINDOW) != 0) return true;
      int cloaked = 0;
      if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
      int len = GetWindowTextLength(h);
      if (len == 0) return true;
      var title = new StringBuilder(len + 1);
      GetWindowText(h, title, title.Capacity);
      RECT r;
      if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(RECT))) != 0) {
        if (!GetWindowRect(h, out r)) return true;
      }
      int w = r.Right - r.Left, ht = r.Bottom - r.Top;
      if (w < 60 || ht < 60) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      string proc = "";
      try { proc = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch {}
      if (proc == "Skirin" || proc == "electron") return true;
      if (!first) sb.Append(",");
      first = false;
      sb.Append("{\\"title\\":" + Quote(title.ToString()) + ",\\"process\\":" + Quote(proc) +
        ",\\"x\\":" + r.Left + ",\\"y\\":" + r.Top + ",\\"width\\":" + w + ",\\"height\\":" + ht + "}");
      return true;
    }, IntPtr.Zero);
    sb.Append("]");
    return sb.ToString();
  }

  static string Quote(string s) {
    var sb = new StringBuilder("\\"");
    foreach (char c in s) {
      if (c == '"' || c == '\\\\') sb.Append('\\\\').Append(c);
      else if (c < 32) sb.Append(' ');
      else sb.Append(c);
    }
    return sb.Append("\\"").ToString();
  }
}
"@
[SkirinWin]::List()
`

let inflight: Promise<NativeWindow[]> | null = null
let scriptPath: string | null = null

/** Writing the script to disk and using -File avoids all CLI quoting hazards. */
function ensureScript(): string | null {
  if (scriptPath) return scriptPath
  try {
    const path = join(app.getPath('temp'), 'skirin-enum-windows.ps1')
    writeFileSync(path, SCRIPT, 'utf8')
    scriptPath = path
    return path
  } catch {
    return null
  }
}

export function listWindows(): Promise<NativeWindow[]> {
  if (process.platform !== 'win32') return Promise.resolve([])
  if (inflight) return inflight
  const path = ensureScript()
  if (!path) return Promise.resolve([])
  inflight = new Promise<NativeWindow[]>((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path],
      { timeout: 6000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve([])
          return
        }
        try {
          const raw = JSON.parse(stdout.trim()) as Array<{
            title: string
            process: string
            x: number
            y: number
            width: number
            height: number
          }>
          resolve(
            raw.map((w) => ({
              title: w.title,
              process: w.process,
              rect: { x: w.x, y: w.y, width: w.width, height: w.height }
            }))
          )
        } catch {
          resolve([])
        }
      }
    )
  }).finally(() => {
    inflight = null
  }) as Promise<NativeWindow[]>
  return inflight
}
