use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            rclone_available,
            rclone_mount,
            rclone_unmount,
            default_mount_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arkive desktop");
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn sanitize_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.is_empty() {
        "workspace".into()
    } else {
        s
    }
}

#[tauri::command]
fn default_mount_dir(workspace_name: String) -> String {
    home_dir()
        .join("Arkive")
        .join(sanitize_name(&workspace_name))
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn rclone_available() -> bool {
    Command::new("rclone")
        .arg("version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn obscure_password(password: &str) -> Result<String, String> {
    let out = Command::new("rclone")
        .args(["obscure", password])
        .output()
        .map_err(|e| format!("rclone obscure failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "rclone obscure failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
fn rclone_mount(url: String, user: String, pass: String, mount_point: String) -> Result<String, String> {
    if !rclone_available() {
        return Err(
            "rclone not found on PATH. Install rclone (https://rclone.org/install/) and try again."
                .into(),
        );
    }
    let mount = PathBuf::from(&mount_point);
    if let Some(parent) = mount.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not create parent dir: {e}"))?;
    }
    std::fs::create_dir_all(&mount).map_err(|e| format!("could not create mount point: {e}"))?;

    // Refuse to mount over a non-empty directory (common FUSE requirement).
    let entries = std::fs::read_dir(&mount).map_err(|e| e.to_string())?;
    if entries.count() > 0 {
        return Err(format!(
            "mount point is not empty: {}. Choose an empty folder or unmount first.",
            mount.display()
        ));
    }

    let obscured = obscure_password(&pass)?;
    let url = url.trim_end_matches('/').to_string() + "/";

    let mut cmd = Command::new("rclone");
    cmd.arg("mount")
        .arg(":webdav:")
        .arg(&mount)
        .arg(format!("--webdav-url={url}"))
        .arg(format!("--webdav-user={user}"))
        .arg(format!("--webdav-pass={obscured}"))
        .arg("--vfs-cache-mode")
        .arg("writes")
        .arg("--daemon");

    let out = cmd
        .output()
        .map_err(|e| format!("failed to start rclone: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if detail.is_empty() {
            "rclone mount failed".into()
        } else {
            format!("rclone mount failed: {detail}")
        });
    }
    Ok(mount.to_string_lossy().to_string())
}

#[tauri::command]
fn rclone_unmount(mount_point: String) -> Result<(), String> {
    let mount = Path::new(&mount_point);

    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("fusermount3")
            .args(["-u", mount_point.as_str()])
            .output();
        let _ = Command::new("fusermount")
            .args(["-u", mount_point.as_str()])
            .output();
    }

    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("umount").arg(mount).output();
    }

    let out = Command::new("rclone")
        .args(["unmount", mount_point.as_str()])
        .output();

    match out {
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => {
            // If fusermount already succeeded, directory may no longer be a mount — treat as ok when empty of fuse.
            let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
            if !mount.exists() {
                return Ok(());
            }
            // Best-effort success if nothing is mounted there anymore.
            if err.to_lowercase().contains("not a mount")
                || err.to_lowercase().contains("not mounted")
                || err.is_empty()
            {
                return Ok(());
            }
            Err(format!("unmount failed: {err}"))
        }
        Err(e) => Err(format!("unmount failed: {e}")),
    }
}
