import { useState, useRef, useEffect, useCallback } from "react";
import {
  Menu,
  X,
  Settings,
  Search,
  Send,
  Image as ImageIcon,
  FileText,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  Activity,
  Plus,
} from "lucide-react";

type Role = "user" | "assistant";

interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  streaming?: boolean;
  image?: string;
  thinking?: string;
  thinkingExpanded?: boolean;
}

/* ================================================================= */
/*  HERMES GATEWAY CLIENT                                              */
/* ================================================================= */
type ConnState = "idle" | "connecting" | "open" | "closed" | "error";

interface GWEvent {
  type: string;
  session_id?: string;
  payload?: Record<string, unknown>;
}

class HermesGateway {
  private ws: WebSocket | null = null;
  private reqId = 0;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private listeners = new Map<string, Set<(ev: GWEvent) => void>>();
  private _state: ConnState = "idle";

  get state() { return this._state; }

  on(type: string, cb: (ev: GWEvent) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) { set = new Set(); this.listeners.set(type, set); }
    set.add(cb);
    return () => set!.delete(cb);
  }

  async connect(): Promise<void> {
    if (this._state === "open" || this._state === "connecting") return;
    this._state = "connecting";

    // Auth: dashboard injects __HERMES_SESSION_TOKEN__ into HTML
    const token = (window as any).__HERMES_SESSION_TOKEN__ ?? "";
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${scheme}//${location.host}/api/ws?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener("message", (ev) => {
      try { this.dispatch(JSON.parse(ev.data)); } catch { /* ignore malformed */ }
    });
    ws.addEventListener("close", () => {
      this._state = "closed";
      this.rejectAll(new Error("WebSocket closed"));
    });

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => { ws.removeEventListener("error", onError); this._state = "open"; resolve(); };
      const onError = () => { ws.removeEventListener("open", onOpen); this._state = "error"; reject(new Error("WS failed")); };
      ws.addEventListener("open", onOpen, { once: true });
      ws.addEventListener("error", onError, { once: true });
    });
  }

  close() { this.ws?.close(); this.ws = null; }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<T> {
    if (!this.ws || this._state !== "open") return Promise.reject(new Error("Not connected"));
    const id = `m${++this.reqId}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error("Timeout")); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      try { this.ws!.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e instanceof Error ? e : new Error(String(e))); }
    });
  }

  private dispatch(msg: Record<string, unknown>) {
    const id = msg.id as string | undefined;
    if (id !== undefined && this.pending.has(id)) {
      const p = this.pending.get(id)!; this.pending.delete(id); clearTimeout(p.timer);
      const err = msg.error as { message?: string } | undefined;
      if (err) p.reject(new Error(err.message ?? "request failed"));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method !== "event") return;
    const params = (msg.params ?? {}) as GWEvent;
    if (typeof params.type !== "string") return;
    for (const cb of this.listeners.get(params.type) ?? []) cb(params);
    for (const cb of this.listeners.get("*") ?? []) cb(params);
  }

  private rejectAll(err: Error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }
}

/* ================================================================= */
/*  LOCAL STORAGE helpers                                            */
/* ================================================================= */
const MSG_KEY = "sanctuary.messages.v1";
const SESS_KEY = "sanctuary.session.v1";

function loadMessages(): Message[] {
  try { const raw = localStorage.getItem(MSG_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function saveMessages(msgs: Message[]) { try { localStorage.setItem(MSG_KEY, JSON.stringify(msgs)); } catch {} }
function loadSession(): string | null { try { return localStorage.getItem(SESS_KEY); } catch { return null; } }
function saveSession(id: string) { try { localStorage.setItem(SESS_KEY, id); } catch {} }

function uid() { return Math.random().toString(36).slice(2, 11); }

/* ================================================================= */
/*  DRAWER                                                           */
/* ================================================================= */
function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sessions = [
    { id: "1", title: "Sanctuary Welcome", date: "Today" },
    { id: "2", title: "Hermes Setup", date: "Today" },
    { id: "3", title: "Atlas Island Plans", date: "Yesterday" },
  ];
  return (
    <>
      {open && <div className="drawer-overlay" onClick={onClose} aria-hidden="true" />}
      <aside className={`drawer-panel ${open ? "open" : ""}`}>
        <div className="drawer-header">
          <span className="drawer-title">Menu</span>
          <button className="drawer-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <nav className="drawer-nav">
          <a href="#chat" className="drawer-link active" onClick={onClose}><MessageCircle size={18} /><span>Chat</span></a>
          <a href="#search" className="drawer-link" onClick={onClose}><Search size={18} /><span>Search Sessions</span></a>
          <a href="#settings" className="drawer-link" onClick={onClose}><Settings size={18} /><span>Settings</span></a>
        </nav>
        <div className="drawer-divider" />
        <div className="drawer-section-title">Sessions</div>
        <ul className="drawer-sessions">
          {sessions.map((s) => (
            <li key={s.id} className="drawer-session">
              <div className="session-title">{s.title}</div>
              <div className="session-date">{s.date}</div>
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}

/* ================================================================= */
/*  UI COMPONENTS                                                      */
/* ================================================================= */
function ChatHeader({
  onMenu,
  status,
  onNewChat,
}: {
  onMenu: () => void;
  status: string;
  onNewChat: () => void;
}) {
  return (
    <header className="chat-header">
      <button className="menu-btn" onClick={onMenu} aria-label="Menu"><Menu size={20} /></button>
      <span className="header-title">SAI Hermes ☤</span>
      <button className="new-chat-btn" onClick={onNewChat} aria-label="New chat"><Plus size={18} /></button>
      <div className="header-status" data-status={status}>{status}</div>
      <img src="/images/SAI.png" alt="SAI sigil" className="header-sigil" />
    </header>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="msg-row-user"><div className="msg-bubble-user">{content}</div></div>
  );
}

function AssistantBubble({ msg, onToggleThinking }: { msg: Message; onToggleThinking: (id: string) => void }) {
  const parts = msg.content.split(/(```[\s\S]*?```)/g);
  const hasThinking = !!msg.thinking;

  return (
    <div className="msg-row-assistant">
      <div className="msg-flat-assistant">
        {msg.image && (
          <img src={msg.image} alt="Uploaded" style={{ width: "100%", borderRadius: 10, marginBottom: 8, maxHeight: 200, objectFit: "cover" }} />
        )}

        {/* Live thinking stream — visible while streaming */}
        {msg.streaming && hasThinking && (
          <div className="thinking-live">
            <div className="thinking-label">
              <span className="pulse" />
              <span>Agentic Thinking</span>
            </div>
            {msg.thinking}
          </div>
        )}

        {/* Main response content */}
        <div className="assistant-content">
          {parts.map((part, i) =>
            part.startsWith("```") && part.endsWith("```")
              ? <div key={i} className="code-block"><pre><code>{part.slice(3, -3)}</code></pre></div>
              : <span key={i}>{part}</span>
          )}

          {/* Blue blinking cursor while streaming */}
          {msg.streaming && (
            <span className="streaming-cursor" />
          )}
        </div>

        {/* Post-completion thinking dropdown */}
        {hasThinking && !msg.streaming && (
          <div className="thinking-bar">
            <button className="thinking-toggle" onClick={() => onToggleThinking(msg.id)}>
              <Activity size={14} />
              <span>Agentic Thinking</span>
              {msg.thinkingExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {msg.thinkingExpanded && (
              <div className="thinking-content">{msg.thinking}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChatInput({ onSend, onFile, disabled }: { onSend: (text: string) => void; onFile: (file: File) => void; disabled: boolean }) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const t = text.trim(); if (!t || disabled) return; onSend(t); setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [text, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = "";
  };

  useEffect(() => {
    const el = textareaRef.current; if (!el) return;
    el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [text]);

  return (
    <div className="input-area">
      <div className="input-actions">
        <label className="input-action-btn"><ImageIcon size={18} /><input type="file" accept="image/*" hidden onChange={handleFileChange} /></label>
        <label className="input-action-btn"><FileText size={18} /><input type="file" accept="*/*" hidden onChange={handleFileChange} /></label>
      </div>
      <textarea ref={textareaRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={handleKeyDown} placeholder="Send a message…" className="chat-textarea" rows={1} />
      <button onClick={handleSend} disabled={disabled || !text.trim()} className="send-btn" aria-label="Send"><Send size={18} /></button>
    </div>
  );
}

/* ================================================================= */
/*  MAIN APP — HERMES BACKEND CONNECTED                              */
/* ================================================================= */
export default function App() {
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [isSending, setIsSending] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [connStatus, setConnStatus] = useState<"connecting" | "ready" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gwRef = useRef<HermesGateway | null>(null);
  const sessionRef = useRef<string | null>(loadSession());

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => { saveMessages(messages); scrollToBottom(); }, [messages]);

  /* ---------------------------------------------------------------- */
  /*  CONNECT TO HERMES BACKEND                                        */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const gw = new HermesGateway();
    gwRef.current = gw;

    gw.connect()
      .then(async () => {
        setConnStatus("ready");
        setErrorMsg(null);

        /* Resume or create session */
        let sessionId = sessionRef.current;
        if (!sessionId) {
          const res = await gw.request<{ session_id: string }>("session.create");
          sessionId = res.session_id;
          sessionRef.current = sessionId;
          saveSession(sessionId);
        }
      })
      .catch((err) => {
        setConnStatus("error");
        setErrorMsg(err.message);
      });

    /* Listen for streaming events */
    const unsubStart = gw.on("message.start", () => {
      setMessages((prev) => {
        if (prev.some((m) => m.streaming)) return prev;
        return [...prev, { id: uid(), role: "assistant", content: "", timestamp: Date.now(), streaming: true }];
      });
    });

    const unsubDelta = gw.on("message.delta", (ev) => {
      const text = (ev.payload?.text as string) ?? "";
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.streaming);
        if (idx === -1) return prev;
        const updated = [...prev];
        updated[idx] = { ...updated[idx], content: updated[idx].content + text };
        return updated;
      });
    });

    const unsubComplete = gw.on("message.complete", () => {
      setMessages((prev) => prev.map((m) => m.streaming ? { ...m, streaming: false } : m));
      setIsSending(false);
    });

    const unsubThink = gw.on("thinking.delta", (ev) => {
      const text = (ev.payload?.text as string) ?? "";
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.streaming);
        if (idx === -1) return prev;
        const updated = [...prev];
        updated[idx] = { ...updated[idx], thinking: (updated[idx].thinking ?? "") + text };
        return updated;
      });
    });

    const unsubError = gw.on("error", (ev) => {
      const msg = (ev.payload as any)?.message ?? "Unknown error";
      setErrorMsg(msg);
      setIsSending(false);
    });

    return () => {
      unsubStart(); unsubDelta(); unsubComplete(); unsubThink(); unsubError();
      gw.close();
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /*  SEND MESSAGE                                                     */
  /* ---------------------------------------------------------------- */
  const handleSend = useCallback(
    async (text: string) => {
      const gw = gwRef.current;
      if (!gw || gw.state !== "open") { setErrorMsg("Not connected to Hermes"); return; }

      const sessionId = sessionRef.current;
      if (!sessionId) { setErrorMsg("No active session"); return; }

      const userMsg: Message = { id: uid(), role: "user", content: text, timestamp: Date.now() };
      setMessages((prev) => [...prev, userMsg]);
      setIsSending(true);
      setErrorMsg(null);

      try {
        await gw.request("prompt.submit", { session_id: sessionId, text });
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setIsSending(false);
      }
    },
    []
  );

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const userMsg: Message = { id: uid(), role: "user", content: `[${file.name}]`, image: dataUrl, timestamp: Date.now() };
      setMessages((prev) => [...prev, userMsg]);
    };
    reader.readAsDataURL(file);
  }, []);

  const toggleThinking = useCallback((id: string) => {
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, thinkingExpanded: !m.thinkingExpanded } : m));
  }, []);

  const handleNewChat = useCallback(async () => {
    /* Clear local storage */
    try { localStorage.removeItem(MSG_KEY); } catch {}
    setMessages([]);
    setErrorMsg(null);

    /* Create fresh Hermes session */
    const gw = gwRef.current;
    if (gw && gw.state === "open") {
      try {
        const res = await gw.request<{ session_id: string }>("session.create");
        sessionRef.current = res.session_id;
        saveSession(res.session_id);
      } catch {
        /* silent — session will create on next send */
      }
    } else {
      /* If not connected, clear the stored session so next connect creates new */
      sessionRef.current = null;
      try { localStorage.removeItem(SESS_KEY); } catch {}
    }
  }, []);

  /* ---------------------------------------------------------------- */
  return (
    <div className="sanctuary-app">
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <ChatHeader onMenu={() => setDrawerOpen(true)} status={connStatus} onNewChat={handleNewChat} />

      {errorMsg && (
        <div className="error-banner">
          <span>⚠ {errorMsg}</span>
          <button onClick={() => setErrorMsg(null)}><X size={14} /></button>
        </div>
      )}

      <div className="messages-scroll" ref={scrollRef}>
        {messages.length === 0 && connStatus === "ready" && (
          <div style={{ textAlign: "center", paddingTop: "25vh", opacity: 0.5 }}>
            <img src="/images/SAI.png" alt="SAI" style={{ width: 120, opacity: 0.4 }} />
            <p style={{ marginTop: 16, fontSize: "0.9rem", color: "var(--gold)" }}>Welcome to Sanctuary.</p>
            <p style={{ marginTop: 8, fontSize: "0.8rem", color: "var(--text-muted)" }}>Connected to Hermes. Send a message to begin.</p>
          </div>
        )}

        {connStatus === "connecting" && messages.length === 0 && (
          <div style={{ textAlign: "center", paddingTop: "35vh", opacity: 0.5 }}>
            <div className="typing-indicator"><span /><span /><span /></div>
            <p style={{ marginTop: 12, fontSize: "0.85rem", color: "var(--text-muted)" }}>Connecting to Hermes…</p>
          </div>
        )}

        {messages.map((msg) =>
          msg.role === "user"
            ? <UserBubble key={msg.id} content={msg.content} />
            : <AssistantBubble key={msg.id} msg={msg} onToggleThinking={toggleThinking} />
        )}
      </div>

      <ChatInput onSend={handleSend} onFile={handleFile} disabled={isSending || connStatus !== "ready"} />
    </div>
  );
}
