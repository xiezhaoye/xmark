//! `write_share` publishes the groups the phone may browse, in the v1 shape
//! `server/mobile/src/shareFile.ts` parses, and skips a write that would
//! change nothing.

use super::{render_share, write_share, MobileShareGroup, SHARE_FILE_NAME};

fn group(id: &str, name: &str, folders: &[&str]) -> MobileShareGroup {
    MobileShareGroup {
        id: id.into(),
        name: name.into(),
        folders: folders.iter().map(|f| f.to_string()).collect(),
    }
}

#[test]
fn renders_the_v1_shape() {
    let bytes = render_share(&[group("g1", "Wiki", &["/Users/me/wiki"])]);
    let value: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
    assert_eq!(
        value,
        serde_json::json!({
            "version": 1,
            "groups": [{ "id": "g1", "name": "Wiki", "folders": ["/Users/me/wiki"] }]
        })
    );
}

#[test]
fn drops_relative_and_empty_folders_but_keeps_cjk_paths() {
    let bytes = render_share(&[group("g", "笔记", &["", "rel/x", "/Users/me/文档"])]);
    let value: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
    assert_eq!(value["groups"][0]["folders"], serde_json::json!(["/Users/me/文档"]));
    assert_eq!(value["groups"][0]["name"], "笔记");
}

#[test]
fn renders_no_groups_as_an_empty_list() {
    let value: serde_json::Value = serde_json::from_slice(&render_share(&[])).expect("json");
    assert_eq!(value, serde_json::json!({ "version": 1, "groups": [] }));
}

#[test]
fn writes_into_a_directory_it_creates() {
    let dir = tempfile::tempdir().expect("tempdir");
    let support = dir.path().join("app.xmark");
    let changed = write_share(&support, &[group("g", "G", &["/a"])]).expect("write");
    assert!(changed);
    let written = std::fs::read(support.join(SHARE_FILE_NAME)).expect("read");
    assert_eq!(written, render_share(&[group("g", "G", &["/a"])]));
}

#[test]
fn skips_an_identical_write() {
    let dir = tempfile::tempdir().expect("tempdir");
    let groups = [group("g", "G", &["/a"])];
    assert!(write_share(dir.path(), &groups).expect("first"));
    assert!(!write_share(dir.path(), &groups).expect("second"));
}

#[test]
fn replaces_changed_content() {
    let dir = tempfile::tempdir().expect("tempdir");
    write_share(dir.path(), &[group("g", "One", &[])]).expect("first");
    assert!(write_share(dir.path(), &[group("g", "Two", &[])]).expect("second"));
    let value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.path().join(SHARE_FILE_NAME)).expect("read"))
            .expect("json");
    assert_eq!(value["groups"][0]["name"], "Two");
}
