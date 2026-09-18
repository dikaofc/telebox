const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHAT = process.env.TELEGRAM_STORAGE_CHAT_ID ?? "";
const API = `https://api.telegram.org/bot${TOKEN}`;

if (!TOKEN || !CHAT) {
  console.warn("telegram env not set: TELEGRAM_BOT_TOKEN / TELEGRAM_STORAGE_CHAT_ID");
}

// Network timeouts: a Telegram call without a deadline can hang a serverless
// function until the platform kills it, burning invocation time on every
// affected request. Values are generous enough for slow links.
const RPC_TIMEOUT_MS = 60_000; // sendDocument of a full-size part
const RPC_TIMEOUT_MS_SMALL = 15_000; // getFile / deleteMessage

type SentFile = { chatId: number; messageId: number; fileId: string };

type TgResponse = {
  ok?: boolean;
  result?: {
    chat?: { id?: number };
    message_id?: number;
    document?: { file_id?: string };
    video?: { file_id?: string };
    audio?: { file_id?: string };
    photo?: { file_id?: string }[];
  };
  description?: string;
};

export async function sendDocument(file: Blob, filename: string): Promise<SentFile> {
  const form = new FormData();
  form.set("chat_id", CHAT);
  form.set("document", file, filename);
  const res = await fetch(`${API}/sendDocument`, { method: "POST", body: form, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`telegram sendDocument ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json().catch(() => null)) as TgResponse | null;
  const msg = json?.result;
  const doc = msg?.document ?? msg?.video ?? msg?.audio;
  const fileId = doc?.file_id ?? msg?.photo?.at(-1)?.file_id;
  const chatId = msg?.chat?.id;
  const messageId = msg?.message_id;
  if (!json || typeof chatId !== "number" || typeof messageId !== "number" || !fileId) {
    throw new Error("telegram response has no usable file reference");
  }
  return { chatId, messageId, fileId };
}

export async function getFilePath(fileId: string): Promise<string> {
  const res = await fetch(`${API}/getFile?file_id=${encodeURIComponent(fileId)}`, {
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS_SMALL),
  });
  if (!res.ok) throw new Error(`telegram getFile ${res.status}`);
  const json = (await res.json().catch(() => null)) as TgResponse | null;
  const path = json?.result && typeof (json.result as { file_path?: unknown }).file_path === "string"
    ? (json.result as { file_path: string }).file_path
    : null;
  if (!json?.ok || !path) throw new Error(`telegram getFile: ${json?.description ?? "no file_path"}`);
  return path;
}

export function botFileUrl(filePath: string): string {
  return `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
}

/**
 * Best-effort: remove the source message so the blob is gone from the
 * channel. Never throws — deletion failures are logged, not fatal (purge
 * retries later).
 */
export async function deleteMessage(chatId: string, messageId: number): Promise<void> {
  try {
    const res = await fetch(
      `${API}/deleteMessage?chat_id=${encodeURIComponent(chatId)}&message_id=${messageId}`,
      { signal: AbortSignal.timeout(RPC_TIMEOUT_MS_SMALL) }
    );
    if (!res.ok) {
      const text = await res.text();
      // 400 with "message to delete not found" = already gone — that's fine.
      if (!text.includes("message to delete not found")) {
        console.warn(`telegram deleteMessage ${res.status}: ${text.slice(0, 300)}`);
      }
    }
  } catch (e) {
    console.warn("telegram deleteMessage failed", e);
  }
}
