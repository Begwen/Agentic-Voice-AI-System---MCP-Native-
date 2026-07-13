# Demo Script — Prompt-Centric MCP Implementation

Step-by-step guide for the video submission. Each step tells you exactly what to
type, what the terminal will show, and which file + line to open to explain the code.

---

## Before You Start

Run these once before recording:

```bash
# 1. Create the output directory for generated MP3 files
mkdir -p output

# 2. Build the project
npm run build

# 3. Export all required API keys
export ELEVENLABS_API_KEY="your-elevenlabs-key"
export LLM_PROVIDER="anthropic"
export ANTHROPIC_API_KEY="your-anthropic-key"
export ELEVENLABS_OUTPUT_DIR="./output"

# 4. Start the client
npm run client
```

Expected startup output:
```
ElevenLabs Voice Agent — MCP Client (provider: anthropic)

Connected! 7 tools: list_voices, get_voice, list_models, text_to_speech,
           speech_to_text, get_user_info, get_history
Commands: /prompts  /prompt <name> [args]  /voice  exit
```

---

## STEP 1 — Show That the Server Uses All Three MCP Primitives

**What to say on camera:**
> "Most MCP servers only register tools. This server registers all three MCP
> primitives in one file — tools, prompts, and resources."

**Open in editor:** `src/index.ts`

| What to point at | Line | What it shows |
|---|---|---|
| `server.registerTool("list_voices", ...)` | 26 | First tool — the conventional part |
| `server.registerTool("text_to_speech", ...)` | 82 | Core TTS tool |
| `server.registerTool("speech_to_text", ...)` | 140 | STT tool — enables voice input |
| `server.registerPrompt("voice_agent_persona", ...)` | 201 | First prompt — the key primitive |
| `server.registerPrompt("start_voice_session", ...)` | 254 | Second prompt |
| `server.registerPrompt("find_voice_for_role", ...)` | 306 | Third prompt |
| `server.registerPrompt("voice_showcase", ...)` | 340 | Fourth prompt |
| `server.resource("voices", "elevenlabs://voices", ...)` | 378 | First resource |
| `server.resource("models", "elevenlabs://models", ...)` | 400 | Second resource |

**Key point to make:** Lines 26–199 are tools (7 total). Lines 201–374 are prompts
(4 total). Lines 378–424 are resources (2 total). One file, three primitives.

---

## STEP 2 — Discover Prompts at Runtime

**Type in terminal:**
```
You: /prompts
```

**Expected output:**
```
Available prompts:
  voice_agent_persona — Create a voice AI agent with a specific persona...
    args: name, personality, [voice_style]
  start_voice_session — Initialize a live voice conversation...
    args: [topic], [language], [voice_id]
  find_voice_for_role — Analyze available voices and recommend...
    args: role
  voice_showcase — Render the same phrase in multiple voices...
    args: phrase, [count]

Usage: /prompt <name> key="value" [key2="value2"]
```

**Open in editor:** `src/client.ts`

| What to point at | Line | What it shows |
|---|---|---|
| `async function listPromptsCmd(...)` | 255 | The /prompts handler |
| `const { prompts } = await mcpClient.listPrompts()` | 256 | Standard MCP client call |

**Key point to make:** `listPrompts()` is a built-in MCP protocol method. The client
discovers prompts from the server at runtime — it does not have them hardcoded.

---

## STEP 3 — The Core Differentiator: Dynamic Context Inside a Prompt Callback

**Type in terminal:**
```
You: /prompt voice_agent_persona name="Aria" personality="warm and professional" voice_style="calm and clear"
```

**Watch the terminal carefully — you will see:**
```
Loading prompt "voice_agent_persona"...

  [tool: list_voices]         <-- this fires BEFORE the LLM is even called
  [tool: text_to_speech]      <-- LLM automatically spoke its greeting
Assistant: Hi, I'm Aria! How can I help you today?
[Audio plays from speakers]
```

**Open in editor:** `src/index.ts`

| What to point at | Line | What it shows |
|---|---|---|
| `async ({ name, personality, voice_style }) => {` | 221 | Prompt callback starts |
| `const voices = await client.listVoices()` | 222 | **LIVE API CALL inside the prompt** |
| `const voiceList = voices.slice(0, 20).map(...)` | 223–226 | Voice list constructed dynamically |
| `CRITICAL RULES:` text block | 237–241 | Rules that force TTS on every reply |
| `Available voices (pick the best fit):` | 243 | Voice list embedded in instructions |
| `${voiceList}` | 244 | **Runtime data baked into the prompt** |

**Key point to make:** Line 222 calls `listVoices()` inside the prompt callback — this
runs at invocation time, not at server startup. The voice list is live, current API
data embedded directly into the LLM's instructions. If ElevenLabs adds a new voice
tomorrow, the prompt reflects it automatically. A tool cannot do this.

**Also open:** `src/client.ts`

