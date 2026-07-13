# File 3: src/client.ts — Line by Line

This is the CLI client — the most complex file. It ties everything together:
- Spawns the MCP server (`index.ts`) as a child process
- Connects to Claude or GPT
- Runs an interactive REPL in the terminal
- Handles the voice loop (mic → STT → LLM → TTS → speakers)
- Routes the AI's tool calls to the MCP server and returns results

Read Files 1 and 2 first. This file uses concepts from both.

---

## Line 1 — Shebang

```typescript
#!/usr/bin/env node
```

Same as in `index.ts` — tells the OS to use Node.js when run directly.

---

## Line 2 — Load .env

```typescript
import "dotenv/config";
```

Loads `.env` into `process.env`. This file needs `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) and `ELEVENLABS_API_KEY`. Must be first.

---

## Lines 4–17 — JSDoc comment block

```typescript
/**
 * Standalone MCP Client — connects to the ElevenLabs MCP server and routes
 * tool calls through either Anthropic (Claude) or OpenAI (GPT).
 * ...
 */
```

Documentation comment describing the file's purpose and usage. Not executable.

---

## Lines 19–28 — Imports

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import * as readline from "node:readline";
import { spawn, execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { unlinkSync, existsSync } from "node:fs";
```

- `Client` — the MCP client class. Connects to the server, calls tools, lists prompts.
- `StdioClientTransport` — tells the MCP client to communicate with the server via spawned child process (stdin/stdout).
- `Anthropic` — Anthropic's official SDK. Used to call Claude.
- `OpenAI` — OpenAI's SDK. Used to call GPT. Both are imported; which one is used depends on `LLM_PROVIDER`.
- `readline` — Node.js built-in for reading line-by-line from the terminal. Powers the `You:` prompt.
- `spawn` — starts a child process (used for `sox rec` recording and `afplay` playback).
- `execSync` — synchronously runs a shell command (used to check if `sox` is installed).
- `tmpdir` — returns the OS temp directory path (e.g. `/tmp` on Mac/Linux). WAV recordings are saved here.
- `join` — path utility. Combines directory + filename.
- `fileURLToPath` — converts a file URL (`file:///Users/you/path`) to a filesystem path (`/Users/you/path`). Required because `import.meta.url` returns a URL, and directory names with spaces get percent-encoded (`%20`) in URLs.
- `unlinkSync`, `existsSync` — delete a file / check if a file exists. Used to clean up temp WAV files.

---

## Lines 32–39 — Config constants

```typescript
const LLM_PROVIDER = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
const SERVER_PATH = fileURLToPath(new URL("../build/index.js", import.meta.url));

const DEFAULT_SYSTEM =
  "You are a helpful assistant with access to ElevenLabs text-to-speech and speech-to-text tools...";

const VOICE_SYSTEM =
  "You are a voice AI assistant. IMPORTANT: After composing your reply, you MUST call text_to_speech to speak it aloud...";
```

- `LLM_PROVIDER` — reads from env, defaults to "anthropic", lowercased for safe comparison.
- `SERVER_PATH` — builds the absolute path to the compiled server.
  - `import.meta.url` — the URL of THIS file (e.g. `file:///Users/you/Maksa%20assignment/build/client.js`).
  - `new URL("../build/index.js", import.meta.url)` — resolves `../build/index.js` relative to this file's URL. Result: `file:///Users/you/Maksa%20assignment/build/index.js`.
  - `fileURLToPath(...)` — converts that URL to `/Users/you/Maksa assignment/build/index.js`. The `%20` is decoded to a space.
- `DEFAULT_SYSTEM` — the system message for normal text chat. Tells Claude it has voice tools.
- `VOICE_SYSTEM` — the system message for voice mode. Forces Claude to ALWAYS call `text_to_speech`. This replaces `DEFAULT_SYSTEM` when `/voice` is active.

---

## Lines 43–55 — createMcpClient()

