/** Same-origin channels for tests: every instance with the same name hears the others (not itself), asynchronously like the real one. */
export class FakeBroadcastChannel {
  static open = new Set<FakeBroadcastChannel>();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(public name: string) { FakeBroadcastChannel.open.add(this); }
  postMessage(data: unknown) {
    const copy = structuredClone(data);
    for (const other of FakeBroadcastChannel.open) {
      if (other !== this && other.name === this.name && !other.closed) queueMicrotask(() => { if (!other.closed) other.onmessage?.({ data: copy }); });
    }
  }
  close() { this.closed = true; FakeBroadcastChannel.open.delete(this); }
  static reset() { FakeBroadcastChannel.open.clear(); }
}
