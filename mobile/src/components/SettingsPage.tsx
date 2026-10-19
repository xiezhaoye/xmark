/**
 * Settings: the Macs paired with this phone, and the form that pairs another
 * one. Scan the QR from `xmark-mobile-server pair`, paste its link, or type
 * host, port and token, then test and save. A Mac already in the list at the
 * same host and port is updated instead of listed twice; a pairing link's
 * `name` fills the name field.
 *
 * @module components/SettingsPage
 */
import { useState } from "react";
import { ApiError } from "../api/client";
import { sameServer, type Connection, type ServerProfile } from "../api/types";
import { parsePairLink, type PairLink } from "../pairing/parsePairUrl";
import { readClipboardText, scanQrCode } from "../platform";
import { SERVER_NAME_MAX, serverName, useReaderStore } from "../state/readerStore";
import { errorText, t } from "../i18n";
import { Icon } from "./Icon";

function validate(host: string, port: string, token: string): Connection | null {
  const p = Number(port);
  if (!/^[A-Za-z0-9.-]+$/.test(host.trim()) || !Number.isInteger(p) || p < 1 || p > 65535) return null;
  if (!/^[0-9a-f]{64}$/.test(token.trim())) return null;
  return { host: host.trim(), port: p, token: token.trim() };
}

/** What the form is editing: a new Mac, or one already listed. */
type Draft = {
  id: string | null;
  name: string;
  host: string;
  port: string;
  token: string;
  /** The name came from a pairing link, so a link without one clears it. */
  fromLink: boolean;
};

const blankDraft = (): Draft => ({ id: null, name: "", host: "", port: "8740", token: "", fromLink: false });

const draftOf = (p: ServerProfile): Draft => ({ id: p.id, name: p.name, host: p.host, port: String(p.port), token: p.token, fromLink: false });

