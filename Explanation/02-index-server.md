# File 2: src/index.ts — Line by Line

This is the MCP Server. It takes the ElevenLabs API methods from `elevenlabs-client.ts` and exposes them to an AI model as **tools**, **prompts**, and **resources** — the three MCP primitives.

Think of this file as the "plugin definition". It says: "Here are the capabilities I offer. Here are the rules for using them."

---

## Line 1 — Shebang

```typescript
#!/usr/bin/env node
```

A Unix shebang line. When this file is run directly from the terminal (e.g. `./index.js`), the OS uses this line to find the right interpreter (Node.js). Not needed when run as `node index.js`, but harmless.

---

## Line 2 — Load .env file

```typescript
import "dotenv/config";
```

Side-effect-only import. When this line runs, the `dotenv` package reads the `.env` file in the project root and loads every key-value pair into `process.env`. This is how `ELEVENLABS_API_KEY=sk-...` in `.env` becomes available as `process.env.ELEVENLABS_API_KEY`. Must be the first import so the env vars are available for all code that follows.

---

## Lines 4–9 — Imports

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeFile, readFile } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { ElevenLabsClient } from "./elevenlabs-client.js";
```

- `McpServer` — the main class from the MCP SDK. Manages tool/prompt/resource registration and handles the MCP protocol.
- `StdioServerTransport` — tells the MCP server to communicate via stdin/stdout (piped to the client process).
- `z` from `"zod"` — a schema validation library. Used to define and validate the input arguments for each tool and prompt.
- `writeFile`, `readFile` — async Node.js file system functions. Used in the TTS tool (write MP3) and STT tool (read audio file).
- `join`, `basename`, `resolve` — path utilities. `join` combines path segments, `basename` extracts the filename from a path, `resolve` converts a relative path to an absolute one.
- `ElevenLabsClient` — our own client from File 1.

---

## Lines 11–15 — API key check

```typescript
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("Error: ELEVENLABS_API_KEY environment variable is required.");
  process.exit(1);
}
```

Reads the API key from environment. If it's missing, prints an error and exits immediately with code 1 (indicating failure). This is a fast-fail: no point running an API server without credentials.

---

## Lines 17–18 — Client and output directory

```typescript
const client = new ElevenLabsClient(apiKey);
const OUTPUT_DIR = resolve(process.env.ELEVENLABS_OUTPUT_DIR || process.cwd());
```

- `new ElevenLabsClient(apiKey)` — creates one shared instance used by all tools.
- `resolve(...)` — converts the output directory to an absolute path. `ELEVENLABS_OUTPUT_DIR` might be `"./output"` (relative). `resolve` turns that into `/Users/you/project/output`. This matters because when `afplay` or another process tries to open the file later, it needs an absolute path.
- `process.cwd()` fallback — if no output dir is set, use the current working directory.

---

## Lines 20–23 — Create the MCP server

```typescript
const server = new McpServer({
  name: "elevenlabs-mcp-server",
  version: "2.0.0",
});
```

Creates the MCP server instance. The name and version are metadata sent to clients during the handshake so they know what server they connected to.

---

## Lines 27–44 — Tool: list_voices

```typescript
server.registerTool(
  "list_voices",
  {
    description: "List all voices available in ElevenLabs. Returns voice IDs, names, and labels.",
  },
  async () => {
    const voices = await client.listVoices();
    const summary = voices.map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
      labels: v.labels,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
    };
  },
);
```

Registers the first tool with 3 arguments: name, metadata, handler.

- `"list_voices"` — the tool name. This is what the AI uses to call it.
- `{ description: "..." }` — tells the AI what this tool does. The AI reads this description to decide when to use the tool.
- No `inputSchema` — this tool takes no arguments.
- `async () => { ... }` — the handler function that runs when the AI calls the tool.
- `voices.map((v) => ({ ... }))` — transforms the full voice objects into a compact summary. We drop fields the AI doesn't need (like `preview_url`) to keep the response small.
- `JSON.stringify(summary, null, 2)` — converts to a pretty-printed JSON string. The `2` is the indentation level.
- Return format: `{ content: [{ type: "text", text: "..." }] }` — MCP requires this specific shape for tool responses. Every tool returns this same structure.

---

## Lines 46–60 — Tool: get_voice

```typescript
server.registerTool(
  "get_voice",
  {
    description: "Get detailed information about a specific ElevenLabs voice by its ID.",
    inputSchema: {
      voice_id: z.string().describe("The ID of the voice to retrieve"),
    },
  },
  async ({ voice_id }) => {
    const voice = await client.getVoice(voice_id);
    return {
      content: [{ type: "text", text: JSON.stringify(voice, null, 2) }],
    };
  },
);
```

- `inputSchema` — defines the expected arguments using Zod schemas. The AI reads these to know what arguments to pass.
- `z.string()` — validates that `voice_id` is a string.
- `.describe("...")` — the description is exposed to the AI so it knows what to put in `voice_id`.
- `async ({ voice_id })` — destructuring. The handler receives an object; we pull out `voice_id` directly.

---

## Lines 62–81 — Tool: list_models

```typescript
server.registerTool(
  "list_models",
  { description: "..." },
  async () => {
    const models = await client.listModels();
    const summary = models.map((m) => ({
      model_id: m.model_id,
      name: m.name,
      description: m.description,
      can_do_text_to_speech: m.can_do_text_to_speech,
      languages: m.languages.map((l) => l.name),
    }));
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  },
);
```

Same pattern as `list_voices` but for models. `m.languages.map((l) => l.name)` flattens the language objects into just their names (e.g. `["English", "Spanish"]`) since the language IDs aren't needed.

---

## Lines 83–139 — Tool: text_to_speech (most important tool)

```typescript
server.registerTool(
  "text_to_speech",
  {
    description: "Convert text to speech using ElevenLabs...",
    inputSchema: {
      text: z.string().describe("The text to convert to speech"),
      voice_id: z.string().optional().describe("Voice ID to use (default: Rachel ...)"),
      model_id: z.string().optional().describe("Model ID (default: eleven_multilingual_v2)"),
      output_filename: z.string().optional().describe("Output filename (default: output_<timestamp>.mp3)"),
      stability: z.number().min(0).max(1).optional().describe("Voice stability 0-1 (default: 0.5)"),
      similarity_boost: z.number().min(0).max(1).optional().describe("Voice similarity boost 0-1 (default: 0.75)"),
    },
  },
  async ({ text, voice_id, model_id, output_filename, stability, similarity_boost }) => {
    const vid = voice_id ?? "21m00Tcm4TlvDq8ikWAM";   // Rachel default
    const mid = model_id ?? "eleven_multilingual_v2";
    const fname = output_filename ?? `output_${Date.now()}.mp3`;
    const filePath = join(OUTPUT_DIR, fname);

    const settings =
      stability !== undefined || similarity_boost !== undefined
        ? { stability: stability ?? 0.5, similarity_boost: similarity_boost ?? 0.75 }
        : undefined;

    const audio = await client.textToSpeech(vid, text, mid, settings);
    await writeFile(filePath, audio);

    return {
      content: [{
        type: "text",
        text: `Audio saved to: ${filePath} (${audio.length} bytes, voice: ${vid}, model: ${mid})`,
      }],
    };
  },
);
```

The most-called tool. Every time the AI speaks, it calls this.

- `z.string().optional()` — optional field. AI can omit it and the default is used.
- `z.number().min(0).max(1)` — validates range. Zod will reject values outside 0–1.
- `??` (nullish coalescing) — use the left side if it's not null/undefined, otherwise use the right. Same as a default value.
- `Date.now()` — returns milliseconds since Unix epoch (e.g. `1714052800123`). Used as a unique timestamp-based filename.
- `join(OUTPUT_DIR, fname)` — builds the full file path (e.g. `/Users/you/project/output/output_1714052800123.mp3`).
- `settings` — only built if at least one of `stability` or `similarity_boost` was explicitly provided.
- `await writeFile(filePath, audio)` — writes the raw MP3 bytes to disk.
- Return message: `"Audio saved to: /path/file.mp3 (12345 bytes, ...)"` — the client (`client.ts`) parses this exact string with a regex to find the file path and auto-play it.

---

## Lines 141–168 — Tool: speech_to_text

```typescript
server.registerTool(
  "speech_to_text",
  {
    description: "Transcribe an audio file to text...",
    inputSchema: {
      file_path: z.string().describe("Absolute path to the audio file to transcribe"),
      model_id: z.string().optional().describe("STT model ID (default: scribe_v1)"),
      language_code: z.string().optional().describe("BCP-47 language code..."),
    },
  },
  async ({ file_path, model_id, language_code }) => {
    const audioBuffer = await readFile(file_path);
    const filename = basename(file_path);
    const transcript = await client.speechToText(
      audioBuffer,
      filename,
      model_id ?? "scribe_v1",
      language_code,
    );
    return { content: [{ type: "text", text: transcript }] };
  },
);
```

Transcribes an audio file. The AI passes the file path (from the voice loop's temporary WAV file), this tool reads the file and sends it to ElevenLabs.

- `readFile(file_path)` — reads the entire audio file into memory as a Buffer.
- `basename(file_path)` — extracts just the filename from the path (e.g. `"elabs_1714052800123.wav"` from `/tmp/elabs_1714052800123.wav`). Sent to ElevenLabs for its metadata.
- `language_code` — if provided (e.g. `"en"`), forces English recognition. Without it, ElevenLabs auto-detects, which can incorrectly identify accented English as Hindi.
- Returns the transcript directly as text (no JSON wrapping needed since it's just a string).

---

## Lines 170–203 — Tools: get_user_info and get_history

```typescript
server.registerTool("get_user_info", { description: "..." }, async () => {
  const info = await client.getUserInfo();
  return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
});

