// Removes sensitive data from everything sent to a remote AI provider.
// Applied to every outbound message (system, chat, tool results, script code).

const TLDS =
  "com|net|org|io|gg|pl|eu|de|uk|xyz|cc|tv|club|online|ru|fr|nl|cz|sk|br|ca|au|info|biz|dev|cloud|network";

const URL_RE = /\b(?:https?|wss?|ftp):\/\/[^\s"'<>)\]]+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const UUID_RE =
  /\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?\b/g;
const IPV6_RE = /\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/gi;
const DOMAIN_RE = new RegExp(
  `\\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS})(?::\\d{2,5})?\\b`,
  "gi",
);
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const PREFIXED_KEY_RE =
  /\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs]|AKIA|AIza|ya29|M\.R3)[-_.A-Za-z0-9]{12,}/g;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const LONG_TOKEN_RE =
  /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g;
const SECRET_KV_RE =
  /\b(pass(?:word|wd)?|pwd|token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie)(["']?\s*[:=]\s*["']?)[^\s"',;}&]+/gi;
// /login hunter2, /register hunter2 hunter2, /l pw, /changepassword old new
const AUTH_CMD_RE =
  /(^|[\s"'`])(\/(?:login|l|log|register|reg|changepassword|changepass|cp|unregister|2fa|authme)\b)(?:[ \t]+\S+){1,3}/gi;
const UNIX_PATH_RE =
  /(?:\/(?:home|Users|root|tmp|var|etc|opt|mnt|media)\/[^\s"'`<>|]*|~\/[^\s"'`<>|]+)/g;
const WIN_PATH_RE = /\b[A-Za-z]:\\[^\s"'`<>|]*/g;

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// rules: [{ value, alias }] exact strings replaced case-insensitively.
// code: script text, where key=value and command shapes are normal source.
function buildSanitizer({ rules = [], code = false } = {}) {
  const list = [];
  const seen = new Set();
  const add = (value, alias) => {
    const v = String(value || "").trim();
    if (v.length < 3 || seen.has(v.toLowerCase())) return;
    seen.add(v.toLowerCase());
    list.push({ re: new RegExp(escapeRe(v), "gi"), alias });
  };
  [...rules]
    .filter((r) => r && r.value)
    .sort((a, b) => String(b.value).length - String(a.value).length)
    .forEach((r) => add(r.value, r.alias || "[redacted]"));

  return function sanitize(input) {
    let s = String(input ?? "");
    if (!s) return s;
    // Specific, user-configured values first so aliases survive later rules.
    for (const { re, alias } of list) s = s.replace(re, alias);
    if (!code) s = s.replace(AUTH_CMD_RE, "$1$2 [redacted]");
    s = s
      .replace(JWT_RE, "[token]")
      .replace(PREFIXED_KEY_RE, "[token]")
      .replace(BEARER_RE, "$1 [token]");
    if (!code) s = s.replace(SECRET_KV_RE, "$1$2[redacted]");
    s = s
      .replace(URL_RE, "[url]")
      .replace(EMAIL_RE, "[email]")
      .replace(UUID_RE, "[uuid]")
      .replace(IPV4_RE, "[ip]")
      .replace(IPV6_RE, "[ip]")
      .replace(WIN_PATH_RE, "[path]")
      .replace(UNIX_PATH_RE, "[path]")
      .replace(DOMAIN_RE, "[server]");
    if (!code) s = s.replace(LONG_TOKEN_RE, "[token]");
    return s;
  };
}

// Sanitizes strings inside OpenAI-style messages without touching structure.
function sanitizeMessages(messages, sanitize) {
  return messages.map((m) => {
    const out = { ...m };
    if (typeof out.content === "string") out.content = sanitize(out.content);
    if (Array.isArray(out.tool_calls)) {
      out.tool_calls = out.tool_calls.map((c) => ({
        ...c,
        function: {
          ...c.function,
          arguments:
            typeof c.function?.arguments === "string"
              ? sanitize(c.function.arguments)
              : c.function?.arguments,
        },
      }));
    }
    return out;
  });
}

module.exports = { buildSanitizer, sanitizeMessages };
