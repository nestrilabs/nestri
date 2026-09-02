//! The five questions.
//!
//! Hard cap at five, branched on what was found, and every one of them either
//! tells us something no probe can or gates something. Three rules:
//!
//! - **Never ask what can be measured.** No question asks about upstream, hours
//!   powered, library size, or play schedule — those are probed. What is left is
//!   only what a machine cannot know: intent, and what someone already pays.
//! - **Ask about the present, not intentions about the future.** Hence *"what do
//!   you pay today"* rather than *"what would you pay"* — the first is a fact
//!   and the second is a ceiling.
//! - **Do not explain why we are asking before they answer**, because a
//!   cooperative respondent will help by giving the answer that appears wanted.
//!
//! Everything is skippable with Enter. A skipped answer is recorded as skipped
//! rather than as a default, because "did not say" and "said no" are different
//! data and collapsing them is how a survey lies.

use std::io::{BufRead, Write};

use serde::Serialize;

#[derive(Debug, Serialize, Default)]
pub struct Answers {
    /// The one question that could change the roadmap, so it is asked first and
    /// of everybody. Answer `remote` is a product with no capacity model, no
    /// library cost, no peak and no trough — and it is what the people we can
    /// currently reach are already doing for themselves. That is the
    /// uncomfortable possibility, which is the reason to ask rather than not.
    pub want: Option<String>,
    /// USERS.md 7, roughly: is this machine a host, a client, or both?
    pub role: Option<String>,
    /// USERS.md 6: cash or credit. Only asked of a machine that could host.
    pub share_for: Option<String>,
    /// USERS.md 5, in its factual form: current spend, not willingness to pay.
    pub pays_today: Option<String>,
    /// Asked only of a non-Linux machine: is there a Linux box behind it?
    pub other_linux: Option<String>,
    /// Consent gate, not a survey question.
    pub steam_consent: bool,
    /// Optional, and the only field in this program that identifies a person.
    /// Blank unless they typed one.
    pub email: Option<String>,
    pub asked: usize,
}

/// What to offer at the end, which depends on what the machine turned out to
/// be. The wording matters: telling someone with a grade-F line and no KVM that
/// we liked what their machine can do is a lie, and a tool whose whole argument
/// is that it does not flatter you cannot afford one.
pub enum Offer {
    /// The machine could host, or could with setup. These are the people we
    /// most want to talk to.
    Host,
    /// Everyone else. Early access as a player is a real offer too.
    Player,
}

pub struct Ctx {
    /// Whether the blocking host checks passed.
    pub could_host: bool,
    /// Whether the machine is plausibly capable regardless of software setup —
    /// used to decide if the cash-or-credit question is worth asking at all.
    pub capable: bool,
    pub is_linux: bool,
    pub steam_present: bool,
}

pub fn run(ctx: &Ctx) -> Answers {
    let mut a = Answers::default();
    println!("\n\x1b[1mFour or five questions, and Enter skips any of them.\x1b[0m");
    println!("\x1b[2mNothing here is sent anywhere. You will see the exact line before you\x1b[0m");
    println!("\x1b[2mshare it, and you can edit or discard it.\x1b[0m\n");

    // 1 — the roadmap question. First because it is the one whose answer we
    // would most regret not having, and because a respondent who quits after
    // one question should have answered this one.
    a.want = choose(
        "If Nestri could only do one of these well, which would you want?",
        &[
            ("cloud", "Play my games on your hardware, somewhere near me"),
            ("remote", "Reach my own gaming PC from anywhere"),
            ("both", "Both, equally"),
            ("watch", "Neither — just having a look"),
        ],
    );
    a.asked += 1;

    // 2 — role. Asked of everyone, because it decides what the rest means.
    a.role = choose(
        "What is this machine for?",
        &[
            ("play", "Playing games on"),
            ("host", "Hosting games for other people"),
            ("both", "Both"),
            ("look", "Just having a look"),
        ],
    );
    a.asked += 1;

    // 3 — cash or credit, only where it is not a hypothetical. Asking someone
    // whose machine cannot host what they would charge for it produces noise.
    if ctx.capable && matches!(a.role.as_deref(), Some("host") | Some("both") | None) {
        a.share_for = choose(
            "If this machine served another player while you were not using it, \
             would you rather have",
            &[
                ("credit", "Credit off my own subscription"),
                ("cash", "Cash"),
                ("either", "Either, I don't mind"),
                ("no", "Neither — I would not share it"),
            ],
        );
        a.asked += 1;
    }

    // 4 — current spend. The factual version of willingness to pay.
    a.pays_today = choose(
        "What do you pay a month for gaming right now, all in?",
        &[
            ("0", "Nothing"),
            ("1-9", "Under 10"),
            ("10-19", "10 to 19"),
            ("20-39", "20 to 39"),
            ("40+", "40 or more"),
        ],
    );
    a.asked += 1;

    // 5 — a client machine may still have a host behind it. This converts a
    // respondent who is not a candidate into a supply data point.
    if !ctx.is_linux {
        a.other_linux = choose(
            "Do you have another machine — a Linux one — that could host?",
            &[
                ("yes", "Yes"),
                ("could", "No, but I could set one up"),
                ("no", "No"),
            ],
        );
        a.asked += 1;
    }

    // The consent gate — not counted as one of the five. Last, so that by now the person has seen what this
    // program is and what it prints.
    if ctx.steam_present {
        println!();
        println!(
            "\x1b[1mOne permission.\x1b[0m Steam keeps, on this disk, the size of each game you"
        );
        println!("have installed and the time you last launched it. Reading it answers three");
        println!("things we would otherwise have to ask you badly: how big a library is, what");
        println!("shape it has, and what hours you actually play.");
        println!();
        println!("  \x1b[2mIt is read locally. Titles never appear in the shareable line — only");
        println!("  a count, a size band, and an hour histogram. You will see all of it.\x1b[0m");
        println!();
        a.steam_consent = yes_no("May I read it?", true);
    }

    if !ctx.could_host && ctx.is_linux {
        println!(
            "\n\x1b[2m(Skipped the hosting question — the checks above say this machine cannot \
             host yet.)\x1b[0m"
        );
    }
    a
}

