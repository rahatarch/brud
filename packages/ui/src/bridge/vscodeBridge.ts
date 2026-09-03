import type { WebviewMessage, ExtensionMessage } from '@brud/protocol';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscodeApi = acquireVsCodeApi();

export function sendToExtension(message: WebviewMessage): void {
  vscodeApi.postMessage(message);
}

export function onExtensionMessage(
  callback: (message: ExtensionMessage) => void
): () => void {
  const handler = (event: MessageEvent) => {
    const data = event.data as ExtensionMessage;
    if (data && data.command) {
      callback(data);
    }
  };

  window.addEventListener('message', handler);
  return () => {
    window.removeEventListener('message', handler);
  };
}