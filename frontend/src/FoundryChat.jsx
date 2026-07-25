// src/FoundryChat.jsx
import React, { useState, useRef, useEffect } from "react";

// In production this widget is served by the same Express app it talks to,
// so requests can just use a relative path. In local dev the frontend and
// backend run on separate Vite/Express ports, so point at the backend directly.
const BACKEND_URL = import.meta.env.PROD ? "" : "http://localhost:3002";

const FoundryChat = ({ agentTitle = "RAV4 Support Agent" }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isSending) return;

    setError(null);
    setIsSending(true);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      const endpoint = conversationId ? "/api/agent/message" : "/api/agent/start";
      const body = conversationId ? { conversationId, text } : { text };

      const resp = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || `Request failed with status ${resp.status}`);
      }

      if (!conversationId && data.conversationId) {
        setConversationId(data.conversationId);
      }

      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setError(err.message || "Something went wrong talking to the agent.");
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>{agentTitle}</div>

      <div style={styles.messageList} ref={scrollRef}>
        {messages.length === 0 && (
          <div style={styles.placeholder}>Ask a question to get started.</div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              ...styles.bubble,
              ...(m.role === "user" ? styles.userBubble : styles.assistantBubble),
            }}
          >
            {m.content}
          </div>
        ))}

        {isSending && <div style={styles.typingIndicator}>Agent is typing…</div>}
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.inputRow}>
        <textarea
          style={styles.textarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message..."
          rows={1}
          disabled={isSending}
        />
        <button style={styles.sendButton} onClick={sendMessage} disabled={isSending || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: "560px",
    width: "100%",
    maxWidth: "560px",
    border: "1px solid #e2e2e2",
    borderRadius: "16px",
    overflow: "hidden",
    fontFamily: "'Helvetica Neue', Arial, system-ui, sans-serif",
    boxShadow: "rgba(0, 0, 0, 0.08) 0 4px 16px -4px, rgba(0, 0, 0, 0.04) 0 2px 6px -2px",
  },
  header: {
    background: "#1a1a1a",
    color: "#fff",
    padding: "16px 20px",
    fontWeight: 700,
    borderBottom: "3px solid #eb0a1e",
  },
  messageList: {
    flex: 1,
    overflowY: "auto",
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    background: "#f7f7f7",
  },
  placeholder: {
    color: "#888",
    fontSize: "14px",
    margin: "auto",
  },
  bubble: {
    maxWidth: "80%",
    padding: "8px 12px",
    borderRadius: "12px",
    fontSize: "14px",
    lineHeight: 1.4,
    whiteSpace: "pre-wrap",
  },
  userBubble: {
    alignSelf: "flex-end",
    background: "#eb0a1e",
    color: "#fff",
  },
  assistantBubble: {
    alignSelf: "flex-start",
    background: "#fff",
    border: "1px solid #e0e0e0",
    color: "#222",
  },
  typingIndicator: {
    fontSize: "13px",
    color: "#888",
    fontStyle: "italic",
  },
  error: {
    background: "#fdecea",
    color: "#b3261e",
    padding: "8px 12px",
    fontSize: "13px",
  },
  inputRow: {
    display: "flex",
    gap: "8px",
    padding: "10px",
    borderTop: "1px solid #e0e0e0",
    background: "#fff",
  },
  textarea: {
    flex: 1,
    resize: "none",
    padding: "8px",
    borderRadius: "6px",
    border: "1px solid #ccc",
    fontSize: "14px",
    fontFamily: "inherit",
  },
  sendButton: {
    padding: "0 20px",
    borderRadius: "6px",
    border: "none",
    background: "#eb0a1e",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
};

export default FoundryChat;