```typescript
async function createMcpClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_PATH],
    env: {
      ...(process.env as Record<string, string>),
      ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || "",
    },
  });
  const mcpClient = new Client({ name: "elevenlabs-cli-client", version: "2.0.0" });
  await mcpClient.connect(transport);
  return mcpClient;
}
```

Spawns the MCP server and connects to it.

- `StdioClientTransport({ command: "node", args: [SERVER_PATH] })` — tells the SDK to run `node /path/to/build/index.js` as a child process. The client and server communicate by piping JSON through stdin/stdout.
- `env: { ...process.env, ELEVENLABS_API_KEY: ... }` — forwards ALL environment variables to the child process (including API keys, `ELEVENLABS_OUTPUT_DIR`, etc.) The explicit `ELEVENLABS_API_KEY` ensures it's always set even if somehow missing.
- `new Client(...)` — creates the MCP client with an identity.
- `await mcpClient.connect(transport)` — performs the MCP handshake: spawns the process, exchanges capability declarations, confirms both sides are ready.
- Returns the connected client for use throughout the session.

---

## Lines 59–63 — McpTool interface

```typescript
interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}
```

A local TypeScript interface for how we store tool information. `description?` is optional. This is simpler than the full MCP SDK type, keeping things easy to work with.

---

## Lines 65–68 — getMcpTools()

```typescript
async function getMcpTools(mcpClient: Client): Promise<McpTool[]> {
  const { tools } = await mcpClient.listTools();
  return tools as McpTool[];
}
```

Asks the MCP server for its list of registered tools. The server returns all 7 tools we registered in `index.ts`. We cast the result to `McpTool[]` for use in the rest of the client.

---

## Lines 70–87 — Tool format converters

```typescript
function toAnthropicTools(tools: McpTool[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description || "",
    input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
  }));
}

function toOpenAITools(tools: McpTool[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.inputSchema as OpenAI.FunctionParameters,
    },
  }));
}
```

Anthropic and OpenAI have different formats for tool definitions:
- Anthropic calls it `input_schema`
- OpenAI calls it `parameters` and wraps it in a `function` object with `type: "function"`

These two functions translate the same MCP tool list into whichever format is needed. The MCP server is LLM-agnostic — it doesn't care which AI uses it.

---

## Lines 89–99 — callTool()

```typescript
async function callTool(
  mcpClient: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await mcpClient.callTool({ name, arguments: args });
  return (result.content as { type: string; text: string }[])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}
```

The bridge between LLM tool requests and the MCP server.

- `mcpClient.callTool({ name, arguments: args })` — sends a JSON-RPC message to the MCP server asking it to run the named tool with these arguments. The server executes the handler from `index.ts` and returns the result.
- `.filter((c) => c.type === "text")` — MCP tool results can contain multiple content blocks. We only care about text blocks.
- `.map((c) => c.text).join("\n")` — combine all text content into a single string.
- This string is what the LLM sees as the tool result. For `text_to_speech`, it's `"Audio saved to: /path/file.mp3 (12345 bytes, ...)"`.

---

## Lines 103–169 — chatAnthropic() — the Anthropic tool-use loop

```typescript
async function chatAnthropic(
  mcpClient: Client,
  tools: McpTool[],
  userMessage: string,
  history: Anthropic.MessageParam[],
  systemOverride?: string,
): Promise<string> {
  const anthropic = new Anthropic();
  const anthropicTools = toAnthropicTools(tools);
  const system = systemOverride ?? DEFAULT_SYSTEM;

  history.push({ role: "user", content: userMessage });

  let response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system,
    tools: anthropicTools,
    messages: history,
  });

  const collectedMp3Paths: string[] = [];

  while (response.stop_reason === "tool_use") {
    // Claude wants to use a tool
    const assistantContent = response.content;
    history.push({ role: "assistant", content: assistantContent });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of assistantContent) {
      if (block.type === "tool_use") {
        console.log(`  [tool: ${block.name}]`);
        const result = await callTool(mcpClient, block.name, block.input as Record<string, unknown>);
        const mp3 = extractMp3Path(result);
        if (mp3) collectedMp3Paths.push(mp3);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
    }

    history.push({ role: "user", content: toolResults });

    // Call Claude again with the tool results
    response = await anthropic.messages.create({ ... messages: history });
  }

  const finalText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  history.push({ role: "assistant", content: response.content });

  const mp3Suffix =
    collectedMp3Paths.length > 0
      ? `\nAudio saved to: ${collectedMp3Paths[collectedMp3Paths.length - 1]}`
      : "";
  return finalText + mp3Suffix;
}
```

