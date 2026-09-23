//! Whether this machine is running on its battery.
//!
//! The interface offers "keep indexing on battery" as a switch, and a switch
//! that changes nothing is worse than no switch at all. Answering the question
//! needs one number from the operating system, so this module asks for it
//! directly rather than adding a dependency to pull it in.
//!
//! A machine with no battery, a query that fails, and a platform this does not
//! know are all answered with `false` — "assume mains power". Guessing the other
//! way would silently stop indexing on a desktop that never had a battery.

/// True when the machine is currently drawing from its battery.
///
/// Deliberately a single cheap call: the pipeline asks per job, not per file,
/// and the answer is cached by the caller for a few seconds.
pub fn on_battery() -> bool {
    platform::on_battery()
}

#[cfg(windows)]
mod platform {
    /// `SYSTEM_POWER_STATUS`, from `GetSystemPowerStatus`.
    #[repr(C)]
    #[derive(Default)]
    struct SystemPowerStatus {
        ac_line_status: u8,
        battery_flag: u8,
        battery_life_percent: u8,
        reserved: u8,
        battery_life_time: u32,
        battery_full_life_time: u32,
    }

    extern "system" {
        fn GetSystemPowerStatus(status: *mut SystemPowerStatus) -> i32;
    }

    pub fn on_battery() -> bool {
        let mut status = SystemPowerStatus::default();
        // SAFETY: `status` is a plain-data struct with the layout the API
        // documents, and it outlives the call.
        let answered = unsafe { GetSystemPowerStatus(&mut status) };
        if answered == 0 {
            return false;
        }
        // AC_LINE_STATUS: 0 = offline (on battery), 1 = online, 255 = unknown.
        status.ac_line_status == 0
    }
}

#[cfg(target_os = "linux")]
mod platform {
    pub fn on_battery() -> bool {
        let Ok(entries) = std::fs::read_dir("/sys/class/power_supply") else {
            return false;
        };
        let mut saw_adapter = false;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("AC") && !name.starts_with("ADP") && !name.starts_with("ACAD") {
                continue;
            }
            let Ok(value) = std::fs::read_to_string(entry.path().join("online")) else {
                continue;
            };
            saw_adapter = true;
            if value.trim() == "0" {
                return true;
            }
        }
        // No adapter at all means the power state cannot be read.
        let _ = saw_adapter;
        false
    }
}

#[cfg(target_os = "macos")]
mod platform {
    pub fn on_battery() -> bool {
        let Ok(output) = std::process::Command::new("pmset")
            .args(["-g", "batt"])
            .output()
        else {
            return false;
        };
        let text = String::from_utf8_lossy(&output.stdout);
        // The first line reads "Now drawing from 'Battery Power'" or "'AC Power'".
        text.contains("Battery Power")
    }
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
mod platform {
    pub fn on_battery() -> bool {
        false
    }
}
