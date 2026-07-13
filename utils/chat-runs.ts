import { apiFetch, apiJSON, parseAPIError } from "@/utils/api-client";

export interface ChatRunUsage {
  cost_microusd?: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  reasoning_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  duration_ms: number;
  first_token_ms?: number;
}

export interface ChatRunBilling {
  cost_microusd?: string;
  charged_microusd?: string;
  unbilled_microusd?: string;
  balance_microusd?: string;
  reserved_microusd?: string;
  available_balance_microusd?: string;
}

export interface ChatRun {
  id: string;
  user_id: string;
  character_id: string;
  character_name: string;
  node_id: string;
  parent_node_id: string;
  user_message: string;
  model_id: string;
  model_name: string;
  provider: string;
  request_id: string;
  billing_reservation_id?: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  response_text: string;
  provider_response_id?: string;
  finish_reason?: string;
  usage: ChatRunUsage;
  billing: ChatRunBilling;
  error_code?: string;
  error_message?: string;
  cancel_requested: boolean;
  acknowledged: boolean;
  revision: number;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  acknowledged_at?: string;
  updated_at: string;
}

export interface CreateChatRunOptions {
  characterId: string;
  characterName: string;
  nodeId: string;
  parentNodeId: string;
  userMessage: string;
  modelName: string;
  modelId: string;
  systemMessage: string;
  userPrompt: string;
  maxTokens: number;
  temperature?: number;
  stableSystemPrefix?: string;
}

export async function createChatRun(options: CreateChatRunOptions): Promise<ChatRun> {
  const response = await apiFetch("/api/v1/chat/runs", {
    method: "POST",
    body: JSON.stringify({
      character_id: options.characterId,
      character_name: options.characterName,
      node_id: options.nodeId,
      parent_node_id: options.parentNodeId,
      user_message: options.userMessage,
      model_name: options.modelName,
      model_id: options.modelId,
      system: options.systemMessage,
      stable_system_prefix: options.stableSystemPrefix,
      input: options.userPrompt,
      max_output_tokens: options.maxTokens,
      temperature: options.temperature,
    }),
  });
  if (!response.ok) {
    throw await parseAPIError(response);
  }
  const payload = await response.json() as { run: ChatRun };
  if (!payload.run?.id) {
    throw new Error("The server did not return a chat run.");
  }
  return payload.run;
}

export async function getPendingChatRuns(characterId: string): Promise<ChatRun[]> {
  const payload = await apiJSON<{ items: ChatRun[] }>(
    `/api/v1/chat/runs?character_id=${encodeURIComponent(characterId)}`,
  );
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function getChatRun(runID: string): Promise<ChatRun> {
  const payload = await apiJSON<{ run: ChatRun }>(`/api/v1/chat/runs/${encodeURIComponent(runID)}`);
  return payload.run;
}

export async function cancelChatRun(runID: string): Promise<ChatRun> {
  const payload = await apiJSON<{ run: ChatRun }>(
    `/api/v1/chat/runs/${encodeURIComponent(runID)}/cancel`,
    { method: "POST", body: "{}" },
  );
  return payload.run;
}

export async function acknowledgeChatRun(runID: string): Promise<void> {
  await apiJSON(`/api/v1/chat/runs/${encodeURIComponent(runID)}/ack`, {
    method: "POST",
    body: "{}",
  });
}

function abortError(): Error {
  const error = new Error("Generation stopped.");
  error.name = "AbortError";
  return error;
}

async function readRunEvents(
  runID: string,
  onSnapshot: (run: ChatRun) => void,
  signal?: AbortSignal,
): Promise<ChatRun | null> {
  const response = await apiFetch(`/api/v1/chat/runs/${encodeURIComponent(runID)}/events`, { signal });
  if (!response.ok) {
    throw await parseAPIError(response);
  }
  if (!response.body) {
    throw new Error("Unable to read the generation status stream.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let latest: ChatRun | null = null;
  const parseFrame = (frame: string) => {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as { type?: string; run?: ChatRun; message?: string };
    if (event.type === "error") {
      throw new Error(event.message || "The generation status stream failed.");
    }
    if (event.type === "snapshot" && event.run) {
      latest = event.run;
      onSnapshot(event.run);
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";
    frames.forEach(parseFrame);
    if (done) break;
  }
  if (buffer.trim()) parseFrame(buffer);
  return latest;
}

export async function* streamChatRun(
  runID: string,
  options: { signal?: AbortSignal; onSnapshot?: (run: ChatRun) => void } = {},
): AsyncGenerator<ChatRun, void, unknown> {
  let latest: ChatRun | null = null;
  while (true) {
    if (options.signal?.aborted) throw abortError();
    try {
      const terminal = await readRunEvents(runID, (run) => {
        latest = run;
        options.onSnapshot?.(run);
      }, options.signal);
      if (terminal) latest = terminal;
      if (latest) yield latest;
      if (latest && ["completed", "failed", "canceled"].includes(latest.status)) return;
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      // A browser or proxy can drop an SSE connection without affecting the
      // persisted worker. Reconnect from the latest database snapshot.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const current = await getChatRun(runID);
      latest = current;
      yield current;
      if (["completed", "failed", "canceled"].includes(current.status)) return;
    }
  }
}