| What to point at | Line | What it shows |
|---|---|---|
| `async function invokePromptCmd(...)` | 286 | /prompt command handler |
| `result = await mcpClient.getPrompt(...)` | 302 | Client calls server to execute the callback |
| Loop: inject messages into history | 311–318 | Prompt messages become conversation context |
| `reply = await chatAnthropic(...)` | 325 | LLM now operates inside that context |
| `if (mp3) await playAudio(mp3)` | 332–333 | Auto-play: LLM called TTS on its own |

---

## STEP 4 — Session-Level Behavioral Rules

**Type in terminal:**
```
You: /prompt start_voice_session topic="trivia host" language="English"
```

**Watch the terminal:**
```
Loading prompt "start_voice_session"...

  [tool: list_voices]          <-- agent picks a voice for the session
  [tool: text_to_speech]       <-- speaks its greeting automatically
Assistant: Welcome! I'm your trivia host for tonight...
[Audio plays]
```

Now type a follow-up without any special command:
```
You: Give me a science question
```

**Watch — the LLM will automatically call TTS again:**
```
  [tool: text_to_speech]
Assistant: Here is your question: What is the speed of light?
[Audio plays]
```

**Open in editor:** `src/index.ts`

| What to point at | Line | What it shows |
|---|---|---|
| `STRICT RULES for this session:` | 292 | Session-wide behavioral rules |
| Rule 1: ALWAYS call text_to_speech | 293 | Why the LLM called TTS on every reply |
| Rule 2: brief and conversational | 294 | Why responses are short |
| Rule 3: No markdown, no lists | 295 | Why output is plain spoken text |
| `The session is now live. Greet...` | 298 | First action triggered by the prompt |

**Key point to make:** Lines 292–296 are not a one-time instruction to call a tool.
They are persistent rules injected into the LLM's context that govern the entire
conversation. Every follow-up message the user sends inherits these rules. This is
what separates a prompt from a tool call.

---

## STEP 5 — Workflow Orchestration via Prompt

**Type in terminal:**
```
You: /prompt find_voice_for_role role="children's audiobook narrator"
```

**Watch the terminal — the LLM orchestrates a full multi-step workflow:**
```
Loading prompt "find_voice_for_role"...

  [tool: list_voices]          <-- step 1: get all voices
  [tool: text_to_speech]       <-- step 4: sample for voice 1
  [tool: text_to_speech]       <-- step 4: sample for voice 2
  [tool: text_to_speech]       <-- step 4: sample for voice 3
Assistant: Based on my analysis... I recommend Rachel (voice ID: 21m00Tcm4TlvDq8ikWAM)
[Audio plays — 3 sample files generated]
```

**Open the output folder:**
```
./output/
```
You will see 3 new MP3 files: `output_<timestamp1>.mp3`, `output_<timestamp2>.mp3`,
`output_<timestamp3>.mp3` — one sample per recommended voice.

**Open in editor:** `src/index.ts`

| What to point at | Line | What it shows |
|---|---|---|
| `({ role }) => Promise.resolve({...})` | 319–320 | Prompt callback — no async API call needed here |
| Step 1: `Call list_voices...` | 329 | Workflow step 1 in plain text |
| Step 2: `Analyze names, categories...` | 330 | LLM reasoning step — not code |
| Step 3: `Pick the top 3...` | 331 | Selection logic — not code |
| Step 4: `call text_to_speech...` | 332 | Multiple tool calls — orchestrated by LLM |
| Step 5: `Return a final recommendation` | 333 | Output format — defined in prompt |

**Key point to make:** This entire workflow — list, analyze, pick 3, generate samples,
recommend — is encoded in the prompt text at lines 329–333. There is zero
orchestration logic in `client.ts` for this. The LLM reads the instructions and
decides which tools to call, in which order. To add a new workflow, add a new prompt.
No changes to any other file.

---

## STEP 6 — Voice Showcase: Multiple TTS Outputs from One Prompt

**Type in terminal:**
```
You: /prompt voice_showcase phrase="Welcome to the future of AI" count="4"
```

**Watch the terminal:**
```
Loading prompt "voice_showcase"...

  [tool: list_voices]
  [tool: text_to_speech]       <-- voice 1
  [tool: text_to_speech]       <-- voice 2
  [tool: text_to_speech]       <-- voice 3
  [tool: text_to_speech]       <-- voice 4
Assistant: Here are your 4 voice samples:
  | Rachel  | 21m00Tcm4TlvDq8ikWAM | ./output/output_...mp3 | warm    |
  | Adam    | pNInz6obpgDQGcFmaJgB  | ./output/output_...mp3 | deep    |
  ...
[First audio plays]
```

**Open the output folder:**
```
./output/
```
4 new MP3 files — same sentence in 4 different voices. Play them one by one on camera.

**Open in editor:** `src/index.ts`

| What to point at | Line | What it shows |
|---|---|---|
| `const n = Math.min(parseInt(count ?? "4", ...) ...)` | 354 | count arg parsed from prompt invocation |
| `Pick ${n} voices that are diverse...` | 365 | Diversity instruction baked into prompt text |
| `Call text_to_speech for each voice...` | 366 | LLM told to call TTS N times |
| Summary table instruction | 367–368 | Output structure defined in prompt |

