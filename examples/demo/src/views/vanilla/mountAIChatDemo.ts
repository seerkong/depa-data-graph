import xs, { Stream, Listener } from 'xstream';
import {
  DataGraph,
  StreamGraph,
  GraphBridge,
  subscribeStreamToSignal,
} from 'depa-data-graph-core';
import { watch } from 'depa-data-graph-core';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRuntime {
  graph: DataGraph<ChatRuntime>;
  streamGraph: StreamGraph;
  bridge: GraphBridge<ChatRuntime>;
  intents: {
    sendMessage: (content: string) => void;
    clearChat: () => void;
  };
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
  const streamGraph = new StreamGraph();
  const bridge = new GraphBridge(graph, streamGraph);

  graph.addSignal<ChatMessage[]>('messages', []);
  graph.addSignal<string>('currentResponse', '');
  graph.addSignal<boolean>('isStreaming', false);
  graph.addSignal<string>('inputValue', '');

  graph.addComputed<number>('messageCount', ['messages'], (ctx) => {
    return ctx.get<ChatMessage[]>('messages').length;
  });

  graph.addComputed<string>('streamingDisplay', ['currentResponse', 'isStreaming'], (ctx) => {
    const response = ctx.get<string>('currentResponse');
    const streaming = ctx.get<boolean>('isStreaming');
    return streaming ? response + '▊' : response;
  });

  let currentStreamCleanup: (() => void) | null = null;

  runtime.graph = graph;
  runtime.streamGraph = streamGraph;
  runtime.bridge = bridge;

  runtime.intents = {
    sendMessage: (content: string) => {
      if (!content.trim()) return;
      if (graph.peek<boolean>('isStreaming')) return;

      graph.batch(() => {
        const messages = graph.peek<ChatMessage[]>('messages');
        graph.set('messages', [...messages, { role: 'user', content }]);
        graph.set('currentResponse', '');
        graph.set('isStreaming', true);
        graph.set('inputValue', '');
      });

      const ai$ = createMockAIStream(content);

      currentStreamCleanup = subscribeStreamToSignal(graph, 'currentResponse', ai$, {
        initial: '',
        reducer: (prev, chunk) => prev + chunk,
        onComplete: () => {
          const finalResponse = graph.peek<string>('currentResponse');
          graph.batch(() => {
            const messages = graph.peek<ChatMessage[]>('messages');
            graph.set('messages', [...messages, { role: 'assistant', content: finalResponse }]);
            graph.set('currentResponse', '');
            graph.set('isStreaming', false);
          });
          currentStreamCleanup = null;
        },
      });
    },

    clearChat: () => {
      if (currentStreamCleanup) {
        currentStreamCleanup();
        currentStreamCleanup = null;
      }
      graph.batch(() => {
        graph.set('messages', []);
        graph.set('currentResponse', '');
        graph.set('isStreaming', false);
      });
    },
  };

  return runtime;
}

export function mountAIChatDemo(container: HTMLElement): void {
  const runtime = createChatRuntime();
  const { graph, intents } = runtime;

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

  watch(
    () => graph.get<ChatMessage[]>('messages'),
    (messages) => renderMessages(messages),
  );

  watch(
    () => graph.get<string>('streamingDisplay'),
    (display) => {
      const isStreaming = graph.peek<boolean>('isStreaming');
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
    () => graph.get<boolean>('isStreaming'),
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
    intents.sendMessage(inputEl.value);
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      intents.sendMessage(inputEl.value);
    }
  });

  clearBtn.addEventListener('click', () => {
    intents.clearChat();
  });
}
