'use client';

import { useState, useRef, useEffect } from 'react';
import Button from '@/components/ui/Button';

const QUICK_PROMPTS = [
  '🍜 Best local food spots?',
  '💰 Budget-friendly alternatives?',
  '🌅 Best sunset viewpoints?',
  '🚌 How to get around?',
  '📦 What should I pack?',
  '🕐 Optimize my schedule',
];

export default function AIChatPanel({ trip, days, activities, isOpen, onClose }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `Hey! I'm your WanderForge AI assistant 🧭\n\nI can help you plan your trip to **${trip?.destination || 'your destination'}**. Ask me anything — best restaurants, hidden gems, how to save money, or let me optimize your itinerary!\n\nTry one of the quick prompts below 👇`,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  const allActivities = activities ? Object.values(activities).flat() : [];

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;

    const userMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages.filter(m => m.role !== 'assistant' || messages.indexOf(m) > 0), userMessage].map(m => ({
            role: m.role,
            content: m.content,
          })),
          tripContext: {
            destination: trip?.destination,
            days: days?.length,
            transportMode: trip?.transport_mode,
            budgetLevel: trip?.ai_preferences?.budget_level,
            activityCount: allActivities.length,
          },
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.reply || 'Sorry, I couldn\'t generate a response.' },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `❌ ${err.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="chat-overlay" onClick={onClose} />
      <div className="chat-panel">
        {/* Header */}
        <div className="chat-panel__header">
          <div className="chat-panel__header-info">
            <span className="chat-panel__header-icon">🤖</span>
            <div>
              <h3 className="chat-panel__title">AI Assistant</h3>
              <p className="chat-panel__subtitle">{trip?.destination || 'Trip Planner'}</p>
            </div>
          </div>
          <button className="chat-panel__close" onClick={onClose}>✕</button>
        </div>

        {/* Messages */}
        <div className="chat-panel__messages">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`chat-msg ${msg.role === 'user' ? 'chat-msg--user' : 'chat-msg--ai'}`}
            >
              {msg.role === 'assistant' && (
                <div className="chat-msg__avatar">🧭</div>
              )}
              <div className="chat-msg__bubble">
                {msg.content.split('\n').map((line, j) => (
                  <p key={j}>{line.replace(/\*\*(.*?)\*\*/g, '$1')}</p>
                ))}
              </div>
            </div>
          ))}

          {loading && (
            <div className="chat-msg chat-msg--ai">
              <div className="chat-msg__avatar">🧭</div>
              <div className="chat-msg__bubble chat-msg__typing">
                <span/><span/><span/>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Quick Prompts */}
        {messages.length <= 2 && (
          <div className="chat-panel__quick">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                className="quick-prompt"
                onClick={() => sendMessage(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="chat-panel__input">
          <input
            ref={inputRef}
            type="text"
            placeholder="Ask me anything about your trip..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </Button>
        </div>
      </div>

      <style jsx>{`
        .chat-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.3);
          z-index: 998;
          backdrop-filter: blur(2px);
        }

        .chat-panel {
          position: fixed;
          right: 0;
          top: 0;
          bottom: 0;
          width: 420px;
          max-width: 100vw;
          background: var(--color-bg);
          border-left: 1px solid var(--color-border-light);
          box-shadow: var(--shadow-2xl);
          z-index: 999;
          display: flex;
          flex-direction: column;
          animation: slideIn 0.25s ease-out;
        }

        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }

        .chat-panel__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-4) var(--space-5);
          border-bottom: 1px solid var(--color-border-light);
          background: var(--color-surface);
        }

        .chat-panel__header-info {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .chat-panel__header-icon {
          font-size: 28px;
        }

        .chat-panel__title {
          font-size: var(--text-base);
          font-weight: 700;
        }

        .chat-panel__subtitle {
          font-size: var(--text-xs);
          color: var(--color-text-tertiary);
        }

        .chat-panel__close {
          width: 32px;
          height: 32px;
          border-radius: var(--radius-md);
          border: none;
          background: var(--color-bg-secondary);
          cursor: pointer;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all var(--transition-fast);
        }

        .chat-panel__close:hover {
          background: var(--color-bg-tertiary);
        }

        .chat-panel__messages {
          flex: 1;
          overflow-y: auto;
          padding: var(--space-4) var(--space-5);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .chat-msg {
          display: flex;
          gap: var(--space-2);
          max-width: 90%;
        }

        .chat-msg--user {
          align-self: flex-end;
          flex-direction: row-reverse;
        }

        .chat-msg--ai {
          align-self: flex-start;
        }

        .chat-msg__avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: var(--color-bg-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          flex-shrink: 0;
          margin-top: 2px;
        }

        .chat-msg__bubble {
          padding: var(--space-3) var(--space-4);
          border-radius: var(--radius-lg);
          font-size: var(--text-sm);
          line-height: 1.55;
        }

        .chat-msg__bubble p {
          margin: 0;
        }

        .chat-msg__bubble p + p {
          margin-top: 6px;
        }

        .chat-msg--ai .chat-msg__bubble {
          background: var(--color-surface);
          border: 1px solid var(--color-border-light);
          border-bottom-left-radius: 4px;
          color: var(--color-text);
        }

        .chat-msg--user .chat-msg__bubble {
          background: var(--color-primary);
          color: white;
          border-bottom-right-radius: 4px;
        }

        .chat-msg__typing {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: var(--space-3) var(--space-5);
        }

        .chat-msg__typing span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--color-text-tertiary);
          animation: typingBounce 1.2s infinite;
        }

        .chat-msg__typing span:nth-child(2) { animation-delay: 0.2s; }
        .chat-msg__typing span:nth-child(3) { animation-delay: 0.4s; }

        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-6px); opacity: 1; }
        }

        .chat-panel__quick {
          padding: 0 var(--space-5) var(--space-3);
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .quick-prompt {
          padding: 5px 12px;
          border-radius: var(--radius-full);
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          font-family: var(--font-body);
          font-size: var(--text-xs);
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: all var(--transition-fast);
          white-space: nowrap;
        }

        .quick-prompt:hover {
          border-color: var(--color-primary);
          color: var(--color-primary);
          background: rgba(var(--color-primary-rgb), 0.05);
        }

        .chat-panel__input {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-3) var(--space-4);
          border-top: 1px solid var(--color-border-light);
          background: var(--color-surface);
        }

        .chat-panel__input input {
          flex: 1;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-full);
          padding: var(--space-2) var(--space-4);
          font-family: var(--font-body);
          font-size: var(--text-sm);
          background: var(--color-bg);
          color: var(--color-text);
          outline: none;
          transition: all var(--transition-fast);
        }

        .chat-panel__input input:focus {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb), 0.1);
        }

        @media (max-width: 480px) {
          .chat-panel {
            width: 100vw;
          }
        }
      `}</style>
    </>
  );
}
