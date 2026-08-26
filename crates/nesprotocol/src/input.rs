// Input event types over the QUIC bidi stream (flow ID 2).
// Format: [1B type][fixed-size payload], batched back-to-back.

pub const INPUT_KEY: u8 = 0;
pub const INPUT_MOUSE_MOVE: u8 = 1;
pub const INPUT_MOUSE_BUTTON: u8 = 2;
pub const INPUT_MOUSE_WHEEL: u8 = 3;

pub const INPUT_KEY_UP: u8 = 0;
pub const INPUT_KEY_DOWN: u8 = 1;

pub const INPUT_BTN_LEFT: u8 = 0;
pub const INPUT_BTN_MIDDLE: u8 = 1;
pub const INPUT_BTN_RIGHT: u8 = 2;

// ── Cursor update (reverse direction: nescope → hub → desktop-app) ──

/// Cursor update wire type sent from nescope back over the IPC socket.
pub const CURSOR_UPDATE: u8 = 0x80;

pub const CURSOR_HIDDEN: u8 = 0;
pub const CURSOR_NAMED: u8 = 1;
pub const CURSOR_SURFACE: u8 = 2;
pub const CURSOR_IMAGE: u8 = 0x81;

/// Parsed cursor image data from a CURSOR_IMAGE wire message.
#[derive(Debug, Clone)]
pub struct CursorImageData {
    pub x: f32,
    pub y: f32,
    pub width: u16,
    pub height: u16,
    pub hotspot_x: u16,
    pub hotspot_y: u16,
    pub rgba: Vec<u8>,
}

/// Encode a cursor image + position update.
///
/// Format: `[0x81][x:f32 LE][y:f32 LE][w:u16 LE][h:u16 LE][hx:u16 LE][hy:u16 LE][rgba_len:u32 LE][rgba...]`
pub fn encode_cursor_image(
    buf: &mut Vec<u8>,
    x: f32,
    y: f32,
    width: u16,
    height: u16,
    hotspot_x: u16,
    hotspot_y: u16,
    rgba: &[u8],
) {
    buf.push(CURSOR_IMAGE);
    buf.extend_from_slice(&x.to_le_bytes());
    buf.extend_from_slice(&y.to_le_bytes());
    buf.extend_from_slice(&width.to_le_bytes());
    buf.extend_from_slice(&height.to_le_bytes());
    buf.extend_from_slice(&hotspot_x.to_le_bytes());
    buf.extend_from_slice(&hotspot_y.to_le_bytes());
    buf.extend_from_slice(&(rgba.len() as u32).to_le_bytes());
    buf.extend_from_slice(rgba);
}

/// Decode a CURSOR_IMAGE message from raw wire bytes (including the 0x81 type byte).
/// Returns None if the buffer is invalid or too short.
pub fn decode_cursor_image(data: &[u8]) -> Option<CursorImageData> {
    if data.len() < 21 || data[0] != CURSOR_IMAGE {
        return None;
    }
    let x = f32::from_le_bytes([data[1], data[2], data[3], data[4]]);
    let y = f32::from_le_bytes([data[5], data[6], data[7], data[8]]);
    let width = u16::from_le_bytes([data[9], data[10]]);
    let height = u16::from_le_bytes([data[11], data[12]]);
    let hotspot_x = u16::from_le_bytes([data[13], data[14]]);
    let hotspot_y = u16::from_le_bytes([data[15], data[16]]);
    let rgba_len = u32::from_le_bytes([data[17], data[18], data[19], data[20]]) as usize;
    if data.len() < 21 + rgba_len {
        return None;
    }
    let rgba = data[21..21 + rgba_len].to_vec();
    Some(CursorImageData {
        x,
        y,
        width,
        height,
        hotspot_x,
        hotspot_y,
        rgba,
    })
}

