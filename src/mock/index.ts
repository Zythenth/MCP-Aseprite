// src/mock/index.ts
import { MockAsepriteEngine } from "./mockEngine.js";
import { MockClient, MockClientOptions } from "./mockClient.js";
import { logger } from "../logger.js";

export interface MockBridgeOptions extends MockClientOptions {
  initialWidth?: number;
  initialHeight?: number;
  hasActiveSprite?: boolean;
}

export interface MockBridgeInstance {
  engine: MockAsepriteEngine;
  client: MockClient;
  stop: () => Promise<void>;
  reset: (width?: number, height?: number) => void;
}

let activeInstance: MockBridgeInstance | null = null;

export async function startMockBridge(options: MockBridgeOptions = {}): Promise<MockBridgeInstance> {
  if (activeInstance) {
    logger.debug("[MockBridge] Stopping previous active instance before starting new one");
    await stopMockBridge();
  }

  const engine = new MockAsepriteEngine(options.initialWidth ?? 32, options.initialHeight ?? 32);
  if (options.hasActiveSprite === false) {
    engine.hasActiveSprite = false;
  }

  const client = new MockClient(engine, {
    host: options.host ?? "127.0.0.1",
    port: options.port ?? 32123,
    autoReconnect: options.autoReconnect ?? false,
    token: options.token,
  });

  await client.connect();

  const instance: MockBridgeInstance = {
    engine,
    client,
    stop: async () => {
      await client.disconnect();
      if (activeInstance === instance) {
        activeInstance = null;
      }
    },
    reset: (w = 32, h = 32) => {
      engine.reset(w, h);
    },
  };

  activeInstance = instance;
  return instance;
}

export async function stopMockBridge(): Promise<void> {
  if (activeInstance) {
    const inst = activeInstance;
    activeInstance = null;
    await inst.stop();
  }
}

export function getActiveMockBridge(): MockBridgeInstance | null {
  return activeInstance;
}

export { MockAsepriteEngine, MockClient };