This is the core agentic loop. It keeps calling Claude until Claude stops requesting tools.

- `systemOverride?: string` — if provided (voice mode), this replaces `DEFAULT_SYSTEM`. This is how `/voice` forces Claude to always speak.
- `history.push({ role: "user", content: userMessage })` — adds the user's message to the running history before calling the API.
- `anthropic.messages.create(...)` — calls the Claude API. We pass the entire history every time (Claude is stateless — it doesn't remember previous turns on its own).
- `while (response.stop_reason === "tool_use")` — loop condition. When Claude wants to use a tool, `stop_reason` is `"tool_use"`. When it's done with tools and giving a final answer, `stop_reason` is `"end_turn"`.
- `assistantContent = response.content` — Claude's response content may be an array of blocks: text blocks and/or tool_use blocks.
- `history.push({ role: "assistant", content: assistantContent })` — saves Claude's tool request to history.
- `for (const block of assistantContent)` — iterate over all blocks. If a block is a tool call, execute it.
- `console.log(\`  [tool: ${block.name}]\`)` — shows the user which tool is being called (the `[tool: text_to_speech]` lines you see in the terminal).
- `const result = await callTool(...)` — actually executes the tool via MCP. This is where the ElevenLabs API is called.
- `const mp3 = extractMp3Path(result)` — checks if the tool result contains an MP3 file path. `text_to_speech` always does.
- `if (mp3) collectedMp3Paths.push(mp3)` — saves any MP3 paths found during tool execution.
- `toolResults.push(...)` — builds the list of tool results to send back to Claude.
- `history.push({ role: "user", content: toolResults })` — sends the results back. In Anthropic's API, tool results are sent as "user" role messages.
- Second `anthropic.messages.create(...)` call — Claude now sees the tool results and decides: call another tool, or give a final answer.
- `filter((b): b is Anthropic.TextBlock => b.type === "text")` — TypeScript type guard. Filters to only text blocks and narrows the type.
- `mp3Suffix` — the MP3 path extracted from tool results is appended to the final text. This is needed because `extractMp3Path` is called on this returned string by the caller, and Claude doesn't reliably repeat the path in its text response.

---

## Lines 173–220 — chatOpenAI() — the OpenAI tool-use loop

Same logic as `chatAnthropic` but using OpenAI's API format:
- OpenAI calls them `tool_calls` (not `tool_use`)
- Tool results are sent as role `"tool"` messages (not `"user"`)
- Tool args come as a JSON string: `JSON.parse(toolCall.function.arguments)` — must parse manually
- The check is `message.tool_calls && message.tool_calls.length > 0` (not `stop_reason === "tool_use"`)
- Same `collectedMp3Paths` and `mp3Suffix` pattern added for consistency

---

## Lines 224–252 — playAudio()

```typescript
function playAudio(filePath: string): Promise<void> {
  return new Promise((resolve) => {
    let cmd: string;
    let args: string[];

    if (process.platform === "darwin") {
      cmd = "afplay";
      args = [filePath];
    } else if (process.platform === "linux") {
      cmd = "mpg123";
      args = ["-q", filePath];
    } else {
      console.log(`  [Audio saved: ${filePath} — open manually on Windows]`);
      resolve();
      return;
    }

    console.log(`  [Playing audio: ${filePath}]`);
    const player = spawn(cmd, args, { stdio: "pipe" });
    player.on("close", (code) => {
      if (code !== 0) console.warn(`  [afplay exited with code ${code} ...]`);
      resolve();
    });
    player.on("error", (err) => {
      console.warn(`  [Could not auto-play (${err.message}) ...]`);
      resolve();
    });
  });
}
```

Plays an MP3 file using the system's audio player.

- Returns a `Promise<void>` — the caller can `await` it to wait for playback to finish before continuing.
- `new Promise((resolve) => { ... })` — manual promise construction. We resolve it when playback ends.
- `process.platform === "darwin"` — macOS. Uses `afplay` (built into macOS, no install needed).
- `process.platform === "linux"` — Linux. Uses `mpg123`. The `-q` flag suppresses output.
- Windows — no auto-play. Logs the file path so the user can open it manually.
- `spawn(cmd, args, { stdio: "pipe" })` — starts the player as a child process. Arguments passed as an array, so spaces in file paths are handled correctly (no shell escaping needed).
- `player.on("close", (code) => ...)` — fires when the player exits. `code` is the exit code (0 = success).
- `player.on("error", ...)` — fires if the command can't be started (e.g. `afplay` not found).
- Both `on("close")` and `on("error")` call `resolve()` — we always resolve, never reject. Playback failure is not fatal.

---

## Lines 254–260 — isSoxInstalled()

```typescript
function isSoxInstalled(): boolean {
  try {
    execSync("which rec", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
```

Checks if `sox` (the audio recording tool) is installed.

- `execSync("which rec", ...)` — runs synchronously. `which rec` returns the path to `rec` if installed, throws if not found.
- `{ stdio: "ignore" }` — suppresses the output from `which`.
- If it throws, `catch` returns `false`. If it succeeds, `return true`.

---

## Lines 263–270 — startRecording()

```typescript
function startRecording(filePath: string): ReturnType<typeof spawn> {
  return spawn(
    "rec",
    ["-r", "16000", "-c", "1", "-b", "16", "-e", "signed-integer", filePath],
    { stdio: "ignore" },
  );
}
```

Starts recording microphone audio to a WAV file.

- `rec` — the sox recording command.
- `-r 16000` — sample rate: 16,000 Hz. ElevenLabs STT works well at this rate.
- `-c 1` — mono (1 channel). Stereo isn't needed for speech.
- `-b 16` — 16 bits per sample. Standard for speech.
- `-e signed-integer` — encoding format. Matches 16-bit WAV.
- `filePath` — the output file. Sox writes the WAV here.
- Returns the spawned process so the caller can call `.kill("SIGTERM")` to stop recording.
- `{ stdio: "ignore" }` — sox prints volume meters to the terminal; we suppress this.

---

## Lines 273–276 — extractMp3Path()

```typescript
function extractMp3Path(text: string): string | null {
  const m = text.match(/Audio saved to:\s*(.+?\.mp3)/);
  return m ? m[1].trim() : null;
}
```

Parses the file path from a `text_to_speech` tool result.

- The tool returns: `"Audio saved to: /Users/you/output/output_123.mp3 (12345 bytes, ...)"`
- The regex `/Audio saved to:\s*(.+?\.mp3)/` matches that pattern:
  - `Audio saved to:` — literal match
  - `\s*` — any whitespace
  - `(.+?\.mp3)` — capture group: one or more characters (non-greedy `?`), ending in `.mp3`
- `m[1]` — the first capture group (the path)
- `.trim()` — remove any leading/trailing whitespace
- Returns `null` if no match (tool wasn't `text_to_speech`, or result was an error)

---

## Lines 280–299 — listPromptsCmd()

```typescript
async function listPromptsCmd(mcpClient: Client): Promise<void> {
  const { prompts } = await mcpClient.listPrompts();
  if (prompts.length === 0) { console.log("No prompts available.\n"); return; }
  console.log("\nAvailable prompts:");
  for (const p of prompts) {
    console.log(`  ${p.name}${p.description ? ` — ${p.description}` : ""}`);
    if (p.arguments && p.arguments.length > 0) {
      const argList = p.arguments
        .map((a) => (a.required ? a.name : `[${a.name}]`))
        .join(", ");
      console.log(`    args: ${argList}`);
    }
  }
  console.log('\nUsage: /prompt <name> key="value" [key2="value2"]\n');
}
```

Handles the `/prompts` command.

- `mcpClient.listPrompts()` — asks the MCP server for all registered prompts. Returns the names, descriptions, and argument definitions that were registered in `index.ts`.
- `a.required ? a.name : \`[${a.name}]\`` — required args shown plain, optional args shown in `[brackets]`.
- This command discovers prompts at runtime from the server — the client does not have the prompt names hardcoded.

---

## Lines 301–309 — parseKvArgs()

```typescript
function parseKvArgs(str: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(\w+)=(?:"([^"]*)"|([\S]*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    result[m[1]] = m[2] ?? m[3] ?? "";
  }
  return result;
}
```

Parses `key="value" key2="value2"` strings into a JavaScript object.

- Regex breakdown: `(\w+)` — key (word characters). `=` — equals sign. `"([^"]*)"` — quoted value (everything between quotes). `([\S]*)` — unquoted value (non-whitespace characters).
- `re.exec(str)` with the `g` flag — iterates through all matches in the string.
- `m[1]` — the key. `m[2]` — value if quoted. `m[3]` — value if unquoted. `??` — use whichever is defined.
- Example: `'role="narrator" count="4"'` → `{ role: "narrator", count: "4" }`.

---

## Lines 311–362 — invokePromptCmd()

```typescript
async function invokePromptCmd(
  argsStr: string,
  mcpClient: Client,
  tools: McpTool[],
  anthropicHistory: Anthropic.MessageParam[],
  openaiHistory: OpenAI.ChatCompletionMessageParam[],
): Promise<void> {
  const spaceIdx = argsStr.indexOf(" ");
  const promptName = spaceIdx === -1 ? argsStr : argsStr.slice(0, spaceIdx);
  const kvStr = spaceIdx === -1 ? "" : argsStr.slice(spaceIdx + 1);
  const promptArgs = parseKvArgs(kvStr);

  console.log(`\nLoading prompt "${promptName}"...\n`);

  let result = await mcpClient.getPrompt({ name: promptName, arguments: promptArgs });

  const messages = result.messages;
  for (const msg of messages.slice(0, -1)) {
    if (msg.content.type === "text") {
      anthropicHistory.push({ role: msg.role, content: msg.content.text });
      openaiHistory.push({ role: msg.role, content: msg.content.text });
    }
  }

  const last = messages[messages.length - 1];
  const userText = last?.content.type === "text" ? last.content.text : "Please begin.";

  let reply = await chatAnthropic(mcpClient, tools, userText, anthropicHistory);
  console.log(`\nAssistant: ${reply}\n`);

  const mp3 = extractMp3Path(reply);
  if (mp3) await playAudio(mp3);
}
```

Handles the `/prompt <name> [args]` command.

- `argsStr.indexOf(" ")` — finds the first space to split `"voice_agent_persona name="Aria""` into the prompt name and the rest.
- `argsStr.slice(0, spaceIdx)` — everything before the first space = prompt name.
- `argsStr.slice(spaceIdx + 1)` — everything after = the key=value argument string.
- `mcpClient.getPrompt({ name, arguments: promptArgs })` — calls the MCP server. The server runs the prompt callback (including any live API calls like `listVoices`), and returns the messages.
- `messages.slice(0, -1)` — all messages except the last. These are injected into history as prior context. (Most prompts return only one message, so this slice is usually empty.)
- `messages[messages.length - 1]` — the last message. This becomes the `userText` for the LLM call.
- `chatAnthropic(...)` — calls Claude with the prompt text. Claude now operates inside the context the prompt defined. It may immediately call tools (like `text_to_speech` to greet you).
- `extractMp3Path(reply)` — checks if any audio was generated during this prompt. If so, plays it.
- The histories (`anthropicHistory`, `openaiHistory`) are passed by reference — any messages added inside `chatAnthropic` persist in the caller's history, making future turns aware of the prompt context.

---

## Lines 366–473 — voiceLoop()

```typescript
async function voiceLoop(
  rl: readline.Interface,
  mcpClient: Client,
  tools: McpTool[],
  anthropicHistory: Anthropic.MessageParam[],
  openaiHistory: OpenAI.ChatCompletionMessageParam[],
): Promise<void> {
```

The full voice-to-voice loop. Accepts the shared histories so the `/prompt` context carries over.

```typescript
  if (!isSoxInstalled()) { /* error and return */ }

  console.log("\n[Voice Mode] ...");

  const voiceAnthropicHistory = anthropicHistory;   // same reference, not a copy
  const voiceOpenAIHistory = openaiHistory;
```

- `voiceAnthropicHistory = anthropicHistory` — this is a reference assignment, not a copy. Both variables point to the same array. Changes in one are visible in the other. This is intentional — voice mode continues the same conversation.

```typescript
  const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));
```

A tiny helper that wraps `readline.question` in a Promise, allowing `await ask("...")` instead of callbacks.

```typescript
  while (true) {
    const start = await ask("Press ENTER to speak (or type 'exit'): ");
    if (start.trim().toLowerCase() === "exit") break;
```

Infinite loop. Each iteration is one voice turn. Type `exit` to break out.

```typescript
    const tmpFile = join(tmpdir(), `elabs_${Date.now()}.wav`);
    const rec = startRecording(tmpFile);

    const stop = await ask("  Recording... Press ENTER to stop: ");
    rec.kill("SIGTERM");
```

- `join(tmpdir(), "elabs_123.wav")` — builds a path like `/tmp/elabs_1714052800123.wav`.
- `startRecording(tmpFile)` — starts sox recording in the background.
- `await ask("  Recording...")` — blocks until the user presses Enter. During this wait, sox is writing audio to the file.
- `rec.kill("SIGTERM")` — sends the terminate signal to sox. Sox flushes and closes the WAV file.

```typescript
    await new Promise((r) => setTimeout(r, 400));
```

Waits 400ms after killing sox. This gives sox time to flush all buffered audio to disk before we try to read the file.

```typescript
    if (!existsSync(tmpFile)) {
      console.log("  (No audio captured — try again)\n");
      continue;
    }
```

If the WAV file doesn't exist after 400ms, recording failed. `continue` jumps back to the top of the while loop.

```typescript
    console.log("  Transcribing...");
    transcript = await callTool(mcpClient, "speech_to_text", {
      file_path: tmpFile,
      language_code: "en"
    });
    unlinkSync(tmpFile);
```

- Calls the `speech_to_text` MCP tool with the WAV file path and forces English.
- `unlinkSync(tmpFile)` — deletes the temp file immediately after transcription. Keeps the temp directory clean.

```typescript
    if (!transcript.trim()) {
      console.log("  (No speech detected — try again)\n");
      continue;
    }

    console.log(`\nYou: "${transcript}"`);
```

- Empty transcript = silence or noise. Try again.
- Prints the transcript so you can see what was heard.

```typescript
    reply = await chatAnthropic(
      mcpClient, tools, transcript, voiceAnthropicHistory, VOICE_SYSTEM
    );
```

Passes `VOICE_SYSTEM` as the override — this forces Claude to call `text_to_speech` on every reply.

```typescript
    const mp3 = extractMp3Path(reply);
    if (mp3) {
      await playAudio(mp3);
    } else {
      const ttsOut = await callTool(mcpClient, "text_to_speech", { text: reply.slice(0, 500) });
      const fallbackMp3 = extractMp3Path(ttsOut);
      if (fallbackMp3) await playAudio(fallbackMp3);
    }
```

- Primary path: Claude called TTS on its own and returned the path → play it.
- Fallback path: if for some reason Claude didn't call TTS (shouldn't happen with `VOICE_SYSTEM` but just in case), the client calls `text_to_speech` directly with the reply text, then plays the result.
- `.slice(0, 500)` — truncate to 500 chars for the fallback to keep it short.

---

## Lines 477–563 — main() — The REPL

```typescript
async function main() {
  if (!process.env.ELEVENLABS_API_KEY) { /* error exit */ }
  if (LLM_PROVIDER === "anthropic" && !process.env.ANTHROPIC_API_KEY) { /* error exit */ }
  if (LLM_PROVIDER === "openai" && !process.env.OPENAI_API_KEY) { /* error exit */ }
```

Fast-fail checks. Exit immediately if required API keys are missing.

```typescript
  const mcpClient = await createMcpClient();
  const tools = await getMcpTools(mcpClient);
```

Spawns the server and fetches its tool list. This is the startup phase.

```typescript
  const anthropicHistory: Anthropic.MessageParam[] = [];
  const openaiHistory: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: DEFAULT_SYSTEM },
  ];
```

The conversation histories. These persist for the entire session — every user message, assistant reply, and tool call is appended here.

- `anthropicHistory` starts empty. Claude's system message is passed separately in each API call.
- `openaiHistory` starts with the system message included (OpenAI requires it as the first message in the array).

```typescript
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { ask(); return; }

      if (trimmed === "exit" || trimmed === "quit") { /* exit */ }
      if (trimmed === "/prompts") { await listPromptsCmd(mcpClient); ask(); return; }
      if (trimmed.startsWith("/prompt ")) {
        await invokePromptCmd(trimmed.slice(8).trim(), mcpClient, tools, anthropicHistory, openaiHistory);
        ask();
        return;
      }
      if (trimmed === "/voice") {
        await voiceLoop(rl, mcpClient, tools, anthropicHistory, openaiHistory);
        ask();
        return;
      }

      // Regular chat
      let reply = await chatAnthropic(mcpClient, tools, trimmed, anthropicHistory);
      console.log(`\nAssistant: ${reply}\n`);
      const mp3 = extractMp3Path(reply);
      if (mp3) await playAudio(mp3);

      ask(); // recursively call itself to show the next prompt
    });
  };

  ask(); // start the REPL
}
```

The REPL (Read-Eval-Print Loop):

- `readline.createInterface(...)` — connects to the terminal.
- `rl.question("You: ", callback)` — shows `You:` prompt, reads one line, calls the callback with the input.
- `const ask = () => { ... ask(); }` — recursive self-call at the end. After handling input, show the prompt again. This is how the REPL keeps running.
- `trimmed.slice(8).trim()` — strips `/prompt ` (8 chars including the space) to get just the name+args.
- Shared histories passed to `/prompt` and `/voice` — this is what makes the context persist across commands.
- Regular chat goes through `chatAnthropic` directly — the LLM can use any tool if relevant.

```typescript
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

Top-level error handler for anything that escapes `main()`.

---

## Full Data Flow — One Voice Turn

```
User presses ENTER
    ↓
startRecording() → sox writes to /tmp/elabs_xxx.wav
    ↓
User presses ENTER again
    ↓
rec.kill("SIGTERM") → sox closes the file
    ↓
await setTimeout(400ms) → file flush
    ↓
callTool("speech_to_text", { file_path, language_code: "en" })
    → MCP JSON-RPC → index.ts handler
    → readFile(file_path) → client.speechToText(buffer)
    → ElevenLabs /v1/speech-to-text
    → returns transcript string
    ↓
chatAnthropic(transcript, history, VOICE_SYSTEM)
    → anthropic.messages.create() with all tools available
    → Claude calls text_to_speech tool
    → callTool("text_to_speech", { text, voice_id })
        → MCP JSON-RPC → index.ts handler
        → client.textToSpeech()
        → ElevenLabs /v1/text-to-speech
        → writeFile("/path/output_xxx.mp3", audio)
        → returns "Audio saved to: /path/output_xxx.mp3"
    → extractMp3Path stores the path
    → Claude returns final text
    → mp3Suffix appended to reply
    ↓
extractMp3Path(reply) → "/path/output_xxx.mp3"
    ↓
playAudio("/path/output_xxx.mp3")
    → spawn("afplay", [path])
    → audio plays from speakers
    ↓
Loop — "Press ENTER to speak"
```