export function SettingsPage() {
  const servers = useReaderStore((s) => s.servers);
  const activeId = useReaderStore((s) => s.activeServerId);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const editing = draft.id !== null || draft.host !== "" || draft.token !== "" || draft.name !== "";

  const apply = (link: PairLink) => {
    const c = link.connection;
    setDraft((d) => ({
      ...d,
      // A name in the link wins; a link without one only clears a name this
      // form filled from an earlier link, and a name too long to have
      // travelled whole keeps the current one.
      name: link.name || (link.nameTooLong ? d.name : d.fromLink ? "" : d.name),
      fromLink: !!link.name || link.nameTooLong,
      host: c.host,
      port: String(c.port),
      token: c.token,
    }));
  };

  const scan = async () => {
    try {
      const raw = await scanQrCode();
      if (raw === null) return;
      const link = parsePairLink(raw);
      if (!link) setMessage({ tone: "error", text: t("settings.badQr") });
      else {
        apply(link);
        await test(link.connection);
      }
    } catch (err) {
      setMessage({ tone: "error", text: String(err) });
    }
  };

  /** A full pairing link typed or pasted into any field fills the rest. */
  const onField = (value: string, field: keyof Omit<Draft, "id">) => {
    const link = parsePairLink(value);
    if (link) {
      apply(link);
      void test(link.connection);
    } else setDraft((d) => ({ ...d, [field]: value }));
  };

  const paste = async () => {
    const link = parsePairLink(await readClipboardText());
    if (!link) {
      setMessage({ tone: "error", text: t("settings.badQr") });
      return;
    }
    apply(link);
    await test(link.connection);
  };

  const test = async (c = validate(draft.host, draft.port, draft.token)): Promise<boolean> => {
    if (!c) {
      setMessage({ tone: "error", text: t("settings.invalid") });
      return false;
    }
    try {
      const { version } = await useReaderStore.getState().makeClient(c).health();
      setMessage({ tone: "ok", text: t("settings.ok", { version }) });
      return true;
    } catch (err) {
      setMessage({ tone: "error", text: errorText(err instanceof ApiError ? err.code : "network") });
      return false;
    }
  };

  const save = async () => {
    const c = validate(draft.host, draft.port, draft.token);
    if (!c || !(await test(c))) return;
    const store = useReaderStore.getState();
    const name = serverName(draft.name, c);
    const twin = store.servers.find((p) => p.id !== draft.id && sameServer(p, c));
    if (draft.id && !twin) await store.updateServer(draft.id, { name, ...c });
    else if (twin) {
      // Same host and port: this is the same Mac, with a fresh name or token.
      await store.updateServer(twin.id, { name, token: c.token });
    } else await store.addServer({ name, connection: c });
    setDraft(blankDraft());
    setMessage(null);
  };

  const startEdit = (p: ServerProfile) => {
    setDraft(draftOf(p));
    setConfirmRemove(null);
    setMessage(null);
  };

  return (
    <div className="page">
      <header className="topbar">
        {servers.length > 0 ? (
          <button type="button" className="icon-button" aria-label={t("settings.back")} onClick={() => useReaderStore.getState().setView("reader")}>
            <Icon name="back" />
          </button>
        ) : (
          <span className="icon-button" />
        )}
        <h1 className="topbar-title">{t("settings.title")}</h1>
        <span className="icon-button" />
      </header>
      <div className="scroll settings">
        <h2 className="section-title">{t("settings.servers")}</h2>
        {servers.length ? (
          <ul className="servers" aria-label={t("settings.servers")}>
            {servers.map((p) => (
              <li key={p.id} className={`server ${p.id === activeId ? "current" : ""}`}>
                <div className="server-main">
                  <span className="server-name">{p.name}</span>
                  <span className="server-address">
                    {p.host}:{p.port}
                  </span>
                </div>
                <div className="server-actions">
                  {p.id === activeId ? (
                    <span className="server-badge">{t("settings.current")}</span>
                  ) : (
                    <button type="button" className="button small" onClick={() => void useReaderStore.getState().switchServer(p.id)}>
                      {t("settings.use")}
                    </button>
                  )}
                  <button type="button" className="button small" onClick={() => startEdit(p)}>
                    {t("settings.edit")}
                  </button>
                  <button type="button" className="button small danger" onClick={() => setConfirmRemove(p.id)}>
                    {t("settings.remove")}
                  </button>
                </div>
                {confirmRemove === p.id && (
                  <div className="server-confirm" role="group" aria-label={t("settings.removeConfirm", { name: p.name })}>
                    <p>{t("settings.removeConfirm", { name: p.name })}</p>
                    <div className="row">
                      <button type="button" className="button small" onClick={() => setConfirmRemove(null)}>
                        {t("settings.cancel")}
                      </button>
                      <button
                        type="button"
                        className="button small danger"
                        onClick={() => {
                          useReaderStore.getState().removeServer(p.id);
                          setConfirmRemove(null);
                          setDraft(blankDraft());
                        }}
                      >
                        {t("settings.removeYes")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("settings.noServers")}</p>
        )}

        <h2 className="section-title">{draft.id ? t("settings.editTitle") : t("settings.newTitle")}</h2>
        <p className="muted">{t("settings.intro")}</p>
        <button type="button" className="button primary wide" onClick={() => void scan()}>
          <Icon name="scan" size={18} /> {t("settings.scan")}
        </button>
        <button type="button" className="button wide" onClick={() => void paste()}>
          {t("settings.paste")}
        </button>
        <label>
          {t("settings.name")}
          <input value={draft.name} maxLength={SERVER_NAME_MAX} onChange={(e) => onField(e.target.value, "name")} placeholder={t("settings.namePlaceholder")} />
        </label>
        <label>
          {t("settings.host")}
          <input value={draft.host} onChange={(e) => onField(e.target.value, "host")} autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="m4.tailnet.ts.net" />
        </label>
        <label>
          {t("settings.port")}
          <input value={draft.port} onChange={(e) => onField(e.target.value, "port")} inputMode="numeric" />
        </label>
        <label>
          {t("settings.token")}
          <input value={draft.token} onChange={(e) => onField(e.target.value, "token")} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>
        {message && (
          <p className={message.tone === "ok" ? "ok" : "error"} role="status">
            {message.text}
          </p>
        )}
        <div className="row">
          <button type="button" className="button" onClick={() => void test()}>
            {t("settings.test")}
          </button>
          <button type="button" className="button primary" onClick={() => void save()}>
            {t("settings.save")}
          </button>
        </div>
        {editing && (
          <button
            type="button"
            className="button wide"
            onClick={() => {
              setDraft(blankDraft());
              setMessage(null);
            }}
          >
            {t("settings.cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
