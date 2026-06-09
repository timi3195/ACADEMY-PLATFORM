import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import "./ChatInterface.css";

const ChatInterface = ({ courseId, courseName }) => {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [error, setError] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef(null);

  const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load conversation history on mount
  useEffect(() => {
    if (courseId) {
      loadConversations();
    }
  }, [courseId]);

  const loadConversations = async () => {
    try {
      const response = await axios.get(`${API_BASE}/ai/chat/${courseId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      if (response.data.success) {
        setConversations(response.data.conversations);
      }
    } catch (error) {
      console.error("Error loading conversations:", error);
    }
  };

  const loadConversation = async (convId) => {
    try {
      const response = await axios.get(`${API_BASE}/ai/chat/conversation/${convId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      if (response.data.success) {
        setMessages(response.data.conversation.messages);
        setConversationId(convId);
        setShowHistory(false);
      }
    } catch (error) {
      console.error("Error loading conversation:", error);
      setError("Failed to load conversation");
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const userMessage = {
      role: "student",
      content: inputValue,
      timestamp: new Date()
    };

    setMessages([...messages, userMessage]);
    setInputValue("");
    setIsLoading(true);
    setError(null);

    try {
      const response = await axios.post(
        `${API_BASE}/ai/chat`,
        {
          courseId,
          message: inputValue,
          conversationId
        },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        }
      );

      if (response.data.success) {
        const assistantMessage = {
          role: "assistant",
          content: response.data.message,
          timestamp: new Date(),
          tokens: response.data.tokens.total,
          cost: response.data.cost
        };

        setMessages(prev => [...prev, assistantMessage]);
        setConversationId(response.data.conversationId);

        // Refresh conversation list
        loadConversations();
      }
    } catch (error) {
      console.error("Chat error:", error);
      setError(error.response?.data?.message || "Failed to send message");
      setMessages(prev => prev.slice(0, -1)); // Remove failed user message
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteConversation = async (convId) => {
    if (!window.confirm("Delete this conversation?")) return;

    try {
      await axios.delete(`${API_BASE}/ai/chat/${convId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      loadConversations();
      if (conversationId === convId) {
        setMessages([]);
        setConversationId(null);
      }
    } catch (error) {
      console.error("Error deleting conversation:", error);
      setError("Failed to delete conversation");
    }
  };

  const startNewChat = () => {
    setMessages([]);
    setConversationId(null);
    setShowHistory(false);
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2>📚 {courseName || "AI Study Assistant"}</h2>
        <div className="header-actions">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="btn-history"
            title="Show chat history"
          >
            📋 History
          </button>
          <button onClick={startNewChat} className="btn-new">
            ➕ New Chat
          </button>
        </div>
      </div>

      <div className="chat-main">
        {/* Sidebar - Conversation History */}
        {showHistory && (
          <div className="chat-sidebar">
            <h3>Conversations</h3>
            <div className="conversations-list">
              {conversations.length === 0 ? (
                <p className="no-conversations">No conversations yet</p>
              ) : (
                conversations.map(conv => (
                  <div
                    key={conv._id}
                    className={`conversation-item ${conversationId === conv._id ? "active" : ""}`}
                    onClick={() => loadConversation(conv._id)}
                  >
                    <div className="conv-title">{conv.title}</div>
                    <div className="conv-meta">
                      {new Date(conv.createdAt).toLocaleDateString()}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteConversation(conv._id);
                      }}
                      className="btn-delete"
                    >
                      🗑️
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Messages Area */}
        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🤖</div>
              <h3>Start a conversation</h3>
              <p>Ask me anything about {courseName}</p>
              <div className="suggested-prompts">
                <p className="label">Try asking:</p>
                <button onClick={() => setInputValue("Explain the main concepts of this course")}>
                  "Explain the main concepts"
                </button>
                <button onClick={() => setInputValue("What are the most important topics?")}>
                  "What are the key topics?"
                </button>
                <button onClick={() => setInputValue("Help me understand this concept...")}>
                  "Help me understand..."
                </button>
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`message message-${msg.role}`}>
                <div className="message-avatar">
                  {msg.role === "student" ? "👤" : "🤖"}
                </div>
                <div className="message-content">
                  <div className="message-text">{msg.content}</div>
                  {msg.role === "assistant" && msg.tokens && (
                    <div className="message-meta">
                      Tokens: {msg.tokens} | Cost: ${msg.cost?.toFixed(4) || "0.0000"}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {isLoading && (
            <div className="message message-assistant loading">
              <div className="message-avatar">🤖</div>
              <div className="message-content">
                <div className="typing-indicator">
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="error-message">
              <span>❌ {error}</span>
              <button onClick={() => setError(null)}>Dismiss</button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <form onSubmit={handleSendMessage} className="chat-input-form">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Ask me anything..."
          disabled={isLoading}
          className="chat-input"
        />
        <button type="submit" disabled={isLoading} className="btn-send">
          {isLoading ? "📤 Sending..." : "📤 Send"}
        </button>
      </form>
    </div>
  );
};

export default ChatInterface;
