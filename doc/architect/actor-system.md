# Actor System

Cross-framework messaging using the Actor model pattern.

**Source**: `packages/core/src/actor.ts`

## Overview

The `ActorSystem` enables isolated framework views to communicate via typed messages, avoiding shared mutable state.

```typescript
class ActorSystem<TRuntime, TMessage> {
  // Register actor (with or without state)
  register<TState>(id: string, handler: ActorHandler<TRuntime, TMessage, TState>): void;
  register<TState>(id: string, options: ActorOptions<TRuntime, TMessage, TState>): void;

  unregister(id: string): void;

  // External messaging
  sendFrom(from: string, to: string, msg: TMessage): void;
  broadcastFrom(from: string, msg: TMessage, opts?: { excludeSelf?: boolean }): void;
  refFrom(from: string, to: string): ActorRef<TMessage> | undefined;

  ids(): string[];
  has(id: string): boolean;
}
```

## Core Concepts

### Type Hierarchy

| Type        | Visibility    | Purpose                                           |
| ----------- | ------------- | ------------------------------------------------- |
| `ActorCell` | Internal      | Storage: handler, state, queue, processing flag   |
| `ActorSelf` | Handler param | Full access: state, runtime, send, broadcast, ref |
| `ActorRef`  | External      | Limited access: send only (from bound)            |

### Actors

An actor is an isolated unit that:

- Has a unique ID (e.g., `'vanilla'`, `'vue'`, `'react'`, `'solid'`)
- Processes messages sequentially (mailbox pattern)
- Can send messages to other actors
- Cannot directly access other actors' state
- Can have optional persistent state

### Messages

Typed union of all possible message shapes:

```typescript
type DemoMessage =
  | { type: 'ping' }
  | { type: 'pong'; text: string }
  | { type: 'inc'; by: number }
  | { type: 'setInput'; text: string }
  | { type: 'submit' };
```

### Envelope

Every message is wrapped in an envelope with metadata:

```typescript
interface ActorEnvelope<TMessage> {
  id: number; // Unique message ID
  ts: number; // Timestamp
  from: string; // Sender actor ID
  to: string; // Recipient actor ID
  msg: TMessage; // The actual message
}
```

## Usage

### Creating the System

```typescript
const actorMesh = new ActorSystem<DemoRuntime, DemoMessage>(
  () => runtime, // Runtime provider
  (entry) => {
    // Optional log callback
    console.log(entry.kind, entry.from, '→', entry.to, entry.msg);
  },
);
```

### Registering Actors

**Without state (simple handler):**

```typescript
actorMesh.register('vanilla', (self, envelope) => {
  const { msg } = envelope;

  if (msg.type === 'ping') {
    self.send(envelope.from, { type: 'pong', text: 'pong from vanilla' });
    return;
  }

  if (msg.type === 'inc') {
    self.runtime.intents.increase(msg.by);
    return;
  }
});
```

**With state:**

```typescript
actorMesh.register('vue', {
  initialState: { messageCount: 0 },
  handler: (self, envelope) => {
    self.state.messageCount++;

    if (envelope.msg.type === 'ping') {
      self.send(envelope.from, {
        type: 'pong',
        text: `pong #${self.state.messageCount}`,
      });
    }
  },
});
```

### Sending Messages

**Inside actor handler** (use `self.send` - `from` is implicit):

```typescript
actorMesh.register('vanilla', (self, envelope) => {
  // self.send(to, msg) - from is automatically self.id
  self.send(envelope.from, { type: 'pong', text: 'pong from vanilla' });
});
```

**Outside actor handler** (use `sendFrom` - `from` is explicit):

```typescript
// Point-to-point
actorMesh.sendFrom('vanilla', 'vue', { type: 'ping' });
//                  ↑         ↑       ↑
//                  from      to      msg

// Broadcast to all
actorMesh.broadcastFrom('system', { type: 'ping' });

// Broadcast excluding self
actorMesh.broadcastFrom('vanilla', { type: 'ping' }, { excludeSelf: true });
```

**Using ActorRef (bound from):**

```typescript
// Get a ref with bound 'from'
const vueRef = actorMesh.refFrom('system', 'vue');
if (vueRef) {
  vueRef.send({ type: 'ping' }); // from is bound to 'system'
}

// Useful for passing to external modules
function initModule(target: ActorRef<AppMessage>) {
  target.send({ type: 'init' }); // doesn't need to know 'from'
}
initModule(actorMesh.refFrom('system', 'vue')!);
```

### Passing ActorRef as Reply Address

```typescript
actorMesh.register('requester', (self, envelope) => {
  // Send request with self.ref as reply address
  self.send('worker', {
    type: 'compute',
    data: [1, 2, 3],
    replyTo: self.ref, // worker can use this to reply
  });
});