server.registerTool("get_history", {
  description: "...",
  inputSchema: { page_size: z.number().min(1).max(100).optional().describe("...") },
}, async ({ page_size }) => {
  const history = await client.getHistory(page_size ?? 20);
  return { content: [{ type: "text", text: JSON.stringify(history, null, 2) }] };
});
```

Both follow the same pattern. `page_size` defaults to 20 if not provided.

---

## Lines 207–258 — Prompt: voice_agent_persona (THE key prompt)

```typescript
server.registerPrompt(
  "voice_agent_persona",
  {
    description: "Create a voice AI agent with a specific persona...",
    argsSchema: {
      name: z.string().describe("Agent name (e.g., 'Aria', 'Max')"),
      personality: z.string().describe("Agent personality..."),
      voice_style: z.string().optional().describe("Preferred voice character..."),
    },
  },
  async ({ name, personality, voice_style }) => {
    const voices = await client.listVoices();             // <-- LIVE API CALL
    const voiceList = voices
      .slice(0, 20)
      .map((v) => `  - ${v.name} [${v.voice_id}]: ${JSON.stringify(v.labels)}`)
      .join("\n");

    return {
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `You are ${name}, a voice AI agent.
Personality: ${personality}.${voice_style ? `\nVoice character: ${voice_style}.` : ""}

CRITICAL RULES:
1. EVERY response MUST end with a call to text_to_speech to speak it aloud.
2. Choose the most fitting voice from the list below for your persona.
3. Keep responses to 2-3 sentences — you are speaking, not writing.
4. Use natural spoken language: contractions, short sentences, no bullet points or markdown.

Available voices (pick the best fit):
${voiceList}

Begin by introducing yourself briefly and asking how you can help. Speak this aloud via text_to_speech.`,
        },
      }],
    };
  },
);
```

This is where **prompt-centric MCP** shines. Key points:

- `argsSchema` vs `inputSchema` — tools use `inputSchema`, prompts use `argsSchema`. Same Zod syntax, different key name.
- `async ({ name, personality, voice_style })` — the prompt callback is async because it makes a live API call.
- `await client.listVoices()` — this runs AT INVOCATION TIME, not at server startup. The voice list is always fresh.
- `.slice(0, 20)` — limits to 20 voices to keep the prompt text a manageable size.
- `.map(...).join("\n")` — formats each voice as `- VoiceName [voice_id]: {"gender":"female",...}` then joins all lines with newlines.
- Template literal (backtick string) — the text is a multi-line string with variables injected using `${}`. This is the actual instruction the LLM receives.
- `voice_style ? \`\nVoice character: ${voice_style}.\` : ""` — conditional line. Only included if `voice_style` was provided.
- Return shape: `{ messages: [{ role, content }] }` — different from tools. Prompts return a list of messages to be injected into the conversation history.
- `role: "user" as const` — TypeScript needs `as const` to narrow the type from `string` to the literal `"user"`.
- `CRITICAL RULES` — these are persistent instructions embedded in the conversation context. They govern all future turns, not just the first one.