/// Encode a cursor position + visibility update.
///
/// Format: `[0x80][x: f32 LE][y: f32 LE][status: u8]`
/// - status: `CURSOR_HIDDEN`, `CURSOR_NAMED`, or `CURSOR_SURFACE`
/// - x,y: logical coordinates in the output space
///
/// NOTE: Custom cursor surface (RGBA pixel) transmission is not yet
/// implemented. When it is, an additional variable-length payload containing
/// width, height, stride, and RGBA/BGRA pixels will follow the fixed header.
pub fn encode_cursor_update(buf: &mut Vec<u8>, x: f32, y: f32, status: u8) {
    buf.push(CURSOR_UPDATE);
    buf.extend_from_slice(&x.to_le_bytes());
    buf.extend_from_slice(&y.to_le_bytes());
    buf.push(status);
}

/// Decoded input event from the wire protocol.
#[derive(Debug, Clone)]
pub enum DecodedInput {
    Key { down: bool, keycode: u16 },
    MouseMove { dx: i16, dy: i16 },
    MouseButton { button: u8, down: bool },
    MouseWheel { dx: i16, dy: i16 },
}

/// Decode a single input event from raw wire bytes.
///
/// Format: `[type:1B][payload:N]` where:
/// - type=0 INPUT_KEY: payload=[down/up:1B][keycode:2B LE]
/// - type=1 INPUT_MOUSE_MOVE: payload=[dx:2B LE][dy:2B LE]
/// - type=2 INPUT_MOUSE_BUTTON: payload=[button:1B][down/up:1B] (0=left, 1=middle, 2=right)
/// - type=3 INPUT_MOUSE_WHEEL: payload=[dx:2B LE][dy:2B LE]
///
/// Returns `None` if the buffer is too short for the given event type or the
/// type byte is unknown.
pub fn decode_input_event(data: &[u8]) -> Option<DecodedInput> {
    if data.is_empty() {
        return None;
    }

    match data[0] {
        INPUT_KEY => {
            if data.len() < 4 {
                return None;
            }
            let down = data[1] == INPUT_KEY_DOWN;
            let keycode = u16::from_le_bytes([data[2], data[3]]);
            Some(DecodedInput::Key { down, keycode })
        }
        INPUT_MOUSE_MOVE => {
            if data.len() < 5 {
                return None;
            }
            let dx = i16::from_le_bytes([data[1], data[2]]);
            let dy = i16::from_le_bytes([data[3], data[4]]);
            Some(DecodedInput::MouseMove { dx, dy })
        }
        INPUT_MOUSE_BUTTON => {
            if data.len() < 3 {
                return None;
            }
            let button = data[1];
            if button > 2 {
                return None;
            }
            let down = data[2] == INPUT_KEY_DOWN;
            Some(DecodedInput::MouseButton { button, down })
        }
        INPUT_MOUSE_WHEEL => {
            if data.len() < 5 {
                return None;
            }
            let dx = i16::from_le_bytes([data[1], data[2]]);
            let dy = i16::from_le_bytes([data[3], data[4]]);
            Some(DecodedInput::MouseWheel { dx, dy })
        }
        _ => None,
    }
}

/// Encode a key event: [0][down/up][keycode u16 LE]
pub fn encode_key_event(buf: &mut Vec<u8>, down: bool, linux_keycode: u16) {
    buf.push(INPUT_KEY);
    buf.push(if down { INPUT_KEY_DOWN } else { INPUT_KEY_UP });
    buf.extend_from_slice(&linux_keycode.to_le_bytes());
}

/// Encode a mouse move: [1][dx i16 LE][dy i16 LE]
pub fn encode_mouse_move(buf: &mut Vec<u8>, dx: i16, dy: i16) {
    buf.push(INPUT_MOUSE_MOVE);
    buf.extend_from_slice(&dx.to_le_bytes());
    buf.extend_from_slice(&dy.to_le_bytes());
}

/// Encode a mouse button: [2][button][down/up]
pub fn encode_mouse_button(buf: &mut Vec<u8>, button: u8, down: bool) {
    buf.push(INPUT_MOUSE_BUTTON);
    buf.push(button);
    buf.push(if down { INPUT_KEY_DOWN } else { INPUT_KEY_UP });
}

