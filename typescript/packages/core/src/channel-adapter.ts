export interface NormalizedMessage {
  channel: string;
  peer: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelAdapter {
  readonly id: string;
  start(onMessage: (message: NormalizedMessage) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  send(peer: string, text: string): Promise<void>;
}

export class InMemoryChannelAdapter implements ChannelAdapter {
  readonly id: string;
  private handler: ((message: NormalizedMessage) => Promise<void>) | null = null;

  constructor(id: string) {
    this.id = id;
  }

  async start(onMessage: (message: NormalizedMessage) => Promise<void>): Promise<void> {
    this.handler = onMessage;
  }

  async stop(): Promise<void> {
    this.handler = null;
  }

  async send(peer: string, text: string): Promise<void> {
    void peer;
    void text;
  }

  async inject(peer: string, text: string): Promise<void> {
    if (!this.handler) {
      throw new Error(`Channel ${this.id} is not started`);
    }
    await this.handler({ channel: this.id, peer, text });
  }
}
