'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Sparkles } from 'lucide-react';
import { AppShell, PageHeader } from '@/components/app-shell';
import { Badge, Card, Disclaimer, Spinner } from '@/components/ui';
import { api, ApiClientError } from '@/lib/client/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  references?: { kind: string; id: string; title: string }[];
  provider?: string;
}

const SUGGESTIONS = [
  'Which job should I apply for first?',
  'What closes this week?',
  'What skills am I missing?',
  'Which government exams am I eligible for?',
  'Why did this opportunity score high?',
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setInput('');
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setBusy(true);
    try {
      const reply = await api.post<{ answer: string; references: Message['references']; provider: string; usedFallback: boolean }>('/api/assistant/chat', {
        message: question,
        history: messages.map((message) => ({ role: message.role, content: message.content })),
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: reply.answer, references: reply.references, provider: reply.provider }]);
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'The assistant could not answer.';
      setError(message);
      setMessages((prev) => [...prev, { role: 'assistant', content: message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="AI career assistant"
        subtitle="Grounded in your profile and the records in your database — it will not invent jobs, dates or eligibility."
      />

      <Card className="flex h-[70vh] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <MessageSquare className="h-5 w-5" />
              </span>
              <p className="mt-3 font-medium text-ink-900">Ask about your opportunities</p>
              <p className="muted mt-1 max-w-md text-sm">
                The assistant reads your analysed profile and the opportunities, examinations, saved items and applications stored
                for you. It answers from that data only.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} onClick={() => void send(suggestion)} className="btn-secondary btn-sm">
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${message.role === 'user' ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-900'}`}>
                  <p className="whitespace-pre-line text-sm leading-relaxed">{message.content}</p>
                  {message.references?.length ? (
                    <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-ink-200/60 pt-2">
                      {message.references.map((reference) => (
                        <Link
                          key={`${reference.kind}-${reference.id}`}
                          href={reference.kind === 'exam' ? `/exam/${reference.id}` : reference.kind === 'opportunity' ? `/opportunity/${reference.id}` : '/skills'}
                          className="badge tone-neutral hover:tone-brand"
                        >
                          {reference.title}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  {message.provider ? (
                    <p className={`mt-2 text-[11px] ${message.role === 'user' ? 'text-white/70' : 'text-ink-500'}`}>
                      <Sparkles className="mr-1 inline h-3 w-3" />
                      {message.provider}
                    </p>
                  ) : null}
                </div>
              </div>
            ))
          )}
          {busy ? (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-ink-100 px-4 py-3">
                <Spinner label="Thinking…" />
              </div>
            </div>
          ) : null}
          <div ref={bottom} />
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
          className="flex items-center gap-2 border-t border-ink-200 p-3"
        >
          <input
            className="input flex-1"
            placeholder="Ask about deadlines, eligibility, matches or skill gaps…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !input.trim()} className="btn-primary">
            <Send className="h-4 w-4" /> Send
          </button>
        </form>
      </Card>

      {error ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {error} The deterministic fallback still answers from your own data when no AI provider is configured.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Badge tone="muted">Never invents jobs, dates or eligibility</Badge>
        <Badge tone="muted">Grounded in your database</Badge>
        <Badge tone="muted">Falls back to deterministic answers</Badge>
      </div>

      <Disclaimer />
    </AppShell>
  );
}
