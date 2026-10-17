/**
 * Wire types of the mobile server API (`server/mobile`).
 *
 * @module api/types
 */

export interface Connection {
  host: string;
  port: number;
  token: string;
}

interface WorkspaceFolder {
  rootId: string;
  name: string;
  available: boolean;
}

export interface WorkspaceGroup {
  id: string;
  name: string;
  folders: WorkspaceFolder[];
}

type EntryKind = "dir" | "markdown" | "text" | "image";

export interface TreeEntry {
  name: string;
  kind: EntryKind;
  relPath: string;
  size?: number;
  mtime?: number;
}

export interface FileContent {
  text: string;
  kind: "markdown" | "text";
  size: number;
  mtime: number;
}

export interface SearchResult {
  rootId: string;
  relPath: string;
  matches: { lineNumber: number; lineContent: string }[];
}
