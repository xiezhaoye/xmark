use tauri_plugin_xmark_share::{decode_base64, sanitize_filename, validate_size, Error};

fn err_is_invalid_filename(r: Result<String, Error>) -> bool {
    matches!(r, Err(Error::InvalidFilename))
}

#[test]
fn accepts_plain_and_unicode_basenames() {
    assert_eq!(sanitize_filename("notes.md").unwrap(), "notes.md");
    assert_eq!(sanitize_filename("报告.pdf").unwrap(), "报告.pdf");
    assert_eq!(sanitize_filename("a.b.c.tar.gz").unwrap(), "a.b.c.tar.gz");
    // Valid filename whitespace is preserved.
    assert_eq!(sanitize_filename("  spaced.md  ").unwrap(), "  spaced.md  ");
}

#[test]
fn rejects_path_separators_and_traversal() {
    assert!(err_is_invalid_filename(sanitize_filename("../evil.md")));
    assert!(err_is_invalid_filename(sanitize_filename("a/../b.md")));
    assert!(err_is_invalid_filename(sanitize_filename("a\\b.md")));
    assert!(err_is_invalid_filename(sanitize_filename("/etc/passwd")));
    assert!(err_is_invalid_filename(sanitize_filename("C:\\x")));
}

#[test]
fn rejects_empty_and_control_chars() {
    assert!(err_is_invalid_filename(sanitize_filename("")));
    assert!(err_is_invalid_filename(sanitize_filename("   ")));
    assert!(err_is_invalid_filename(sanitize_filename(".")));
    assert!(err_is_invalid_filename(sanitize_filename("..")));
    assert!(err_is_invalid_filename(sanitize_filename("a\nb.md")));
    assert!(err_is_invalid_filename(sanitize_filename("a\tb.md")));
    assert!(err_is_invalid_filename(sanitize_filename("a\u{7}b.md")));
}

#[test]
fn enforces_size_ceiling() {
    assert!(validate_size(0).is_ok());
    assert!(validate_size(1).is_ok());
    assert!(validate_size(30 * 1024 * 1024).is_ok());
    assert!(validate_size(30 * 1024 * 1024 + 1).is_err());
}

#[test]
fn decodes_base64_and_rejects_garbage() {
    use base64::Engine as _;
    let bytes = b"hello world";
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    assert_eq!(decode_base64(&b64).unwrap(), bytes);

    assert!(matches!(
        decode_base64("not!base64"),
        Err(Error::InvalidBase64)
    ));
    // Empty documents are valid original files.
    assert!(decode_base64("").unwrap().is_empty());
}
