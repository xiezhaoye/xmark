//! The `xmark` server entry in DeepSeek Harness's home-level patch file,
//! `~/.dsh/cordis.patch.yml`.
//!
//! dsh composes every profile from YAML patch layers. The home-level layer
//! applies to EVERY profile, so XMark installs there instead of picking one of
//! the user's profiles. The file is a top-level YAML list of patch entries; an
//! MCP server is a `@deepseek-ai/dsh-mcp-client` plugin added through an
//! `insert` entry.
//!
//! Key decisions:
//!   - **A marked block, not a YAML round trip.** The file is hand-edited and
//!     commented, and dsh accepts custom `!!js` tags that a generic YAML
//!     parser rejects or drops. Parsing and re-serializing would lose comments
//!     and could choke on the tags. So XMark owns the lines between
//!     `BEGIN_MARKER` and `END_MARKER` and never touches a byte outside them.
//!     Edits made inside the block are overwritten on the next install.
//!   - **Only a list is extended.** Absent, blank or comment-only files and an
//!     empty `[]` become a list holding the block; a block list gets the block
//!     appended. Anything else (a mapping, a non-empty flow list) is refused,
//!     never rewritten — the same rule as an unparseable JSON or TOML config.
//!   - Scalars are written single-quoted (the YAML form with one escape,
//!     `''`), so any path or token is written exactly.

use super::client_token_field::TOKEN_ENV_KEY;

pub(crate) const BEGIN_MARKER: &str =
    "# >>> xmark mcp server - managed by XMark (Settings > Integrations); edits inside this block are overwritten >>>";
pub(crate) const END_MARKER: &str = "# <<< xmark mcp server <<<";

/// The patch file's text, plus where XMark's block sits in it.
#[derive(Debug)]
pub(crate) struct DshDoc {
    text: String,
    block: Option<DshBlock>,
}

/// XMark's block: its byte range (through the end marker's newline) and the
/// values read from it.
#[derive(Debug)]
pub(crate) struct DshBlock {
    start: usize,
    end: usize,
    command: Option<String>,
    token: Option<String>,
}

impl DshBlock {
    pub(crate) fn command(&self) -> Option<&str> {
        self.command.as_deref()
    }

    pub(crate) fn token(&self) -> Option<&str> {
        self.token.as_deref()
    }
}

/// Byte offset of each line start, paired with the line (without `\n`).
fn lines_with_offsets(text: &str) -> impl Iterator<Item = (usize, &str)> + '_ {
    let mut offset = 0;
    text.split_inclusive('\n').map(move |raw| {
        let start = offset;
        offset += raw.len();
        (start, raw.trim_end_matches(['\n', '\r']))
    })
}

fn is_significant(line: &str) -> bool {
    let t = line.trim();
    !t.is_empty() && !t.starts_with('#')
}

/// `[]`, optionally followed by a comment.
fn is_empty_flow_list(line: &str) -> bool {
    let t = line.trim();
    t == "[]" || t.strip_prefix("[]").is_some_and(|rest| rest.trim_start().starts_with('#'))
}

/// Parse a YAML scalar as XMark writes it (single-quoted) or as a user may
/// have typed it (double-quoted, plain). A trailing comment on a plain scalar
/// is dropped.
fn parse_scalar(raw: &str) -> String {
    let v = raw.trim();
    if let Some(inner) = v.strip_prefix('\'').and_then(|r| r.rfind('\'').map(|i| &r[..i])) {
        return inner.replace("''", "'");
    }
    if let Some(inner) = v.strip_prefix('"').and_then(|r| r.rfind('"').map(|i| &r[..i])) {
        return inner.replace("\\\"", "\"").replace("\\\\", "\\");
    }
    match v.find(" #") {
        Some(i) => v[..i].trim_end().to_string(),
        None => v.to_string(),
    }
}

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// The value of the first `key:` line in `lines`.
fn value_of<'a>(lines: impl Iterator<Item = &'a str>, key: &str) -> Option<String> {
    lines
        .filter_map(|l| l.trim_start().strip_prefix(key)?.strip_prefix(':').map(parse_scalar))
        .find(|v| !v.is_empty())
}

