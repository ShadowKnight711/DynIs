//! Which media session the island follows.
//!
//! Windows keeps paused sessions around indefinitely (a browser tab that once
//! played a video, for example), and lists them in no useful order. Taking
//! "the first paused one" showed a stale browser song whenever the player you
//! actually use paused. Instead the island follows the app you last played:
//! a playing session always wins (the last-played app first); when nothing
//! plays, the last-played app stays, paused. Sessions that never played
//! while DynIs was running are ignored.

use std::collections::HashSet;

/// Browser media hosts, for the "Ignore browser media" setting.
pub fn is_browser(aumid: &str) -> bool {
    let id = aumid.to_ascii_lowercase();
    [
        "brave", "chrome", "msedge", "firefox", "308046b0af4a39cb", "opera", "vivaldi", "arc", "zen",
        "chromium",
    ]
    .iter()
    .any(|b| id == *b || id.starts_with(&format!("{b}.")) || id.contains(&format!("{b}.exe")))
}

/// Remembers what was played, across polls.
#[derive(Default)]
pub struct MediaPicker {
    pub last_played: Option<String>,
    pub played: HashSet<String>,
}

impl MediaPicker {
    /// `sessions` = (AUMID, is playing). Returns the index to show, if any.
    pub fn pick(&mut self, sessions: &[(String, bool)], ignore_browsers: bool) -> Option<usize> {
        let allowed = |id: &str| !(ignore_browsers && is_browser(id));
        for (id, playing) in sessions {
            if *playing && allowed(id) {
                self.played.insert(id.clone());
            }
        }
        let playing: Vec<usize> = sessions
            .iter()
            .enumerate()
            .filter(|(_, (id, p))| *p && allowed(id))
            .map(|(i, _)| i)
            .collect();
        let chosen = if !playing.is_empty() {
            // Prefer the app you were already following if it's still playing.
            playing
                .iter()
                .copied()
                .find(|&i| Some(&sessions[i].0) == self.last_played.as_ref())
                .unwrap_or(playing[0])
        } else {
            let last = self.last_played.as_ref()?;
            return sessions
                .iter()
                .position(|(id, _)| id == last && allowed(id) && self.played.contains(id));
        };
        self.last_played = Some(sessions[chosen].0.clone());
        Some(chosen)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(id: &str, playing: bool) -> (String, bool) {
        (id.to_string(), playing)
    }

    const AM: &str = "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App";

    #[test]
    fn a_stale_paused_browser_session_is_never_shown() {
        let mut p = MediaPicker::default();
        // Brave holds a paused video from before DynIs started; nothing plays.
        assert_eq!(p.pick(&[s("Brave", false), s(AM, false)], false), None);
    }

    #[test]
    fn pausing_keeps_the_app_you_last_played() {
        let mut p = MediaPicker::default();
        assert_eq!(p.pick(&[s("Brave", false), s(AM, true)], false), Some(1));
        // Apple Music pauses: stay on Apple Music, not the first paused session.
        assert_eq!(p.pick(&[s("Brave", false), s(AM, false)], false), Some(1));
    }

    #[test]
    fn a_new_player_takes_over_and_is_then_remembered() {
        let mut p = MediaPicker::default();
        p.pick(&[s(AM, true)], false);
        assert_eq!(p.pick(&[s(AM, false), s("Spotify.exe", true)], false), Some(1));
        assert_eq!(p.pick(&[s(AM, false), s("Spotify.exe", false)], false), Some(1));
    }

    #[test]
    fn the_followed_app_wins_when_two_play() {
        let mut p = MediaPicker::default();
        p.pick(&[s(AM, true)], false);
        assert_eq!(p.pick(&[s("Brave", true), s(AM, true)], false), Some(1));
    }

    #[test]
    fn browser_media_can_be_ignored() {
        let mut p = MediaPicker::default();
        assert_eq!(p.pick(&[s("Brave", true)], true), None);
        assert_eq!(p.pick(&[s("Brave", true), s(AM, true)], true), Some(1));
        assert!(is_browser("Brave"));
        assert!(is_browser("MSEdge"));
        assert!(is_browser("308046B0AF4A39CB"));
        assert!(!is_browser(AM));
    }
}
