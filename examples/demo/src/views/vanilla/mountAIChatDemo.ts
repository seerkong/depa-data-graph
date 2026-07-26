import xs, { Stream, Listener } from 'xstream';
import { DataGraph } from 'depa-data-graph-core';
import type { SignalNodeRef } from 'depa-data-graph-core';
import { watch } from 'depa-data-graph-core';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRuntime {
  graph: DataGraph<ChatRuntime>;
  currentStreamCleanup: (() => void) | null;
  nextStreamSequence: number;
  state: {
    output: SignalNodeRef<ChatState, false>;
    getState: () => ChatState;
    mutations: {
      appendChunk: (chunk: string) => ChatState;
      finishResponse: (content: string) => ChatState;
    };
    actions: {
      sendMessage: (content: string) => void;
      clearChat: () => void;
    };
  };
}

interface ChatState {
  messages: ChatMessage[];
  currentResponse: string;
  isStreaming: boolean;
}

const MOCK_RESPONSES = [
  "Hello! I'm a simulated AI assistant. How can I help you today?",
  "That's an interesting question! Let me think about it...\n\nBased on my analysis, I would suggest considering multiple perspectives on this topic.",
  'Great point! Here are some thoughts:\n\n1. First, we should consider the context\n2. Then, analyze the key factors\n3. Finally, draw conclusions based on evidence',
  "I understand what you're asking. The answer involves several interconnected concepts that I'll explain step by step.",
  "Thank you for sharing that! It's a fascinating topic that touches on many areas of knowledge.",
];

function createMockAIStream(userMessage: string): Stream<string> {
  const responseIndex = Math.abs(userMessage.length) % MOCK_RESPONSES.length;
  const fullResponse = MOCK_RESPONSES[responseIndex];
  const words = fullResponse.split(' ');

  let intervalId: ReturnType<typeof setInterval> | null = null;

  return xs.create<string>({
    start(listener: Listener<string>) {
      let index = 0;
      intervalId = setInterval(
        () => {
          if (index < words.length) {
            listener.next(words[index] + (index < words.length - 1 ? ' ' : ''));
            index++;
          } else {
            if (intervalId) clearInterval(intervalId);
            intervalId = null;
            listener.complete();
          }
        },
        50 + Math.random() * 50,
      );
    },
    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  });
}

function createChatRuntime(): ChatRuntime {
  const runtime = {} as ChatRuntime;

  const graph = new DataGraph<ChatRuntime>(() => runtime);
  runtime.graph = graph;
  runtime.currentStreamCleanup = null;
  runtime.nextStreamSequence = 0;

  const driver = graph.addSignal('chat/state-driver', null);
  const state = graph.addSignalDrivenStateSignalNode({
    id: 'chat/state',
    input: driver.ref,
    initial: { messages: [], currentResponse: '', isStreaming: false } as ChatState,
    reducer: (current) => current,
    mutations: {
      beginMessage: (current, content: string) => ({
        messages: [...current.messages, { role: 'user' as const, content }],
        currentResponse: '',
        isStreaming: true,
      }),
      appendChunk: (current, chunk: string) => ({
        ...current,
        currentResponse: current.currentResponse + chunk,
      }),
      finishResponse: (current, content: string) => ({
        messages: [...current.messages, { role: 'assistant' as const, content }],
        currentResponse: '',
        isStreaming: false,
      }),
      clear: () => ({ messages: [], currentResponse: '', isStreaming: false }),
    },
    actions: (rt) => ({
      sendMessage: (content: string) => {
        if (!content.trim() || rt.getState().isStreaming) {
          return;
        }

        rt.mutations.beginMessage(content);
        const ai$ = createMockAIStream(content);
        const sequence = ++rt.bizRuntime.nextStreamSequence;
        const source = rt.bizRuntime.graph.addSource(`ai-response-source-${sequence}`, ai$);
        const response = rt.bizRuntime.graph.addStreamDrivenStateSignalNode({
          id: `ai-response-state-${sequence}`,
          input: source.ref,
          initial: '',
          reducer: (current, chunk) => current + chunk,
        });
        rt.bizRuntime.graph.addConsumer(
          `ai-response-consumer-${sequence}`,
          [response.output],
          (responseRt) => rt.mutations.appendChunk(responseRt.graph.get(response.output)),
        );
        const completion = rt.bizRuntime.graph.stream(source.ref).subscribe({
          next: () => {},
          error: () => {
            response.dispose();
            rt.bizRuntime.currentStreamCleanup = null;
          },
          complete: () => {
            rt.mutations.finishResponse(response.getState());
            response.dispose();
            rt.bizRuntime.currentStreamCleanup = null;
          },
        });
        rt.bizRuntime.currentStreamCleanup = () => {
          completion.unsubscribe();
          response.dispose();
        };
      },
      clearChat: () => {
        rt.bizRuntime.currentStreamCleanup?.();
        rt.bizRuntime.currentStreamCleanup = null;
        rt.mutations.clear();
      },
    }),
  });
  runtime.state = state;

  graph.addComputed<number>('messageCount', [state.output], (rt) => {
    return rt.graph.get(state.output).messages.length;
  });

  graph.addComputed<string>('streamingDisplay', [state.output], (rt) => {
    const current = rt.graph.get(state.output);
    return current.isStreaming ? current.currentResponse + '▊' : current.currentResponse;
  });

  return runtime;
}