---

## STEP 7 — Full Voice-to-Voice Loop

**First, set up the voice session context:**
```
You: /prompt start_voice_session topic="general assistant"
[Audio plays — agent greets you]
```

**Then enter voice mode:**
```
You: /voice
```

**Terminal shows:**
```
[Voice Mode] The agent will listen and speak back.
[Voice Mode] Type 'exit' at any prompt to return to text mode.
```

**Press ENTER to start recording, speak a question, press ENTER to stop:**
```
Press ENTER to speak (or type 'exit'):   [press enter]
  Recording... Press ENTER to stop:      [say "Tell me about ElevenLabs"] [press enter]
  Transcribing...

You: "Tell me about ElevenLabs"
  [tool: text_to_speech]
Assistant: ElevenLabs is an AI audio company...
[Audio plays from speakers]

Press ENTER to speak (or type 'exit'):
```

**Open in editor:** `src/client.ts`

| What to point at | Line | What it shows |
|---|---|---|
| `const VOICE_SYSTEM =` | 36 | The system prompt override for voice mode |
| `"...you MUST call text_to_speech..."` | 37 | The rule that forces spoken responses |
| `async function voiceLoop(...)` | 341 | Entire voice loop function |
| `if (!isSoxInstalled()) {` | 346 | Prerequisite check before starting |
| `{ role: "system", content: VOICE_SYSTEM }` | 361 | VOICE_SYSTEM injected into OpenAI history |
| `const rec = startRecording(tmpFile)` | 371 | sox rec starts capturing microphone |
| `transcript = await callTool(mcpClient, "speech_to_text", ...)` | 389 | MCP tool call with the WAV file path |
| `reply = await chatAnthropic(..., VOICE_SYSTEM)` | 412–417 | chatAnthropic called with VOICE_SYSTEM override |
| `const mp3 = extractMp3Path(reply)` | 430 | Parse file path from tool result text |
| `await playAudio(mp3)` | 432 | Auto-play the response audio |

**Also open:** `src/client.ts`

| What to point at | Line | What it shows |
|---|---|---|
| `async function chatAnthropic(..., systemOverride?: string)` | 101, 106 | Optional override param |
| `const system = systemOverride ?? DEFAULT_SYSTEM` | 110 | Override replaces default system message |

**Key point to make:** Line 110 is where the voice mode behavior is enforced. When
`/voice` is active, `VOICE_SYSTEM` (line 36–37) replaces the default system message,
forcing the LLM to call `text_to_speech` on every single response. Combined with the
`start_voice_session` prompt already in the history, the LLM is fully primed to behave
as a voice agent throughout the conversation.

---

## STEP 8 — Show the ElevenLabs API Wrapper (30 seconds)

**Open in editor:** `src/elevenlabs-client.ts`

| What to point at | Line | What it shows |
|---|---|---|
| `async listVoices()` | 47 | Called inside the voice_agent_persona prompt callback |
| `async textToSpeech(...)` | 75 | Called by the text_to_speech MCP tool |
| `async speechToText(...)` | 110 | Called by the speech_to_text MCP tool |
| `new Blob([new Uint8Array(audioBuffer)], ...)` | 116 | Multipart/form-data audio upload |

**Key point to make:** `src/elevenlabs-client.ts` is a pure API wrapper — it has zero
MCP knowledge. `src/index.ts` is the MCP layer — it has zero knowledge of which LLM
the client uses. `src/client.ts` is the integration layer. Each file has one job.

---

## Generated File Locations

Every time `text_to_speech` is called, a new MP3 is saved here:

```
./output/output_<unix_timestamp>.mp3
```

Example:
```
./output/output_1714052800123.mp3
./output/output_1714052803456.mp3
./output/output_1714052806789.mp3
```

If `ELEVENLABS_OUTPUT_DIR` is not set, files go to the **project root directory**
(wherever you ran `npm run client` from) with the same naming pattern.

---

## Recommended Video Order

| Segment | Duration | What you show |
|---|---|---|
| Open `src/index.ts`, scroll through lines 26–424 | 30s | Three primitives in one file |
| `/prompts` in terminal | 15s | Runtime prompt discovery |
| `/prompt voice_agent_persona`, open line 222 | 60s | Live API call inside prompt callback |
| `/prompt start_voice_session`, send a follow-up | 45s | Session-level behavioral rules |
| `/prompt find_voice_for_role`, open `./output/` | 60s | Workflow-as-prompt, 3 MP3 files |
| `/prompt voice_showcase`, open `./output/` | 45s | 4 MP3s, same phrase different voices |
| `/voice` mode end-to-end turn | 60s | Full voice-to-voice pipeline |
| Open `src/client.ts` lines 36–37, 110 | 30s | VOICE_SYSTEM override explained |
| Total | ~6 min | |
