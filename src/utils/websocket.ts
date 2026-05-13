const textDecoder = new TextDecoder();

export async function readWebSocketMessageText(data: unknown): Promise<string | null> {
  if (typeof data === 'string') {
    return data;
  }

  if (data instanceof Blob) {
    return await data.text();
  }

  if (data instanceof ArrayBuffer) {
    return textDecoder.decode(data);
  }

  if (ArrayBuffer.isView(data)) {
    return textDecoder.decode(data);
  }

  if (data == null) {
    return null;
  }

  return String(data);
}

export async function parseWebSocketJsonMessage<T>(data: unknown): Promise<T | null> {
  const rawText = await readWebSocketMessageText(data);
  if (!rawText) {
    return null;
  }

  return JSON.parse(rawText) as T;
}
