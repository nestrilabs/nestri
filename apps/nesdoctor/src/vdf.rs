//! A minimal reader for Valve's KeyValues text format (VDF).
//!
//! Steam writes several files we want in this format, and all of them are the
//! simple textual dialect: `"key" "value"` for leaves, `"key" { ... }` for
//! nodes, `//` to end of line for comments. There is a binary dialect and there
//! are `#include` and conditional (`[$WIN32]`) forms; **none of them appear in
//! the three files this crate reads**, so none of them are implemented.
//!
//! Written by hand rather than taken from a crate for the reason in
//! `Cargo.toml`: this code runs on a stranger's machine over their private game
//! library, and the whole dependency tree has to be reviewable.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Str(String),
    Node(BTreeMap<String, Value>),
}

impl Value {
    /// Walk a path of keys, case-insensitively.
    ///
    /// Steam is inconsistent about capitalisation across versions and
    /// platforms — `apps` vs `Apps`, `LastPlayed` vs `lastplayed` — and a
    /// case-sensitive lookup here silently returns nothing on some installs,
    /// which reads as "this user plays no games" rather than as a bug.
    pub fn get(&self, path: &[&str]) -> Option<&Value> {
        let mut cur = self;
        for want in path {
            let Value::Node(map) = cur else { return None };
            cur = map
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(want))
                .map(|(_, v)| v)?;
        }
        Some(cur)
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            Value::Node(_) => None,
        }
    }

    pub fn as_node(&self) -> Option<&BTreeMap<String, Value>> {
        match self {
            Value::Node(m) => Some(m),
            Value::Str(_) => None,
        }
    }

    /// A leaf read as an integer, tolerating the quoted decimals Steam writes.
    pub fn as_u64(&self) -> Option<u64> {
        self.as_str()?.trim().parse().ok()
    }
}

/// Parse a whole VDF document into its root node.
///
/// Malformed input yields whatever was read before the problem rather than an
/// error. That is deliberate: a truncated `localconfig.vdf` (Steam was killed
/// mid-write) should cost us one field, not the whole run.
pub fn parse(input: &str) -> Value {
    let mut p = Parser {
        b: input.as_bytes(),
        i: 0,
    };
    Value::Node(p.node(true))
}

struct Parser<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Parser<'a> {
    fn node(&mut self, top: bool) -> BTreeMap<String, Value> {
        let mut out = BTreeMap::new();
        loop {
            self.ws();
            match self.peek() {
                None => return out,
                Some(b'}') => {
                    if !top {
                        self.i += 1;
                    }
                    return out;
                }
                _ => {}
            }
            let Some(key) = self.token() else { return out };
            self.ws();
            match self.peek() {
                Some(b'{') => {
                    self.i += 1;
                    out.insert(key, Value::Node(self.node(false)));
                }
                None => return out,
                _ => match self.token() {
                    Some(v) => {
                        out.insert(key, Value::Str(v));
                    }
                    None => return out,
                },
            }
        }
    }

    fn peek(&self) -> Option<u8> {
        self.b.get(self.i).copied()
    }

    /// Skip whitespace and `//` comments.
    fn ws(&mut self) {
        loop {
            while matches!(self.peek(), Some(c) if c.is_ascii_whitespace()) {
                self.i += 1;
            }
            if self.b[self.i..].starts_with(b"//") {
                while !matches!(self.peek(), None | Some(b'\n')) {
                    self.i += 1;
                }
                continue;
            }
            return;
        }
    }

    /// One quoted or bare token. Handles `\\` and `\"`; Steam emits both in
    /// Windows paths inside `libraryfolders.vdf`.
    fn token(&mut self) -> Option<String> {
        match self.peek()? {
            b'"' => {
                self.i += 1;
                let mut s = String::new();
                loop {
                    match self.peek()? {
                        b'"' => {
                            self.i += 1;
                            return Some(s);
                        }
                        b'\\' => {
                            self.i += 1;
                            match self.peek()? {
                                b'n' => s.push('\n'),
                                b't' => s.push('\t'),
                                c => s.push(c as char),
                            }
                            self.i += 1;
                        }
                        c => {
                            // Push bytes and let String::from_utf8_lossy-style
                            // recovery happen naturally: paths may be non-UTF-8
                            // on Windows, and one bad path must not lose the file.
                            s.push(c as char);
                            self.i += 1;
                        }
                    }
                }
            }
            b'{' | b'}' => None,
            _ => {
                let start = self.i;
                while matches!(self.peek(), Some(c) if !c.is_ascii_whitespace() && c != b'{' && c != b'}')
                {
                    self.i += 1;
                }
                if self.i == start {
                    return None;
                }
                Some(String::from_utf8_lossy(&self.b[start..self.i]).into_owned())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_nodes_and_comments() {
        let v = parse(
            r#"
            // a comment
            "AppState"
            {
                "appid"      "730"
                "name"       "Counter-Strike 2"
                "SizeOnDisk" "38654705664"
                "nested" { "a" "1" }
            }
            "#,
        );
        assert_eq!(
            v.get(&["AppState", "name"]).unwrap().as_str(),
            Some("Counter-Strike 2")
        );
        assert_eq!(
            v.get(&["appstate", "sizeondisk"]).unwrap().as_u64(),
            Some(38654705664)
        );
        assert_eq!(
            v.get(&["AppState", "nested", "a"]).unwrap().as_u64(),
            Some(1)
        );
    }

    #[test]
    fn escaped_windows_path() {
        let v = parse(r#" "libraryfolders" { "0" { "path" "D:\\SteamLibrary" } } "#);
        assert_eq!(
            v.get(&["libraryfolders", "0", "path"]).unwrap().as_str(),
            Some(r"D:\SteamLibrary")
        );
    }

    /// Truncation must cost one field, not the document.
    #[test]
    fn truncated_input_keeps_what_it_read() {
        let v = parse(r#" "a" "1" "b" { "c" "2" "#);
        assert_eq!(v.get(&["a"]).unwrap().as_u64(), Some(1));
        assert_eq!(v.get(&["b", "c"]).unwrap().as_u64(), Some(2));
    }
}