/// A numbered single choice. Returns the stable key, not the label, so the
/// wording can change without breaking comparisons across runs.
fn choose(question: &str, options: &[(&str, &str)]) -> Option<String> {
    println!("\x1b[1m{question}\x1b[0m");
    for (i, (_, label)) in options.iter().enumerate() {
        println!("  {}) {}", i + 1, label);
    }
    loop {
        print!("  > ");
        let _ = std::io::stdout().flush();
        let line = read_line();
        let line = line.trim();
        if line.is_empty() {
            println!("  \x1b[2mskipped\x1b[0m\n");
            return None;
        }
        match line.parse::<usize>() {
            Ok(n) if n >= 1 && n <= options.len() => {
                println!();
                return Some(options[n - 1].0.to_string());
            }
            _ => println!("  \x1b[2m1–{}, or Enter to skip\x1b[0m", options.len()),
        }
    }
}

fn yes_no(question: &str, default_yes: bool) -> bool {
    let hint = if default_yes { "[Y/n]" } else { "[y/N]" };
    loop {
        print!("\x1b[1m{question}\x1b[0m {hint} ");
        let _ = std::io::stdout().flush();
        let line = read_line();
        match line.trim().to_ascii_lowercase().as_str() {
            "y" | "yes" => return true,
            "n" | "no" => return false,
            "" => return default_yes,
            _ => {}
        }
    }
}

fn read_line() -> String {
    let mut s = String::new();
    // EOF (a piped stdin, or Ctrl-D) reads as a skip rather than as an error:
    // this binary should still produce a report when run non-interactively.
    if std::io::stdin().lock().read_line(&mut s).is_err() {
        return String::new();
    }
    s
}

/// Offer early access, and take an email only if they want to give one.
///
/// This is the one identifying thing the program will ever collect, and it is
/// the reason the wording around it is careful:
///
/// - **It is asked last**, after the verdict, so nobody types an address before
///   seeing what the tool actually does.
/// - **Blank skips it**, and the prompt says so.
/// - **It is listed in the pre-submit disclosure** like everything else, and the
///   promise elsewhere had to be reworded, because "no username, no
///   identifiers" stops being true the moment this field exists. Quietly
///   leaving the old promise up would have been the dishonest option.
/// - **The offer is branched on the verdict.** Saying "we liked what your
///   machine can do" to a machine that cannot host is a lie, and this program's
///   only real asset is that it does not flatter anyone.
pub fn offer_early_access(offer: Offer) -> Option<String> {
    println!();
    match offer {
        Offer::Host => {
            println!("\x1b[1;32m  We would like to talk to you.\x1b[0m");
            println!(
                "\x1b[2m    Machines that can actually host are rare — most results are clients —\x1b[0m"
            );
            println!(
                "\x1b[2m    and yours is one. If you leave an email we will put you in the\x1b[0m"
            );
            println!(
                "\x1b[2m    first group to try Nestri, and ask you first when there is\x1b[0m"
            );
            println!("\x1b[2m    something to try.\x1b[0m");
        }
        Offer::Player => {
            println!("\x1b[1m  Want to be among the first to try Nestri?\x1b[0m");
            println!(
                "\x1b[2m    Leave an email and we will come to you when there is something\x1b[0m"
            );
            println!("\x1b[2m    worth playing. Nothing else — no newsletter, no list.\x1b[0m");
        }
    }
    println!();
    println!("\x1b[2m    This is the only thing here that identifies you, it is entirely\x1b[0m");
    println!(
        "\x1b[2m    optional, and it goes in the link with everything else so you will\x1b[0m"
    );
    println!("\x1b[2m    see it before it is sent.\x1b[0m");

    loop {
        print!("\x1b[1m  email\x1b[0m \x1b[2m(Enter to skip)\x1b[0m > ");
        let _ = std::io::stdout().flush();
        let line = read_line();
        let e = line.trim();
        if e.is_empty() {
            println!("  \x1b[2mskipped\x1b[0m");
            return None;
        }
        if plausible_email(e) {
            println!("  \x1b[32m✓\x1b[0m");
            return Some(e.to_string());
        }
        println!(
            "  \x1b[2mthat does not look like an address — try again, or Enter to skip\x1b[0m"
        );
    }
}

/// Deliberately loose. Rejecting a valid address is worse than accepting a junk
/// one: a bounce costs us nothing, and arguing with somebody about their own
/// email address over a regex is how you lose the response entirely.
fn plausible_email(s: &str) -> bool {
    if s.len() > 254 || s.contains(char::is_whitespace) {
        return false;
    }
    let Some((local, domain)) = s.split_once('@') else {
        return false;
    };
    !local.is_empty() && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
}

#[cfg(test)]
mod tests {
    use super::plausible_email;

    #[test]
    fn accepts_real_addresses() {
        for e in [
            "a@b.co",
            "first.last+tag@sub.example.com",
            "someone@example.co.uk",
            "x_y-z@example.io",
        ] {
            assert!(plausible_email(e), "{e} should be accepted");
        }
    }

    #[test]
    fn rejects_the_obvious() {
        for e in [
            "",
            "nope",
            "@example.com",
            "a@b",
            "a@.com",
            "a@b.",
            "a b@c.com",
        ] {
            assert!(!plausible_email(e), "{e} should be rejected");
        }
    }
}
