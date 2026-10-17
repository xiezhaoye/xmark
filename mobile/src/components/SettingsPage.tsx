/**
 * Pairing with the Mac: scan the QR from `xmark-mobile-server pair`, or type
 * host, port and token; test, then save.
 *
 * @module components/SettingsPage
 */
import { useState } from "react";
import { ApiError } from "../api/client";
import type { Connection } from "../api/types";
import { parsePairUrl } from "../pairing/parsePairUrl";
import { readClipboardText, scanQrCode } from "../platform";
import { useReaderStore } from "../state/readerStore";
import { errorText, t } from "../i18n";
import { Icon } from "./Icon";

function validate(host: string, port: string, token: string): Connection | null {
  const p = Number(port);
  if (!/^[A-Za-z0-9.-]+$/.test(host.trim()) || !Number.isInteger(p) || p < 1 || p > 65535) return null;
  if (!/^[0-9a-f]{64}$/.test(token.trim())) return null;
  return { host: host.trim(), port: p, token: token.trim() };
}

export function SettingsPage() {
  const existing = useReaderStore((s) => s.connection);
  const [host, setHost] = useState(existing?.host ?? "");
  const [port, setPort] = useState(String(existing?.port ?? 8740));
  const [token, setToken] = useState(existing?.token ?? "");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const apply = (c: Connection) => {
    setHost(c.host);
    setPort(String(c.port));
    setToken(c.token);
  };

  const scan = async () => {
    try {
      const raw = await scanQrCode();
      if (raw === null) return;
      const c = parsePairUrl(raw);
      if (!c) setMessage({ tone: "error", text: t("settings.badQr") });
      else {
        apply(c);
        await test(c);
      }
    } catch (err) {
      setMessage({ tone: "error", text: String(err) });
    }
  };

  /** A full pairing link typed or pasted into any field fills all three. */
  const onField = (value: string, set: (v: string) => void) => {
    const c = parsePairUrl(value);
    if (c) {
      apply(c);
      void test(c);
    } else set(value);
  };

  const paste = async () => {
    const c = parsePairUrl(await readClipboardText());
    if (!c) {
      setMessage({ tone: "error", text: t("settings.badQr") });
      return;
    }
    apply(c);
    await test(c);
  };

  const test = async (c = validate(host, port, token)): Promise<boolean> => {
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
    const c = validate(host, port, token);
    if (c && (await test(c))) await useReaderStore.getState().connect(c);
  };

  return (
    <div className="page">
      <header className="topbar">
        {existing ? (
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
        <p className="muted">{t("settings.intro")}</p>
        <button type="button" className="button primary wide" onClick={() => void scan()}>
          <Icon name="scan" size={18} /> {t("settings.scan")}
        </button>
        <button type="button" className="button wide" onClick={() => void paste()}>
          {t("settings.paste")}
        </button>
        <label>
          {t("settings.host")}
          <input value={host} onChange={(e) => onField(e.target.value, setHost)} autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="m4.tailnet.ts.net" />
        </label>
        <label>
          {t("settings.port")}
          <input value={port} onChange={(e) => onField(e.target.value, setPort)} inputMode="numeric" />
        </label>
        <label>
          {t("settings.token")}
          <input value={token} onChange={(e) => onField(e.target.value, setToken)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
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
      </div>
    </div>
  );
}
