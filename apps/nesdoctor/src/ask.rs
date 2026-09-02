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
    pub asked: usize,
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
