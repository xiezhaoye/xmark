/**
 * RemoteViewer — which surface each server-served kind lands on.
 *
 * Behaviour under test: the viewer mirrors `server/mobile/src/fileKinds.ts`.
 * The server serves markdown/html/text through `/api/file` and every image
 * type through `/api/asset`; it has NO route for anything else, so a kind it
 * cannot serve must not spend a request — it shows the "cannot preview" card
 * instead of a 415 error, and an image the server DOES serve (heic, tiff) must
 * be read as a picture rather than as text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useRemoteBrowserStore } from "@/stores/remoteBrowserStore";

const browse = vi.hoisted(() => ({
  loadDocument: vi.fn(),
  loadImage: vi.fn(),
  failureText: vi.fn(() => "failed"),
}));
vi.mock("@/services/remoteServers/browse", () => browse);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/RemoteBrowser/RemoteMarkdown", () => ({
  RemoteMarkdown: ({ text }: { text: string }) => <div data-testid="markdown">{text}</div>,
}));

const { RemoteViewer } = await import("../RemoteViewer");

const CONNECTION = { host: "m1.tailc8e51.ts.net", port: 8740, token: "a".repeat(64) };

function openServer() {
  useRemoteBrowserStore.setState({
    serverId: "s1",
    connection: CONNECTION,
    doc: { rootId: "r1", relPath: "file", kind: "text" },
    groupsStatus: "ready",
    groups: [],
    levels: {},
    expanded: {},
  });
}

describe("RemoteViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openServer();
    browse.loadDocument.mockResolvedValue({ kind: "text", text: "hello", size: 5, mtime: 0 });
    browse.loadImage.mockResolvedValue({
      contentType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
  });

  it("frames an HTML file in a sandboxed iframe", async () => {
    render(<RemoteViewer rootId="r1" relPath="page.html" />);
    const frame = await screen.findByTitle("HTML preview");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(browse.loadDocument).toHaveBeenCalledWith("r1", "page.html");
  });

  it("reads an image the server already classifies as image (heic)", async () => {
    render(<RemoteViewer rootId="r1" relPath="photo.heic" />);
    await waitFor(() => expect(browse.loadImage).toHaveBeenCalledWith("r1", "photo.heic"));
    expect(browse.loadDocument).not.toHaveBeenCalled();
  });

  it("does not request a kind the server has no route for (pdf)", async () => {
    render(<RemoteViewer rootId="r1" relPath="paper.pdf" />);
    expect(screen.getByText(/remote\.unknownKind/)).toBeInTheDocument();
    expect(browse.loadDocument).not.toHaveBeenCalled();
    expect(browse.loadImage).not.toHaveBeenCalled();
  });

  it("renders plain text through the source view", async () => {
    render(<RemoteViewer rootId="r1" relPath="notes.txt" />);
    expect(await screen.findByText("hello")).toBeInTheDocument();
  });
});