actorMesh.register('worker', (self, envelope) => {
  if (envelope.msg.type === 'compute') {
    const result = envelope.msg.data.reduce((a, b) => a + b, 0);
    // Reply using the provided ref
    envelope.msg.replyTo.send({ type: 'result', value: result });
  }
});
```

### Handler Context (ActorSelf)

Handlers receive an `ActorSelf`:

```typescript
interface ActorSelf<TRuntime, TMessage, TState = void> {
  readonly id: string; // This actor's ID
  readonly ref: ActorRef<TMessage>; // Self reference (for passing to others)
  readonly runtime: TRuntime; // Application runtime
  state: TState; // Persistent state (if registered with initialState)
  send: (to: string, msg: TMessage) => void; // Send to specific actor
  broadcast: (msg: TMessage, opts?) => void; // Send to all actors
}
```

## Message Processing

### Sequential Processing (Mailbox)

Each actor has a queue. Messages are processed one at a time:

```
Actor 'vue' mailbox:
┌─────────────────────────────────────────┐
│ [ping from vanilla] → [inc from react]  │ → Processing one by one
└─────────────────────────────────────────┘
```

This prevents race conditions within a single actor.

### Async Handlers

Handlers can be async. The next message waits for the current one to complete:

```typescript
actorMesh.register('vue', async (self, envelope) => {
  await someAsyncOperation();
  self.send(envelope.from, { type: 'pong', text: 'done' });
});
```

## Logging

The system logs all message activity:

```typescript
type ActorLogKind = 'send' | 'deliver' | 'error';

interface ActorLogEntry<TMessage> extends ActorEnvelope<TMessage> {
  kind: ActorLogKind;
  error?: string;
}
```

| Kind      | When                              |
| --------- | --------------------------------- |
| `send`    | Message enqueued                  |
| `deliver` | Handler completed successfully    |
| `error`   | Handler threw or target not found |

### Log Storage

```typescript
const actorLog$ = signal<ActorLogEntry<DemoMessage>[]>([]);

const actorMesh = new ActorSystem<DemoRuntime, DemoMessage>(
  () => runtime,
  (entry) => {
    const prev = actorLog$();
    const next = prev.length >= 200 ? prev.slice(-199) : prev;
    actorLog$([...next, entry]);
  },
);
```

## Demo Implementation

### Actor Handler Factory

```typescript
// examples/demo/src/app/runtime.ts
export function createActorHandler(actorId: DemoActorId) {
  return (self: ActorSelf<DemoRuntime, DemoMessage>, envelope: ActorEnvelope<DemoMessage>) => {
    const { graph, actorMesh, intents } = self.runtime;

    // Increment ping counter for this actor
    graph.set<number>(`ping/${actorId}`, (v) => v + 1);

    if (envelope.msg.type === 'ping') {
      if (actorMesh.has(envelope.from)) {
        self.send(envelope.from, { type: 'pong', text: `pong from ${actorId}` });
      }
      return;
    }

    if (envelope.msg.type === 'pong') {
      return;
    }

    if (envelope.msg.type === 'inc') {
      intents.increase(envelope.msg.by);
      return;
    }

    if (envelope.msg.type === 'setInput') {
      intents.setInput(envelope.msg.text);
      return;
    }

    if (envelope.msg.type === 'submit') {
      intents.submit();
    }
  };
}
```

### Registration in Views

```typescript
// In each framework's mount function
runtime.actorMesh.register('vanilla', createActorHandler('vanilla'));
runtime.actorMesh.register('vue', createActorHandler('vue'));
runtime.actorMesh.register('react', createActorHandler('react'));
runtime.actorMesh.register('solid', createActorHandler('solid'));
```

### System Behaviors

```typescript
// Broadcast ping when counter is multiple of 5
watch(
  () => graph.get<number>('counter'),
  (value, prev) => {
    if (prev !== undefined && value !== prev && value % 5 === 0) {
      runtime.actorMesh.broadcastFrom('system', { type: 'ping' }, { excludeSelf: true });
    }
  },
);
```

## Message Flow Example

```
User clicks "Ask Vue +3" in React panel
         │
         ▼
   React sends message (external call)
   actorMesh.sendFrom('react', 'vue', { type: 'inc', by: 3 })
         │
         ▼
   ┌─────────────────────────────────────┐
   │ ActorSystem                         │
   │  1. Create envelope (id, ts, etc.)  │
   │  2. Log 'send' event                │
   │  3. Enqueue to vue's mailbox        │
   │  4. Schedule drain                  │
   └─────────────────────────────────────┘
         │
         ▼
   Vue handler executes
   self.runtime.intents.increase(3)
         │
         ▼
   Log 'deliver' event
         │
         ▼
   Graph updates, all views re-render
```

## Benefits

1. **Isolation**: Frameworks don't share mutable state
2. **Explicit communication**: All cross-framework interactions are visible in logs
3. **Type safety**: Message union ensures exhaustive handling
4. **Debuggability**: Full message history available
5. **Testability**: Actors can be tested in isolation

## Comparison with Alternatives

| Approach           | Pros                    | Cons                               |
| ------------------ | ----------------------- | ---------------------------------- |
| **Shared signals** | Simple, direct          | Race conditions, implicit coupling |
| **Event bus**      | Decoupled               | No type safety, fire-and-forget    |
| **Actor model**    | Isolated, typed, logged | More boilerplate                   |

The Actor model is chosen for its explicit, traceable communication pattern.