fn broken(detail: &str) -> String {
    rust_i18n::t!("errors.mcp.dshBlockBroken", detail = detail).to_string()
}

/// Read the patch file, locating XMark's block. Refuses a file XMark could not
/// extend without rewriting the user's content.
pub(crate) fn parse(text: &str) -> Result<DshDoc, String> {
    let mut begin: Option<usize> = None;
    let mut block: Option<DshBlock> = None;
    let mut first_outside: Option<&str> = None;

    for (start, line) in lines_with_offsets(text) {
        let trimmed = line.trim();
        if trimmed == BEGIN_MARKER {
            if begin.is_some() || block.is_some() {
                return Err(broken("a second begin marker"));
            }
            begin = Some(start);
        } else if trimmed == END_MARKER {
            let Some(b) = begin.take() else {
                return Err(broken("an end marker without a begin marker"));
            };
            let end = start + line.len() + usize::from(text[start + line.len()..].starts_with('\n'));
            let inner = &text[b..start];
            block = Some(DshBlock {
                start: b,
                end,
                command: value_of(inner.lines(), "command"),
                token: value_of(inner.lines(), TOKEN_ENV_KEY),
            });
        } else if begin.is_none() && first_outside.is_none() && is_significant(line) {
            first_outside = Some(line);
        }
    }
    if begin.is_some() {
        return Err(broken("a begin marker without an end marker"));
    }

    if let Some(line) = first_outside {
        let t = line.trim_start();
        let is_block_list = t == "-" || t.starts_with("- ");
        if !is_block_list && !is_empty_flow_list(line) {
            return Err(rust_i18n::t!("errors.mcp.dshNotList").to_string());
        }
    }

    Ok(DshDoc {
        text: text.to_string(),
        block,
    })
}

impl DshDoc {
    /// A file that does not exist yet.
    pub(crate) fn empty() -> Self {
        DshDoc {
            text: String::new(),
            block: None,
        }
    }

    pub(crate) fn block(&self) -> Option<&DshBlock> {
        self.block.as_ref()
    }

    pub(crate) fn text(&self) -> &str {
        &self.text
    }

    /// The file with XMark's block written in (replaced in place when present).
    pub(crate) fn with_entry(&self, binary_path: &str, client_token: &str) -> String {
        let block = render_block(binary_path, client_token);
        if let Some(b) = &self.block {
            return format!("{}{}{}", &self.text[..b.start], block, &self.text[b.end..]);
        }
        // An empty `[]` becomes the list holding the block.
        if let Some((start, line)) =
            lines_with_offsets(&self.text).find(|(_, l)| is_significant(l))
        {
            if is_empty_flow_list(line) {
                let after = start + line.len();
                let rest = self.text[after..].strip_prefix('\n').unwrap_or(&self.text[after..]);
                return format!("{}{}{}", &self.text[..start], block, rest);
            }
        }
        let mut out = self.text.clone();
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&block);
        out
    }

    /// The file without XMark's block, or `None` when it has none. A file
    /// left with no list entries becomes `[]`, still a valid patch list.
    pub(crate) fn without_entry(&self) -> Option<String> {
        let b = self.block.as_ref()?;
        let rest = format!("{}{}", &self.text[..b.start], &self.text[b.end..]);
        if rest.lines().any(is_significant) {
            return Some(rest);
        }
        let comments = rest.trim_end();
        Some(if comments.is_empty() {
            "[]\n".to_string()
        } else {
            format!("{comments}\n[]\n")
        })
    }
}

fn render_block(binary_path: &str, client_token: &str) -> String {
    format!(
        "{BEGIN_MARKER}\n\
         - insert:\n    \
             - id: mcp-{name}\n      \
               name: '@deepseek-ai/dsh-mcp-client'\n      \
               config:\n        \
                 serverName: {name}\n        \
                 transport: stdio\n        \
                 command: {command}\n        \
                 env:\n          \
                   {TOKEN_ENV_KEY}: {token}\n\
         {END_MARKER}\n",
        name = super::MCP_ENTRY_NAME,
        command = quote(binary_path),
        token = quote(client_token),
    )
}

#[cfg(test)]
#[path = "dsh_entry.test.rs"]
mod tests;
