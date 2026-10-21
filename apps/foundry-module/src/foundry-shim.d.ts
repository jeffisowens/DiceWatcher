// A slim shim for the Foundry v14 APIs DiceWatcher uses. The community
// foundry-vtt-types package pulls GitHub tarball deps that fail to install.

declare const Hooks: {
  once(hook: string, callback: (...args: never[]) => void): void;
  on(hook: string, callback: (...args: never[]) => void): void;
};

declare const game: {
  settings: {
    register(
      namespace: string,
      key: string,
      data: Record<string, unknown>
    ): void;
    get(namespace: string, key: string): unknown;
  };
  user?: {
    id?: string;
    name?: string;
  };
};

declare const ui: {
  notifications?: {
    info(message: string): void;
    warn(message: string): void;
  };
};

declare const CONFIG: {
  Dice: {
    fulfillment: {
      methods: Record<
        string,
        {
          label: string;
          icon?: string;
          interactive?: boolean;
        }
      >;
    };
  };
};
