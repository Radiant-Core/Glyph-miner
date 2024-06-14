import { messages } from "./signals";
import { Message } from "./types";

export function createMessage(m: Partial<Message>) {
  const d = new Date();
  return {
    ...m,
    id: crypto.randomUUID() as string,
    date: d.toLocaleTimeString(),
  } as Message;
}

export function addMessage(m: Partial<Message>) {
  messages.value = [createMessage(m)].concat(
    messages.value.slice(0, 99)
  ) as Message[];
}
