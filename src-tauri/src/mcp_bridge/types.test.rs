use super::McpRequestEvent;
use serde_json::json;

#[test]
fn routed_request_serializes_server_authenticated_client_id() {
    let event = McpRequestEvent {
        id: "bridge-1".to_string(),
        request_type: "vmark.workspace.open_workspace".to_string(),
        client_id: "17".to_string(),
        args_json: r#"{"folderPath":"/workspace"}"#.to_string(),
    };

    let value = serde_json::to_value(event).expect("serialize request event");
    assert_eq!(value["client_id"], json!("17"));
    assert!(value.get("clientId").is_none());
    assert_eq!(value["args_json"], json!(r#"{"folderPath":"/workspace"}"#));
}
