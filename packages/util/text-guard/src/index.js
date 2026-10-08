/**
 * Safety scan for untrusted text about to enter persisted, model-visible
 * context (long-term memories, agent-authored skill files). One pure function
 * classifies three finding kinds — invisible/bidirectional Unicode, prompt-
 * injection instructions, and credential-shaped tokens — without performing
 * I/O and without echoing the matched secret back in the finding detail.
 * @module @deepseek-ai/dsh-text-guard
 */
/**
 * Invisible and bidirectionally-reordering Unicode that can smuggle a second
 * reading of the text past a human reviewer: zero-width characters, left-to-
 * right/right-to-left marks and overrides, word joiners and invisible
 * operators, the byte-order mark, and Unicode tag characters.
 */
const INVISIBLE_UNICODE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u{E0000}-\u{E007F}]/gu;
/**
 * Prompt-instruction override patterns. Deliberately narrow, bilingual, and
 * phrase-anchored so ordinary technical prose never matches: each pattern
 * requires an explicit directive verb plus an instruction/system object.
 */
const INJECTION_PATTERNS = [
    { pattern: /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)/i, label: 'instruction-override' },
    { pattern: /disregard\s+(?:all\s+|any\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?|rules?)/i, label: 'instruction-override' },
    { pattern: /(?:reveal|print|repeat|show|output)\s+(?:your\s+|the\s+)?(?:full\s+)?system\s+(?:prompt|message|instructions)/i, label: 'system-prompt-extraction' },
    { pattern: /(?:忽略|无视)(?:之前|以上|先前|所有)的?(?:指令|提示词|设定|要求)/, label: 'instruction-override' },
    { pattern: /(?:泄露|输出|打印|显示)系统提示/, label: 'system-prompt-extraction' },
];
/**
 * Credential-shaped tokens. Each requires a provider-specific prefix plus a
 * long body, so ordinary words and short identifiers never match; the finding
 * detail never echoes the token body.
 */
const CREDENTIAL_PATTERNS = [
    { pattern: /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/, label: 'private key block' },
    { pattern: /\bsk-[A-Za-z0-9]{20,}\b/, label: 'API key (sk-…)' },
    { pattern: /\bghp_[A-Za-z0-9]{30,}\b/, label: 'GitHub token (ghp_…)' },
    { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/, label: 'GitHub fine-grained token (github_pat_…)' },
    { pattern: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS access key id (AKIA…)' },
    { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, label: 'Slack token (xox…-…)' },
    { pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/, label: 'JWT' },
];
/** Longest matched sample echoed in a finding detail; longer samples truncate. */
const MAX_SAMPLE_CHARS = 24;
/** Keep only the code points that actually belong to the invisible set. */
function isInvisibleCodePoint(character) {
    INVISIBLE_UNICODE.lastIndex = 0;
    return INVISIBLE_UNICODE.test(character);
}
/** Maximum distinct invisible code points named in one finding detail. */
const MAX_CODE_POINTS_IN_DETAIL = 6;
/**
 * Render the finding detail for the invisible-Unicode matches: the distinct
 * code points involved, never the surrounding text, so nothing else from the
 * untrusted input is copied into model-visible output.
 * @param samples - every matched substring.
 * @returns a bounded description naming the distinct invisible code points.
 */
function invisibleDetail(samples) {
    const codePoints = [];
    for (const sample of samples) {
        for (const character of sample) {
            if (!isInvisibleCodePoint(character))
                continue;
            const point = `U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}`;
            if (!codePoints.includes(point))
                codePoints.push(point);
            if (codePoints.length >= MAX_CODE_POINTS_IN_DETAIL)
                return codePoints.join(', ');
        }
    }
    return codePoints.join(', ');
}
/**
 * Render one finding detail for a pattern match: a bounded sample that keeps
 * at most the first {@link MAX_SAMPLE_CHARS} characters. Credential matches
 * are redacted to their provider prefix plus a body length instead, so the
 * secret itself never appears in any output or log.
 * @param sample - the matched substring.
 * @param label - the pattern label from the pattern table.
 * @param redact - whether the sample is a secret that must not be echoed.
 * @returns the bounded or redacted description.
 */
function patternDetail(sample, label, redact) {
    if (redact)
        return `${label} — body redacted (prefix kept, ${sample.length} chars total)`;
    const head = sample.length <= MAX_SAMPLE_CHARS ? sample : `${sample.slice(0, MAX_SAMPLE_CHARS)}…`;
    return `${label} — matched "${head}"`;
}
/** Maximum matches named inside one aggregated finding detail. */
const MATCHES_PER_FINDING = 3;
/**
 * Scan one piece of untrusted text before it is persisted into model-visible
 * context. Every reported finding is a reason to reject or redact; callers
 * own the rejection policy. The scan is advisory in the sense that it cannot
 * guarantee safety, but each finding kind is concrete enough to act on.
 * @param text - the untrusted text to scan.
 * @returns findings in kind order (invisible Unicode, injection, credential); empty for clean text.
 */
export function scanUntrustedText(text) {
    const findings = [];
    const invisibles = [...text.matchAll(INVISIBLE_UNICODE)];
    if (invisibles.length > 0) {
        findings.push({
            kind: 'invisible-unicode',
            detail: `${invisibles.length} invisible or bidirectional Unicode sequence(s): ${invisibleDetail(invisibles.map(match => match[0]))}`,
        });
    }
    for (const table of [
        { patterns: INJECTION_PATTERNS, kind: 'injection-pattern', redact: false },
        { patterns: CREDENTIAL_PATTERNS, kind: 'credential-like', redact: true },
    ]) {
        const matches = [];
        let labels;
        for (const { pattern, label } of table.patterns) {
            const match = pattern.exec(text);
            if (match === null)
                continue;
            matches.push(match[0]);
            labels = labels === undefined || labels === label ? label : `${labels}/${label}`;
            if (matches.length >= MATCHES_PER_FINDING)
                break;
        }
        if (matches.length > 0) {
            findings.push({
                kind: table.kind,
                detail: `${matches.length} match(es): ${matches.map(sample => patternDetail(sample, labels ?? table.kind, table.redact)).join('; ')}`,
            });
        }
    }
    return findings;
}
//# sourceMappingURL=index.js.map