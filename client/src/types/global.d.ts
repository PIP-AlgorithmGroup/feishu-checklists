declare module '*.css';

// Type declarations for importing static assets
declare module '*.png' {
  const value: string;
  export default value;
}

declare module '*.jpg' {
  const value: string;
  export default value;
}

declare module '*.jpeg' {
  const value: string;
  export default value;
}

declare module '*.gif' {
  const value: string;
  export default value;
}

declare module '*.webp' {
  const value: string;
  export default value;
}

declare module '*.ico' {
  const value: string;
  export default value;
}

declare module '*.json' {
  const value: any;
  export default value;
}

declare module '*.md' {
  const value: string;
  export default value;
}

declare module '*.csv' {
  const value: string;
  export default value;
}

declare namespace React {
  export interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}

interface FeishuH5Sdk {
  config(options: Record<string, unknown> & {
    onSuccess(): void;
    onFail(error: unknown): void;
  }): void;
}

interface FeishuTt {
  getChatInfo(options: {
    openChatId: string;
    chatType: 0;
    userType: 0;
    success(result: { name?: string; i18nNames?: { zh_cn?: string; en_us?: string } }): void;
    fail(error: unknown): void;
  }): void;
  sendMessageCard(options: {
    triggerCode: string;
    cardContent: unknown;
    success(result: unknown): void;
    fail(error: unknown): void;
  }): void;
}

interface Window {
  h5sdk?: FeishuH5Sdk;
  tt?: FeishuTt;
}