/// Encode a mouse wheel: [3][dx i16 LE][dy i16 LE]
pub fn encode_mouse_wheel(buf: &mut Vec<u8>, dx: i16, dy: i16) {
    buf.push(INPUT_MOUSE_WHEEL);
    buf.extend_from_slice(&dx.to_le_bytes());
    buf.extend_from_slice(&dy.to_le_bytes());
}

/// Mapping from `KeyboardEvent.code` strings to Linux input keycodes.
/// Covers all essential gaming keys. Use `keymap_lookup(code)` to resolve.
pub fn keymap_lookup(code: &str) -> Option<u16> {
    Some(match code {
        // ── Letters ──
        "KeyA" => 30,
        "KeyB" => 48,
        "KeyC" => 46,
        "KeyD" => 32,
        "KeyE" => 18,
        "KeyF" => 33,
        "KeyG" => 34,
        "KeyH" => 35,
        "KeyI" => 23,
        "KeyJ" => 36,
        "KeyK" => 37,
        "KeyL" => 38,
        "KeyM" => 50,
        "KeyN" => 49,
        "KeyO" => 24,
        "KeyP" => 25,
        "KeyQ" => 16,
        "KeyR" => 19,
        "KeyS" => 31,
        "KeyT" => 20,
        "KeyU" => 22,
        "KeyV" => 47,
        "KeyW" => 17,
        "KeyX" => 45,
        "KeyY" => 21,
        "KeyZ" => 44,
        // ── Numbers ──
        "Digit0" => 11,
        "Digit1" => 2,
        "Digit2" => 3,
        "Digit3" => 4,
        "Digit4" => 5,
        "Digit5" => 6,
        "Digit6" => 7,
        "Digit7" => 8,
        "Digit8" => 9,
        "Digit9" => 10,
        // ── Function keys ──
        "F1" => 59,
        "F2" => 60,
        "F3" => 61,
        "F4" => 62,
        "F5" => 63,
        "F6" => 64,
        "F7" => 65,
        "F8" => 66,
        "F9" => 67,
        "F10" => 68,
        "F11" => 87,
        "F12" => 88,
        // ── Navigation ──
        "Escape" => 1,
        "Backquote" => 41,
        "Tab" => 15,
        "CapsLock" => 58,
        "ShiftLeft" => 42,
        "ControlLeft" => 29,
        "MetaLeft" => 125,
        "AltLeft" => 56,
        "Space" => 57,
        "AltRight" => 100,
        "MetaRight" => 126,
        "ControlRight" => 97,
        "ShiftRight" => 54,
        "Enter" => 28,
        "Backspace" => 14,
        // ── Arrow keys ──
        "ArrowUp" => 103,
        "ArrowDown" => 108,
        "ArrowLeft" => 105,
        "ArrowRight" => 106,
        // ── Editing ──
        "Insert" => 110,
        "Delete" => 111,
        "Home" => 102,
        "End" => 107,
        "PageUp" => 104,
        "PageDown" => 109,
        // ── Numpad ──
        "NumLock" => 69,
        "NumpadDivide" => 98,
        "NumpadMultiply" => 55,
        "NumpadSubtract" => 74,
        "NumpadAdd" => 78,
        "NumpadEnter" => 96,
        "NumpadDecimal" => 83,
        "Numpad0" => 82,
        "Numpad1" => 79,
        "Numpad2" => 80,
        "Numpad3" => 81,
        "Numpad4" => 75,
        "Numpad5" => 76,
        "Numpad6" => 77,
        "Numpad7" => 71,
        "Numpad8" => 72,
        "Numpad9" => 73,
        // ── Symbols ──
        "Minus" => 12,
        "Equal" => 13,
        "BracketLeft" => 26,
        "BracketRight" => 27,
        "Semicolon" => 39,
        "Quote" => 40,
        "Comma" => 51,
        "Period" => 52,
        "Slash" => 53,
        "Backslash" => 43,
        "IntlBackslash" => 86,
        // ── Media ──
        "PrintScreen" => 99,
        "ScrollLock" => 70,
        "Pause" => 119,
        _ => return None,
    })
}
