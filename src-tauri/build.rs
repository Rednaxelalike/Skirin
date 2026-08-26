fn main() {
    // Settings → About reports the compiler the binary was produced by, the
    // way the Electron build reported its Node and Chromium versions.
    let rustc = std::process::Command::new(std::env::var("RUSTC").unwrap_or("rustc".into()))
        .arg("--version")
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .map(|line| {
            line.split_whitespace()
                .nth(1)
                .unwrap_or("unknown")
                .to_string()
        })
        .unwrap_or_else(|| "unknown".into());
    println!("cargo:rustc-env=SKIRIN_RUSTC={rustc}");

    tauri_build::build()
}
