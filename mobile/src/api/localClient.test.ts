/**
 * The reader's client over a folder on this phone.
 *
 * Behaviour under test: it answers the same `Client` shapes the HTTP client
 * does — a listing becomes tree entries with the same kinds, a document keeps
 * its markdown/text distinction, bytes come back as a Blob — and it refuses
 * the two things that need a server (search, public links).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({
  listLocalFolder: vi.fn(),
  readLocalText: vi.fn(),
  readLocalBytesBase64: vi.fn(),
}));
vi.mock("../platformLocalFS", () => fs);

const { createLocalClient } = await import("./localClient");

const FOLDER = { path: "/private/var/mobile/Documents/notes", name: "notes" };
/** The library the client reads on every call. */
const library = () => [{ id: "local:default", name: "On this iPhone", folders: [FOLDER] }];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createLocalClient", () => {
  it("lists the library: one group, folders named after the folder", async () => {
    const client = createLocalClient(library);
    expect(await client.workspaces()).toEqual({
      // The group keeps its own name; the folder row keeps the FOLDER's name.
      groups: [
        {
          id: "local:default",
          name: "On this iPhone",
          folders: [{ rootId: FOLDER.path, name: "notes", available: true }],
        },
      ],
    });
  });

  it("maps entries onto the same kinds the server uses", async () => {
    fs.listLocalFolder.mockResolvedValue([
      { name: "sub", relPath: `${FOLDER.path}/sub`, isDir: true, size: 0, mtime: 1 },
      { name: "a.md", relPath: `${FOLDER.path}/a.md`, isDir: false, size: 10, mtime: 2 },
      { name: "page.html", relPath: `${FOLDER.path}/page.html`, isDir: false, size: 20, mtime: 3 },
      { name: "photo.heic", relPath: `${FOLDER.path}/photo.heic`, isDir: false, size: 30, mtime: 4 },
      { name: "paper.pdf", relPath: `${FOLDER.path}/paper.pdf`, isDir: false, size: 40, mtime: 5 },
      { name: "notes.txt", relPath: `${FOLDER.path}/notes.txt`, isDir: false, size: 50, mtime: 6 },
    ]);
    const client = createLocalClient(library);
    const { entries } = await client.tree(FOLDER.path, "");
    // The root level is the folder itself, so the request carries "".
    expect(fs.listLocalFolder).toHaveBeenCalledWith(FOLDER.path);
    expect(entries.map((e) => [e.name, e.kind])).toEqual([
      ["sub", "dir"],
      ["a.md", "markdown"],
      ["page.html", "html"],
      ["photo.heic", "image"],
      ["paper.pdf", "pdf"],
      ["notes.txt", "text"],
    ]);
  });

  it("asks the file system for a folder outside the root it was given", async () => {
    fs.listLocalFolder.mockResolvedValue([]);
    const client = createLocalClient(library);
    await client.tree(FOLDER.path, `${FOLDER.path}/sub`);
    expect(fs.listLocalFolder).toHaveBeenCalledWith(`${FOLDER.path}/sub`);
  });

  it("reads a document with its markdown/text kind", async () => {
    fs.readLocalText.mockResolvedValue("# Hello");
    const client = createLocalClient(library);
    expect(await client.file(FOLDER.path, `${FOLDER.path}/a.md`)).toMatchObject({ text: "# Hello", kind: "markdown" });
    expect(await client.file(FOLDER.path, `${FOLDER.path}/notes.txt`)).toMatchObject({ kind: "text" });
  });

  it("returns image bytes as a typed Blob", async () => {
    fs.readLocalBytesBase64.mockResolvedValue(btoa("PNG"));
    const client = createLocalClient(library);
    const blob = await client.asset(FOLDER.path, `${FOLDER.path}/photo.png`);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(3);
  });

  it("hands the share sheet the original bytes and the file's own name", async () => {
    fs.readLocalBytesBase64.mockResolvedValue(btoa("PDF"));
    const client = createLocalClient(library);
    expect(await client.download(FOLDER.path, `${FOLDER.path}/paper.pdf`)).toMatchObject({
      name: "paper.pdf",
      mimeType: "application/pdf",
    });
  });

  it("refuses the two things that need a server", async () => {
    const client = createLocalClient(library);
    expect(await client.search("anything")).toEqual({ results: [], truncated: false });
    await expect(client.createShare(FOLDER.path, `${FOLDER.path}/a.md`)).rejects.toMatchObject({ code: "unsupported" });
  });

  it("reports offline when the folder no longer opens", async () => {
    fs.listLocalFolder.mockRejectedValue(new Error("not a folder"));
    const client = createLocalClient(library);
    // The plugin's words are translated into a code the UI can explain, rather
    // than surfacing as a bare message.
    await expect(client.health()).rejects.toMatchObject({ code: "not_a_folder" });
  });
});
