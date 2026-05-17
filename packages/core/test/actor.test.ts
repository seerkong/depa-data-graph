import { describe, expect, it } from 'vitest';

import { ActorSystem } from '../src/actor';

type TestRuntime = { name: string };
type TestMessage = { type: 'ping' } | { type: 'pong'; count: number } | { type: 'inc' };

describe('ActorSystem', () => {
  const createRuntime = (): TestRuntime => ({ name: 'test' });

  describe('register without state', () => {
    it('should register and handle messages', async () => {
      const system = new ActorSystem<TestRuntime, TestMessage>(createRuntime);
      const received: TestMessage[] = [];

      system.register('a', (self, envelope) => {
        received.push(envelope.msg);
        if (envelope.msg.type === 'ping') {
          self.send(envelope.from, { type: 'pong', count: 1 });
        }
      });

      system.register('b', (self, envelope) => {
        received.push(envelope.msg);
      });

      system.sendFrom('b', 'a', { type: 'ping' });

      await new Promise((r) => setTimeout(r, 10));

      expect(received).toHaveLength(2);
      expect(received[0]).toEqual({ type: 'ping' });
      expect(received[1]).toEqual({ type: 'pong', count: 1 });
    });
  });

  describe('register with state', () => {
    it('should persist state across messages', async () => {
      const system = new ActorSystem<TestRuntime, TestMessage>(createRuntime);
      const counts: number[] = [];

      system.register('counter', {
        initialState: { count: 0 },
        handler: (self, envelope) => {
          if (envelope.msg.type === 'inc') {
            self.state.count++;
            counts.push(self.state.count);
          }
        },
      });

      system.sendFrom('system', 'counter', { type: 'inc' });
      system.sendFrom('system', 'counter', { type: 'inc' });
      system.sendFrom('system', 'counter', { type: 'inc' });

      await new Promise((r) => setTimeout(r, 10));

      expect(counts).toEqual([1, 2, 3]);
    });

    it('should maintain separate state per actor', async () => {
      const system = new ActorSystem<TestRuntime, TestMessage>(createRuntime);
      const results: { id: string; count: number }[] = [];

      system.register('a', {
        initialState: { count: 10 },
        handler: (self, envelope) => {
          if (envelope.msg.type === 'inc') {
            self.state.count++;
            results.push({ id: self.id, count: self.state.count });
          }
        },
      });

      system.register('b', {
        initialState: { count: 100 },
        handler: (self, envelope) => {
          if (envelope.msg.type === 'inc') {
            self.state.count++;
            results.push({ id: self.id, count: self.state.count });
          }
        },
      });

      system.sendFrom('system', 'a', { type: 'inc' });
      system.sendFrom('system', 'b', { type: 'inc' });
      system.sendFrom('system', 'a', { type: 'inc' });

      await new Promise((r) => setTimeout(r, 10));

      expect(results).toEqual([
        { id: 'a', count: 11 },
        { id: 'b', count: 101 },
        { id: 'a', count: 12 },
      ]);
    });
  });

  describe('refFrom', () => {
    it('should return undefined for non-existent actor', () => {
      const system = new ActorSystem<TestRuntime, TestMessage>(createRuntime);
      const ref = system.refFrom('system', 'nonexistent');
      expect(ref).toBeUndefined();
    });

    it('should return ActorRef with bound from', async () => {
      const system = new ActorSystem<TestRuntime, TestMessage>(createRuntime);
      const received: { from: string; msg: TestMessage }[] = [];

      system.register('target', (self, envelope) => {
        received.push({ from: envelope.from, msg: envelope.msg });
      });

      const ref = system.refFrom('sender', 'target');
      expect(ref).toBeDefined();
      expect(ref!.id).toBe('target');

      ref!.send({ type: 'ping' });

      await new Promise((r) => setTimeout(r, 10));

      expect(received).toHaveLength(1);
      expect(received[0].from).toBe('sender');
      expect(received[0].msg).toEqual({ type: 'ping' });
    });
  });

  describe('self.ref', () => {
    it('should allow passing self.ref as reply address', async () => {
      const system = new ActorSystem<TestRuntime, TestMessage>(createRuntime);
      const replies: TestMessage[] = [];

      system.register('requester', {
        initialState: { replyCount: 0 },
        handler: (self, envelope) => {
          if (envelope.msg.type === 'pong') {
            self.state.replyCount++;
            replies.push(envelope.msg);
          }
        },
      });

      system.register('responder', (self, envelope) => {
        if (envelope.msg.type === 'ping') {
          self.send(envelope.from, { type: 'pong', count: 42 });
        }
      });

      system.sendFrom('requester', 'responder', { type: 'ping' });

      await new Promise((r) => setTimeout(r, 10));

      expect(replies).toHaveLength(1);
      expect(replies[0]).toEqual({ type: 'pong', count: 42 });
    });
  });

  describe('broadcast', () => {
    it('should broadcast to all actors', async () => {
      const system = new ActorSystem<TestRuntime, TestMessage>(createRuntime);
      const received: { id: string; msg: TestMessage }[] = [];

      system.register('a', (self, envelope) => {
        received.push({ id: self.id, msg: envelope.msg });
      });

      system.register('b', (self, envelope) => {
        received.push({ id: self.id, msg: envelope.msg });
      });

      system.register('c', (self, envelope) => {
        received.push({ id: self.id, msg: envelope.msg });
      });

      system.broadcastFrom('system', { type: 'ping' });

      await new Promise((r) => setTimeout(r, 10));

      expect(received).toHaveLength(3);
      expect(received.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('should exclude self when broadcasting with excludeSelf', async () => {
      const system = new ActorSystem<TestRuntime, TestMessage>(createRuntime);
      const received: string[] = [];

      system.register('a', (self, envelope) => {
        received.push(self.id);
        if (envelope.msg.type === 'ping' && envelope.from === 'system') {
          self.broadcast({ type: 'pong', count: 1 }, { excludeSelf: true });
        }
      });

      system.register('b', (self, envelope) => {
        received.push(self.id);
      });

      system.sendFrom('system', 'a', { type: 'ping' });

      await new Promise((r) => setTimeout(r, 10));

      expect(received).toEqual(['a', 'b']);
    });
  });
});
