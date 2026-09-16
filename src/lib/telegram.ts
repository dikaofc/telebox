const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHAT = process.env.TELEGRAM_STORAGE_CHAT_ID ?? "";
const API = `https://api.telegram.org/bot${TOKEN}`;

if (!TOKEN || !CHAT) {
  console.warn("telegram env not set: TELEGRAM_BOT_TOKEN / TELEGRAM_STORAGE_CHAT_ID");
}

type SentFile = { chatId: number; messageId: number; fileId: string };

export async function sendDocument(file: Blob, filename: string): Promise<SentFile> {
  const form = new FormData();
  form.set("chat_id", CHAT);
  form.set("document", file, filename);
  const res = await fetch(`${API}/sendDocument`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`telegram sendDocument ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const msg = json.result;
  const doc = msg.document ?? msg.video ?? msg.audio;
  const fileId = doc?.file_id ?? msg.photo?.at(-1)?.file_id;
  if (!fileId) throw new Error("telegram response has no file_id");
  return { chatId: msg.chat.id, messageId: msg.message_id, fileId };
}

export async function getFilePath(fileId: string): Promise<string> {
  const res = await fetch(`${API}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const json = await res.json();
  if (!json.ok) throw new Error(`telegram getFile: ${json.description}`);
  return json.result.file_path as string;
}

export function botFileUrl(filePath: string): string {
  return `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
}
