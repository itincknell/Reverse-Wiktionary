use std::env;

use ipa_to_mespeak::synthesize_native;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() != 3 || args[1] == "--help" || args[1] == "-h" {
        eprintln!("usage: ipa-to-mespeak <voice> <ipa>");
        std::process::exit(if args.len() == 2 { 0 } else { 64 });
    }

    let result = synthesize_native(&args[1], &args[2]);
    println!(
        "{{\"supported\":{},\"voice\":{},\"phonemes\":{},\"reason\":{},\"offset\":{}}}",
        result.supported,
        json_optional_string(result.voice.as_deref()),
        json_optional_string(result.phonemes.as_deref()),
        json_optional_string(result.reason.as_deref()),
        result
            .offset
            .map(|value| value.to_string())
            .unwrap_or_else(|| "null".to_string())
    );
}

fn json_optional_string(value: Option<&str>) -> String {
    value
        .map(|text| format!("\"{}\"", json_escape(text)))
        .unwrap_or_else(|| "null".to_string())
}

fn json_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            character if character.is_control() => {
                escaped.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => escaped.push(character),
        }
    }
    escaped
}