export function mountAIChatDemo(container: HTMLElement): void {
  const runtime = createChatRuntime();
  const { graph, state } = runtime;

  container.innerHTML = `
    <div class="chat-container">
      <div class="chat-header">
        <h3>AI Chat Demo</h3>
        <span class="chat-status"></span>
        <button class="clear-btn">Clear</button>
      </div>
      <div class="chat-messages"></div>
      <div class="chat-streaming"></div>
      <div class="chat-input-row">
        <input type="text" class="chat-input" placeholder="Type a message..." />
        <button class="send-btn">Send</button>
      </div>
      <div class="chat-stats"></div>
    </div>
  `;

  const messagesEl = container.querySelector('.chat-messages')!;
  const streamingEl = container.querySelector('.chat-streaming')!;
  const inputEl = container.querySelector('.chat-input') as HTMLInputElement;
  const sendBtn = container.querySelector('.send-btn') as HTMLButtonElement;
  const clearBtn = container.querySelector('.clear-btn') as HTMLButtonElement;
  const statusEl = container.querySelector('.chat-status')!;
  const statsEl = container.querySelector('.chat-stats')!;

  function renderMessages(messages: ChatMessage[]) {
    messagesEl.innerHTML = messages
      .map(
        (msg) => `
        <div class="chat-message ${msg.role}">
          <div class="chat-role">${msg.role === 'user' ? 'You' : 'AI'}</div>
          <div class="chat-content">${escapeHtml(msg.content)}</div>
        </div>
      `,
      )
      .join('');
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  watch(() => graph.get(state.output).messages, renderMessages);

  watch(
    () => graph.get<string>('streamingDisplay'),
    (display) => {
      const isStreaming = state.getState().isStreaming;
      if (isStreaming && display) {
        streamingEl.innerHTML = `
          <div class="chat-message assistant streaming">
            <div class="chat-role">AI</div>
            <div class="chat-content">${escapeHtml(display)}</div>
          </div>
        `;
        streamingEl.scrollTop = streamingEl.scrollHeight;
      } else {
        streamingEl.innerHTML = '';
      }
    },
  );

  watch(
    () => graph.get(state.output).isStreaming,
    (streaming) => {
      statusEl.textContent = streaming ? '● Streaming...' : '○ Ready';
      statusEl.className = `chat-status ${streaming ? 'active' : ''}`;
      sendBtn.disabled = streaming;
      inputEl.disabled = streaming;
    },
  );

  watch(
    () => graph.get<number>('messageCount'),
    (count) => {
      statsEl.textContent = `Messages: ${count}`;
    },
  );

  sendBtn.addEventListener('click', () => {
    state.actions.sendMessage(inputEl.value);
    inputEl.value = '';
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      state.actions.sendMessage(inputEl.value);
      inputEl.value = '';
    }
  });

  clearBtn.addEventListener('click', () => {
    state.actions.clearChat();
  });
}
