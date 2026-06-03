import { useState, useRef, useEffect, useCallback } from "react";
import {
  Menu,
  Settings,
  Search,
  Send,
  Image as ImageIcon,
  FileText,
  MessageCircle,
} from "lucide-react";

type Role = "user" | "assistant";

interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  streaming?: boolean;
  image?: string; // data URL
}

/* ================================================================= */
/*  LOCAL STORAGE persistence                                        */
/* ================================================================= */
const STORAGE_KEY = "sanctuary.messages.v1";

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMessages(msgs: Message[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
  } catch {
    /* storage full / private mode */
  }
}

/* ================================================================= */
/*  UNIQUE ID                                                      */
/* ================================================================= */
function uid() {
  return Math.random().toString(36).slice(2, 11);
}

/* ================================================================= */
/*  CHAT HEADER                                                      */
/* ================================================================= */
function ChatHeader() {
  return (
    <header className="chat-header">
      <button className="menu-btn" aria-label="Menu">
        <Menu size={20} />
      </button>
      <span className="header-title">SAI Hermes ☤</span>
      <img
        src="/images/SAI.png"
        alt="SAI sigil"
        className="header-sigil"
      />
    </header>
  );
}

/* ================================================================= */
/*  MESSAGE COMPONENTS                                               */
/* ================================================================= */
function UserBubble({ content }: { content: string }) {
  return (
    <div className="msg-row-user">
      <div className="msg-bubble-user">{content}</div>
    </div>
  );
}

function StreamingBlock({ content }: { content: string }) {
  return (
    <div className="streaming-block">
      {content}
    </div>
  );
}

function AssistantBubble({ msg }: { msg: Message }) {
  /* If the content contains triple backticks, wrap those sections in
     the blue streaming block.  This is a heuristic for "agent thinks" */
  const parts = msg.content.split(/(```[\s\S]*?```)/g);
  return (
    <div className="msg-row-assistant">
      <div className="msg-bubble-assistant">
        {msg.image && (
          <img
            src={msg.image}
            alt="Uploaded"
            style={{
              width: "100%",
              borderRadius: 10,
              marginBottom: 8,
              maxHeight: 200,
              objectFit: "cover",
            }}
          />
        )}
        {parts.map((part, i) =>
          part.startsWith("```")&&part.endsWith("```")
            ? <StreamingBlock key={i} content={part.slice(3, -3)} />
            : <span key={i}>{part}</span>
        )}
        {msg.streaming && (
          <div className="typing-indicator">
            <span /><span /><span />
          </div>
        )}
      </div>
    </div>);
}

/* ================================================================= */
/*  CHAT INPUT                                                       */
/* ================================================================= */
function ChatInput({
  onSend,
  onFile,
  disabled,
}: {
  onSend: (text: string) => void;
  onFile: (file: File) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [text, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFile(f);
    e.target.value = "";
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [text]);

  return (
    <div className="input-area">
      <div className="input-actions">
        <label className="input-action-btn">
          <ImageIcon size={18} />
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={handleFileChange}
          />
        </label>
        <label className="input-action-btn">
          <FileText size={18} />
          <input
            type="file"
            accept="*/*"
            hidden
            onChange={handleFileChange}
          />
        </label>
      </div>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Send a message…"
        className="chat-textarea"
        rows={1}
      />

      <button
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        className="send-btn"
        aria-label="Send"
      >
        <Send size={18} />
      </button>
    </div>
  );
}

/* ================================================================= */
/*  BOTTOM NAV                                                       */
/* ================================================================= */
type Screen = "chat" | "search" | "settings";

function BottomNav({ active }: { active: Screen }) {
  const items: { key: Screen; label: string; Icon: typeof MessageCircle }[] = [
    { key: "chat", label: "Chat", Icon: MessageCircle },
    { key: "search", label: "Search", Icon: Search },
    { key: "settings", label: "Settings", Icon: Settings },
  ];

  /* This is a no-op nav — real routing not needed for MVP */
  return (
    <nav className="bottom-nav">
      {items.map(({ key, label, Icon }) => (
        <a
          key={key}
          href={`#${key}`}
          className={`nav-item ${active === key ? "active" : ""}`}
        >
          <Icon size={22} />
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}

/* ================================================================= */
/*  MAIN APP                                                         */
/* ================================================================= */
export default function App() {
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    saveMessages(messages);
    scrollToBottom();
  }, [messages]);

  /* ---------------------------------------------------------------- */
  const handleSend = useCallback(
    async (text: string) => {
      const userMsg: Message = {
        id: uid(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };

      const assistantPlaceholder: Message = {
        id: uid(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        streaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
      setIsSending(true);

      try {
        /* ------------------------------------------------------ */
        /*  Send to Hermes backend via REST (POST /api/message     */
        /*  if it exists, else echo for demo)                      */
        /* ------------------------------------------------------ */
        const response = await fetch("http://192.168.1.1:9119/api/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });

        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();

        let replyText = data?.reply ?? data?.message ?? data?.content ?? "";
        /* Fallback — simulate streaming if backend not reachable */
        if (!replyText) throw new Error("No reply field");

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantPlaceholder.id
              ? { ...m, content: replyText, streaming: false }
              : m
          )
        );
      } catch (err) {
        /* -------------- DEMO / FALLBACK STREAMING -------------- */
        const demoReply = `Echo: ${text}`;
        await new Promise((r) => setTimeout(r, 600));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantPlaceholder.id
              ? { ...m, content: demoReply, streaming: false }
              : m
          )
        );
      } finally {
        setIsSending(false);
      }
    },
    []
  );

  /* ---------------------------------------------------------------- */
  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const userMsg: Message = {
          id: uid(),
          role: "user",
          content: `[${file.name}]`,
          image: dataUrl,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, userMsg]);
      };
      reader.readAsDataURL(file);
    },
    []
  );

  /* ---------------------------------------------------------------- */
  return (
    <div className="sanctuary-app">
      <ChatHeader />

      <div className="messages-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", paddingTop: "30vh", opacity: 0.5 }}>
            <img src="/images/SAI.png" alt="SAI" style={{ width: 120, opacity: 0.4 }} />
            <p style={{ marginTop: 16, fontSize: "0.9rem", color: "var(--gold)" }}>
              Welcome to Sanctuary.
            </p>
            <p style={{ marginTop: 8, fontSize: "0.8rem", color: "var(--text-muted)" }}>
              Your sacred Hermes messenger.
            </p>
          </div>
        )}
        {messages.map((msg) =>
          msg.role === "user" ? (
            <UserBubble key={msg.id} content={msg.content} />
          ) : (
            <AssistantBubble key={msg.id} msg={msg} />
          )
        )}
      </div>

      <ChatInput onSend={handleSend} onFile={handleFile} disabled={isSending} />
      <BottomNav active="chat" />
    </div>
  );
}
