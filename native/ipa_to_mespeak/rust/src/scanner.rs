#[derive(Debug, Clone, Copy)]
pub struct Rule {
    pub voice: &'static str,
    pub input: &'static str,
    pub output: &'static str,
    pub kind: &'static str,
    pub id: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SynthesisResult {
    pub supported: bool,
    pub voice: Option<String>,
    pub phonemes: Option<String>,
    pub reason: Option<String>,
    pub offset: Option<usize>,
}

impl SynthesisResult {
    pub fn supported(voice: &str, phonemes: String) -> Self {
        Self {
            supported: true,
            voice: Some(voice.to_string()),
            phonemes: Some(phonemes),
            reason: None,
            offset: None,
        }
    }

    pub fn unsupported(reason: &str, offset: usize) -> Self {
        Self {
            supported: false,
            voice: None,
            phonemes: None,
            reason: Some(reason.to_string()),
            offset: Some(offset),
        }
    }
}

pub fn synthesize_with_aliases(
    voice: &str,
    ipa: &str,
    rules: &[Rule],
    voices: &[&str],
    voice_aliases: &[(&str, &str)],
) -> SynthesisResult {
    if voice == "zh-auto" {
        return synthesize_zh_auto(ipa, rules, voices);
    }
    if voice == "en-auto" {
        return synthesize_en_auto(ipa, rules);
    }
    if voice == "pt-auto" {
        return synthesize_pt_auto(ipa, rules);
    }

    let canonical_voice = canonical_voice(voice, voice_aliases).unwrap_or(voice);

    if !voices.contains(&canonical_voice) {
        return SynthesisResult::unsupported("unsupported_voice", 0);
    }

    scan_voice(canonical_voice, ipa, rules)
}

fn canonical_voice<'a>(voice: &'a str, voice_aliases: &'a [(&'a str, &'a str)]) -> Option<&'a str> {
    voice_aliases
        .iter()
        .find_map(|(input, canonical)| if *input == voice { Some(*canonical) } else { None })
}

fn synthesize_zh_auto(ipa: &str, rules: &[Rule], _voices: &[&str]) -> SynthesisResult {
    let mandarin = scan_voice("zh", ipa, rules);
    let yue = scan_voice("zh-yue", ipa, rules);

    match (mandarin.supported, yue.supported) {
        (true, false) => mandarin,
        (false, true) => yue,
        (false, false) => SynthesisResult::unsupported("unsupported", 0),
        (true, true) => SynthesisResult::unsupported("unsupported_ambiguous_voice", 0),
    }
}

fn synthesize_en_auto(ipa: &str, rules: &[Rule]) -> SynthesisResult {
    let us = scan_voice("en-us", ipa, rules);
    if us.supported || !has_rp_fallback_marker(ipa) {
        return us;
    }

    scan_voice("en-gb-x-rp", ipa, rules)
}

fn synthesize_pt_auto(ipa: &str, rules: &[Rule]) -> SynthesisResult {
    let brazilian = scan_voice("pt", ipa, rules);
    if brazilian.supported {
        return brazilian;
    }

    let european = scan_voice("pt-pt", ipa, rules);
    if european.supported {
        return european;
    }

    brazilian
}

fn has_rp_fallback_marker(ipa: &str) -> bool {
    let normalized = normalize_positional_ipa_variants(trim_wrappers(ipa));
    ["ɪ", "ʊ", "ɛ", "əʊ", "ɒ", "ɑː", "ɔː", "ɜː"]
        .iter()
        .any(|marker| normalized.contains(marker))
}

fn scan_voice(voice: &str, ipa: &str, rules: &[Rule]) -> SynthesisResult {
    let normalized_input = normalize_positional_ipa_variants(trim_wrappers(ipa));
    let input = normalized_input.as_str();
    let mut output = String::new();
    let mut offset = 0;

    while offset < input.len() {
        let remaining = &input[offset..];
        if remaining.starts_with(char::is_whitespace) {
            output.push(' ');
            offset += remaining.chars().next().unwrap().len_utf8();
            continue;
        }

        if let Some(rule) = longest_match(voice, input, offset, rules) {
            if rule.kind == "reject" {
                return SynthesisResult::unsupported(rule.id, offset);
            }
            output.push_str(rule.output);
            offset += rule.input.len();
            continue;
        }

        return SynthesisResult::unsupported("unsupported_token", offset);
    }

    SynthesisResult::supported(voice, output)
}

fn trim_wrappers(ipa: &str) -> &str {
    ipa.trim()
        .trim_start_matches('/')
        .trim_end_matches('/')
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim()
}

fn normalize_positional_ipa_variants(ipa: &str) -> String {
    ipa.replace('\u{035c}', "\u{0361}")
        .replace('\u{030d}', "\u{0329}")
}

fn longest_match<'a>(voice: &str, input: &str, offset: usize, rules: &'a [Rule]) -> Option<&'a Rule> {
    let remaining = &input[offset..];
    rules
        .iter()
        .filter(|rule| {
            rule.voice == voice
                && !rule.input.is_empty()
                && remaining.starts_with(rule.input)
                && rule_applies(rule, input, offset)
        })
        .max_by_key(|rule| (rule.input.len(), rule_priority(rule)))
}

fn rule_applies(rule: &Rule, input: &str, offset: usize) -> bool {
    if rule.kind == "final_segment" {
        return offset + rule.input.len() == input.len();
    }
    if rule.kind == "post_vowel_before_nonvowel_length" {
        let previous = input[..offset].chars().next_back();
        let next_offset = offset + rule.input.len();
        let next = input[next_offset..].chars().next();
        return previous.is_some_and(is_turkish_vowel_input)
            && next.is_none_or(|value| !is_turkish_vowel_input(value));
    }
    true
}

fn is_turkish_vowel_input(value: char) -> bool {
    matches!(
        value,
        'a' | 'ɑ' | 'æ' | 'e' | 'ɛ' | 'ə' | 'ɯ' | 'i' | 'ɪ' | 'o' | 'ɔ' | 'œ' | 'u' | 'ʊ' | 'y' | 'ʏ'
    )
}

fn rule_priority(rule: &Rule) -> u8 {
    match rule.kind {
        "reject" => 3,
        "final_segment" => 2,
        _ => 1,
    }
}