---

## Lines 260–310 — Prompt: start_voice_session

```typescript
server.registerPrompt(
  "start_voice_session",
  { ... argsSchema: { topic, language, voice_id } ... },
  async ({ topic, language, voice_id }) => {
    const lang = language ?? "English";
    const topicLine = topic
      ? `You are specialized in: ${topic}.`
      : "You are a general-purpose voice assistant.";
    const voiceLine = voice_id
      ? `Use voice ID "${voice_id}" for ALL text_to_speech calls in this session.`
      : "Call list_voices once, pick the voice that best suits the conversation, then use it consistently.";

    return {
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `You are a voice AI assistant conducting a spoken conversation in ${lang}. ${topicLine}
${voiceLine}
STRICT RULES for this session:
1. ALWAYS call text_to_speech with your response before returning any text.
2. Responses must be brief and conversational...
3. No markdown, no lists, no headers.
4. If the user provides an audio file path, call speech_to_text to transcribe it first.
The session is now live. Greet the user and speak the greeting aloud via text_to_speech.`,
        },
      }],
    };
  },
);
```

This prompt does NOT make a live API call (it's not async in any meaningful way) — all the dynamic content comes from the user's own arguments.

- `topicLine` — ternary: if `topic` was provided, specialize the agent. Otherwise make it general-purpose.
- `voiceLine` — ternary: if caller pinned a `voice_id`, use it for all TTS calls. Otherwise let the LLM pick from `list_voices`.
- `STRICT RULES` block — these 4 rules are injected into the LLM's context and stay active for the ENTIRE conversation. This is what makes every follow-up message also speak aloud, not just the first one.

---

## Lines 312–350 — Prompt: find_voice_for_role

```typescript
server.registerPrompt(
  "find_voice_for_role",
  { argsSchema: { role: z.string()..., phrase: z.string().optional()... } },
  ({ role, phrase }) =>
    Promise.resolve({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Find the best ElevenLabs voice for this role: "${role}"

Steps:
1. Call list_voices to get all available voices with metadata and labels.
2. Analyze names, categories, and labels to match the role requirements.
3. Pick the top 3 best-fit voices with a clear one-sentence reason for each.
4. For each of the 3 voices, call text_to_speech using the sample phrase: ${phrase ? `"${phrase}"` : "a short phrase that fits the role naturally"}.
5. Return a final recommendation: best voice ID, name, and why it fits best.`,
        },
      }],
    }),
);
```

This prompt uses an arrow function with `Promise.resolve()` instead of `async/await` — because it doesn't need to make any API calls. All it does is construct a text prompt with the user's arguments.

- `({ role, phrase }) =>` — arrow function, same as writing `function({ role, phrase }) { return ... }`.
- `Promise.resolve({ ... })` — wraps the return value in a resolved Promise to match the expected async return type.
- The numbered steps in the text are instructions the LLM will follow. The LLM reads step 1, calls `list_voices`, reads step 2, thinks about which voices fit, etc. This workflow has ZERO orchestration code — it's entirely in the prompt text.
- `${phrase ? `"${phrase}"` : "..."}` — conditional: use the custom phrase if provided, otherwise tell the LLM to make up something fitting.

---

## Lines 352–386 — Prompt: voice_showcase

```typescript
server.registerPrompt(
  "voice_showcase",
  { argsSchema: { phrase: z.string()..., count: z.string().optional()... } },
  ({ phrase, count }) => {
    const n = Math.min(parseInt(count ?? "4", 10) || 4, 8);
    return Promise.resolve({ messages: [{ ... text: `Create a voice showcase for: "${phrase}"

Steps:
1. Call list_voices to see all available voices.
2. Pick ${n} voices that are diverse — different genders, accents, and styles.
3. Call text_to_speech for each voice with the exact phrase.
4. Report each result: voice name, voice_id, output file path, one-word character description.
5. End with a summary table of all ${n} voices and their output file paths.` }] });
  },
);
```

- `count` is a `z.string()` not `z.number()` — MCP prompt arguments are always strings in this SDK version.
- `parseInt(count ?? "4", 10)` — parse the string "4" to the number 4. The `10` means base-10 (decimal). If parsing fails (e.g. empty string), `parseInt` returns `NaN`.
- `|| 4` — if `parseInt` returned `NaN` (falsy), default to 4.
- `Math.min(..., 8)` — cap at 8 regardless of what the user passed.
- `${n}` is used twice in the prompt text — once to instruct the LLM how many to pick, once in the summary table instruction to match.

---

## Lines 390–432 — Resources

```typescript
server.resource(
  "voices",
  "elevenlabs://voices",
  { description: "...", mimeType: "application/json" },
  async () => {
    const voices = await client.listVoices();
    return {
      contents: [{
        uri: "elevenlabs://voices",
        mimeType: "application/json",
        text: JSON.stringify(voices, null, 2),
      }],
    };
  },
);
```

Resources are different from tools and prompts:
- Tools are called by the LLM when it needs to do something.
- Resources are read passively — an MCP client (like Claude Desktop) can subscribe to them and get fresh data without the LLM explicitly asking.
- `"elevenlabs://voices"` — a custom URI scheme. Identifies this resource uniquely.
- Return shape: `{ contents: [{ uri, mimeType, text }] }` — different from tools.
- Both resources (`voices` and `models`) simply call the ElevenLabs API and return the full JSON.

---

## Lines 436–444 — Server startup

```typescript
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ElevenLabs MCP Server v2 running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- `StdioServerTransport()` — sets up stdin/stdout as the communication channel. The client (`client.ts`) reads from this process's stdout and writes to its stdin.
- `server.connect(transport)` — starts the MCP server and begins listening for messages.
- `console.error(...)` — logs to stderr (not stdout). Stdout is reserved for MCP JSON-RPC messages; any human-readable log output must go to stderr to avoid corrupting the protocol.
- `main().catch(...)` — top-level error handler. If anything in `main()` throws, log it and exit with code 1.

---

## Summary: What Gets Registered

| Primitive | Count | Names |
|---|---|---|
| Tools | 7 | `list_voices`, `get_voice`, `list_models`, `text_to_speech`, `speech_to_text`, `get_user_info`, `get_history` |
| Prompts | 4 | `voice_agent_persona`, `start_voice_session`, `find_voice_for_role`, `voice_showcase` |
| Resources | 2 | `elevenlabs://voices`, `elevenlabs://models` |

## Key Insight: Tools vs Prompts

| | Tool | Prompt |
|---|---|---|
| Called by | The AI when it needs to act | You, from the terminal with `/prompt` |
| What it does | One specific action (API call, file write) | Injects a full context into the conversation |
| Duration of effect | Single use | Shapes the entire session |
| Can call APIs | Yes (in handler) | Yes (in callback, before LLM sees anything) |
| Example | `text_to_speech` saves one MP3 | `voice_agent_persona` embeds the live voice list + behavioral rules so every future reply uses TTS |
