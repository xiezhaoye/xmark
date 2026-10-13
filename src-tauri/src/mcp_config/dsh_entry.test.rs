//! Tests for `dsh_entry.rs` — XMark's marked block in DeepSeek Harness's
//! home-level patch file. Everything outside the block is the user's and must
//! survive byte for byte.

use super::*;

const BIN: &str = "/Applications/XMark.app/Contents/MacOS/vmark-mcp-server";
const TOK: &str = "tok-fixture";

const USER_LIST: &str = "# my machine-local dsh overrides\n\
- id: agent-default-model\n  name: \"@deepseek-ai/dsh-agent-default-model\"\n  config:\n    model: x # keep me\n";

fn written(existing: Option<&str>) -> String {
    let doc = match existing {
        Some(c) => parse(c).expect("parses"),
        None => DshDoc::empty(),
    };
    doc.with_entry(BIN, TOK)
}

// -- reading -----------------------------------------------------------------

#[test]
fn a_file_without_the_block_has_no_entry() {
    let doc = parse(USER_LIST).unwrap();
    assert!(doc.block().is_none());
}

#[test]
fn reads_command_and_token_back_from_a_written_block() {
    let doc = parse(&written(None)).unwrap();
    let block = doc.block().expect("block present");
    assert_eq!(block.command(), Some(BIN));
    assert_eq!(block.token(), Some(TOK));
}

#[test]
fn reads_double_quoted_and_plain_scalars_a_user_may_have_typed() {
    let text = format!(
        "{BEGIN_MARKER}\n- insert:\n    - id: mcp-xmark\n      config:\n        command: \"{BIN}\"\n        env:\n          VMARK_MCP_TOKEN: plain-token\n{END_MARKER}\n"
    );
    let doc = parse(&text).unwrap();
    let block = doc.block().unwrap();
    assert_eq!(block.command(), Some(BIN));
    assert_eq!(block.token(), Some("plain-token"));
}

// -- writing -----------------------------------------------------------------

#[test]
fn a_fresh_file_holds_only_the_block_as_a_patch_list() {
    let out = written(None);
    assert!(out.starts_with(BEGIN_MARKER), "{out}");
    assert!(out.trim_end().ends_with(END_MARKER), "{out}");
    for line in [
        "- insert:",
        "    - id: mcp-xmark",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "        serverName: xmark",
        "        transport: stdio",
        &format!("        command: '{BIN}'"),
        &format!("          VMARK_MCP_TOKEN: '{TOK}'"),
    ] {
        assert!(out.contains(line), "missing {line:?} in:\n{out}");
    }
}

#[test]
fn appends_to_a_user_list_and_keeps_every_user_byte() {
    let out = written(Some(USER_LIST));
    assert!(out.starts_with(USER_LIST), "user content is untouched:\n{out}");
    assert!(out.contains(BEGIN_MARKER));
}

#[test]
fn appends_after_a_list_that_lacks_a_trailing_newline() {
    let user = USER_LIST.trim_end();
    let out = written(Some(user));
    assert!(out.starts_with(user));
    let rest = &out[user.len()..];
    assert!(rest.starts_with('\n'), "block starts on its own line:\n{out}");
}

#[test]
fn replaces_an_empty_flow_list() {
    let out = written(Some("# root\n[]\n"));
    assert!(out.starts_with("# root\n"), "{out}");
    assert!(!out.contains("[]"), "the empty list is replaced, not kept:\n{out}");
    assert!(out.contains(BEGIN_MARKER));
}

#[test]
fn comment_only_file_keeps_its_comments() {
    let out = written(Some("# nothing here yet\n"));
    assert!(out.starts_with("# nothing here yet\n"), "{out}");
    assert!(out.contains(BEGIN_MARKER));
}

#[test]
fn rewriting_replaces_the_block_in_place_and_is_idempotent() {
    let once = written(Some(USER_LIST));
    let twice = parse(&once).unwrap().with_entry(BIN, TOK);
    assert_eq!(once, twice);

    let moved = parse(&once).unwrap().with_entry("/new/path", "tok-2");
    assert!(moved.starts_with(USER_LIST));
    assert_eq!(moved.matches(BEGIN_MARKER).count(), 1);
    let block_doc = parse(&moved).unwrap();
    assert_eq!(block_doc.block().unwrap().command(), Some("/new/path"));
}

#[test]
fn quotes_a_path_containing_a_single_quote() {
    let out = DshDoc::empty().with_entry("/Users/o'neil/XMark", TOK);
    assert!(out.contains("command: '/Users/o''neil/XMark'"), "{out}");
    let doc = parse(&out).unwrap();
    assert_eq!(doc.block().unwrap().command(), Some("/Users/o'neil/XMark"));
}

// -- removing ----------------------------------------------------------------

#[test]
fn removing_restores_the_user_file_exactly() {
    let with = written(Some(USER_LIST));
    let without = parse(&with).unwrap().without_entry().expect("block removed");
    assert_eq!(without, USER_LIST);
}

#[test]
fn removing_from_a_file_without_the_block_changes_nothing() {
    assert!(parse(USER_LIST).unwrap().without_entry().is_none());
}

#[test]
fn removing_the_only_content_leaves_an_empty_patch_list() {
    let with = written(None);
    let without = parse(&with).unwrap().without_entry().unwrap();
    assert_eq!(without.trim(), "[]");
}

#[test]
fn removing_from_a_comment_only_file_keeps_comments_and_a_valid_list() {
    let with = written(Some("# keep me\n"));
    let without = parse(&with).unwrap().without_entry().unwrap();
    assert!(without.starts_with("# keep me\n"), "{without}");
    assert!(without.trim_end().ends_with("[]"), "{without}");
}

// -- refusing what XMark cannot extend safely --------------------------------

#[test]
fn refuses_a_top_level_mapping() {
    parse("agent-default-model:\n  model: x\n").expect_err("not a patch list");
}

#[test]
fn refuses_a_non_empty_flow_list() {
    parse("[ { id: a } ]\n").expect_err("XMark only extends block lists");
}

#[test]
fn refuses_a_begin_marker_without_an_end() {
    parse(&format!("{BEGIN_MARKER}\n- insert: []\n")).expect_err("broken block");
}

#[test]
fn refuses_two_blocks() {
    let one = written(None);
    parse(&format!("{one}{one}")).expect_err("duplicated block");
}

#[test]
fn an_empty_document_is_a_valid_empty_file() {
    let doc = parse("").unwrap();
    assert!(doc.block().is_none());
}
