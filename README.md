# ElevenLabs Voice-to-Voice Agent — MCP Server

A full **voice-to-voice AI agent** built on the [Model Context Protocol](https://modelcontextprotocol.io/). Speak into your microphone, the agent thinks, and ElevenLabs speaks back — all orchestrated through MCP tools, prompts, and resources.

Works with **Anthropic Claude** or **OpenAI GPT** — no Claude Desktop required.

---

## MCP Primitives Implemented

### Tools (7)

| Tool | Description |
|---|---|
| `list_voices` | List all available ElevenLabs voices |
| `get_voice` | Get detailed info about a specific voice |
| `list_models` | List available TTS/STT models |
| `text_to_speech` | Convert text → MP3, save to disk |
| `speech_to_text` | Transcribe an audio file → text |
| `get_user_info` | Account and character usage info |
| `get_history` | Retrieve generation history |

### Prompts (4) — prompt-centric MCP

| Prompt | Args | What it does |
|---|---|---|
| `voice_agent_persona` | `name`, `personality`, `[voice_style]` | Creates a named agent persona; picks the best matching voice and speaks every reply aloud |
| `start_voice_session` | `[topic]`, `[language]`, `[voice_id]` | Initialises a live voice loop — agent listens and responds in spoken audio |
| `find_voice_for_role` | `role` | Lists voices, picks top 3 for the role, generates audio samples for each |
| `voice_showcase` | `phrase`, `[count]` | Renders the same phrase across N diverse voices for side-by-side comparison |

### Resources (2)

| URI | Description |
|---|---|
| `elevenlabs://voices` | Live voice list — IDs, categories, labels |
| `elevenlabs://models` | Available TTS/STT models and capabilities |

---

## Prerequisites

- **Node.js ≥ 18**
- **sox** (for microphone recording in `/voice` mode)
  ```bash
  brew install sox        # macOS
  sudo apt install sox    # Ubuntu/Debian
  ```
- An [ElevenLabs API key](https://elevenlabs.io/app/settings/api-keys)
- An LLM key: [Anthropic](https://console.anthropic.com/) or [OpenAI](https://platform.openai.com/api-keys)

---

## Setup

```bash
npm install
npm run build
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ELEVENLABS_API_KEY` | Yes | ElevenLabs API key |
| `LLM_PROVIDER` | No | `"anthropic"` (default) or `"openai"` |
| `ANTHROPIC_API_KEY` | If using Anthropic | Claude API key |
| `OPENAI_API_KEY` | If using OpenAI | GPT API key |
| `ELEVENLABS_OUTPUT_DIR` | No | Where MP3 files are saved (defaults to cwd) |

Export before running (the server reads from `process.env` directly — `.env` is not auto-loaded):

```bash
export ELEVENLABS_API_KEY="your-key"
export LLM_PROVIDER="anthropic"
export ANTHROPIC_API_KEY="your-key"
```

---

## Usage

### Start the client

```bash
npm run client
```

```
ElevenLabs Voice Agent — MCP Client (provider: anthropic)

Connected! 7 tools: list_voices, get_voice, list_models, text_to_speech, speech_to_text, get_user_info, get_history
Commands: /prompts  /prompt <name> [args]  /voice  exit
```

### Text chat

```
You: List all available voices
  [tool: list_voices]
Assistant: Here are the available voices...

You: Convert "Welcome to my demo" to speech using a deep male voice
  [tool: list_voices]
  [tool: text_to_speech]
Assistant: Audio saved to: ./output_1234.mp3
```

### List and invoke prompts

```
You: /prompts

Available prompts:
  voice_agent_persona — Create a voice AI agent with a specific persona...
    args: name, personality, [voice_style]
  start_voice_session — Initialize a live voice conversation...
    args: [topic], [language], [voice_id]
  find_voice_for_role — Analyze and recommend voices for a use case...
    args: role
  voice_showcase — Render a phrase in multiple voices...
    args: phrase, [count]

You: /prompt voice_agent_persona name="Aria" personality="warm and professional"
  [tool: list_voices]
  [tool: text_to_speech]
Assistant: Hi, I'm Aria! How can I help you today?
  [Audio plays automatically]
```

### Voice conversation mode

```
You: /voice

[Voice Mode] The agent will listen and speak back.
[Voice Mode] Type 'exit' at any prompt to return to text mode.

Press ENTER to speak (or type 'exit'):
  Recording... Press ENTER to stop:
  Transcribing...

You: "What voices does ElevenLabs have?"
  [tool: list_voices]
  [tool: text_to_speech]
Assistant: ElevenLabs has over 30 voices...
  [Audio plays automatically]

Press ENTER to speak (or type 'exit'): exit

[Returned to text mode]
```

---

## ElevenLabs API Key Permissions

When creating your API key, enable:

| Permission | Setting |
|---|---|
| Text to Speech | Access |
| Speech to Text | Access |
| Voices | Read |
| Models | Access |
| History | Read |
| User | Read |

Everything else can stay at **No Access**.

---

## With Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "elevenlabs": {
      "command": "node",
      "args": ["/absolute/path/to/build/index.js"],
      "env": { "ELEVENLABS_API_KEY": "your-key" }
    }
  }
}
```

## With Claude Code

```bash
claude mcp add elevenlabs node /absolute/path/to/build/index.js
```

---

## Architecture

```
src/
  elevenlabs-client.ts  — ElevenLabs REST API wrapper (TTS + STT + voices + models)
  index.ts              — MCP server: 7 tools, 4 prompts, 2 resources
  client.ts             — CLI client: text REPL + /voice loop + /prompt commands
```

```
You (mic/keyboard)
    │
    ▼
client.ts ──────────────────────────────► LLM API (Claude / GPT)
    │  MCP stdio transport                       │
    ▼                                            │ tool calls
index.ts (MCP Server)  ◄────────────────────────┘
    │
    ▼
elevenlabs-client.ts ──► ElevenLabs REST API
                              (TTS + STT + voices + models)
```

Voice loop flow:
1. **Mic → sox → WAV file**
2. **`speech_to_text` tool** → transcript text
3. **LLM** (with `VOICE_SYSTEM` prompt) → text response + `text_to_speech` call
4. **`text_to_speech` tool** → MP3 file
5. **`afplay` / `mpg123`** → audio plays from speakers
6. Loop back to step 1

---

## License

MIT
