declare const Hooks: {
  once(hook: string, callback: () => void): void;
  on(hook: string, callback: () => void): void;
};

declare const game: {
  settings: {
    register(namespace: string, key: string, data: Record<string, unknown>): void;
    get(namespace: string, key: string): unknown;
  };
  user?: {
    id?: string;
    name?: string;
  };
};

declare const ChatMessage:
  | {
      create(data: { content: string }): Promise<unknown>;
    }
  | undefined;

interface Window {
  DiceWatcher?: {
    handleExternalRoll(payload: unknown): void;
    openLauncher(): void;
  };
}
