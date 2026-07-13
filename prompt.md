# prompt.md — How to Use the 4 MCP Prompts

This guide covers all four prompts available in this project: what each one does, when and why to use it, how to pass arguments, and what to do next after invoking it.

---

## How Prompts Work

A prompt is invoked with:

```
/prompt <name> key="value" key2="value2"
```

When you run this command the MCP server executes the prompt callback — which may call live ElevenLabs APIs — and injects the result as context into the LLM's conversation history. The LLM then responds with that context already active. Unlike a tool call (which does one thing and stops), a prompt shapes how the LLM behaves for the **entire conversation that follows**.

---

## Recommended Order of Use

| Step | Command | Purpose | What comes next |
|---|---|---|---|
| 1 | `/prompt voice_agent_persona` | Create a named AI character with a chosen voice and personality | Continue chatting, or go to step 2 |
| 2 | `/prompt start_voice_session` | Lock in strict voice rules for the session (TTS every reply, no markdown, short responses) | Run `/voice` to go hands-free |
| 3 | `/voice` | Enter the mic loop — speaks back using the full context from steps 1 and 2 | Type `exit` to return to text mode |
| — | `/prompt find_voice_for_role` | Standalone: find the best voice for any specific role or use case | Check `./output/` for the sample MP3s generated |
| — | `/prompt voice_showcase` | Standalone: hear the same phrase across multiple voices for comparison | Check `./output/` for the MP3 files |

Steps 1 and 2 are designed to work together (persona first, then session rules), but every prompt also works independently.

---

## Prompt 1 — `voice_agent_persona`

### What it does

Creates a named AI character with a defined personality. The prompt callback fetches the **live voice list** from ElevenLabs at invocation time and embeds it directly into the LLM's instructions. The LLM reads the voice metadata, picks the best matching voice, introduces itself by name, and uses that same voice for every reply.

### Why use it

- Gives the AI a consistent identity (name + personality + voice) across the entire session.
- The voice list is always live — new ElevenLabs voices appear automatically without any code change.
- Without this prompt the LLM has no persona and may pick a different voice on each turn.

### Arguments

| Argument | Required | What it controls | Good example |
|---|---|---|---|
| `name` | Yes | The character's name — used in the self-introduction and kept consistent | `"Aria"` |
| `personality` | Yes | Tone and speaking style — the LLM shapes every response around this | `"warm and professional"` |
| `voice_style` | No | Hint for voice selection (maps to ElevenLabs labels). If omitted, LLM picks freely | `"calm and clear"` |

**Tip for `personality`:** Two adjectives joined by "and" works well. Think about how the voice should feel to the listener, not what the agent knows.

**Tip for `voice_style`:** Terms like `"deep"`, `"bright"`, `"raspy"`, `"soft"`, `"authoritative"` match well to ElevenLabs voice labels.

### Example invocations

```
/prompt voice_agent_persona name="Aria" personality="warm and professional" voice_style="calm and clear"
/prompt voice_agent_persona name="Max" personality="witty and casual"
/prompt voice_agent_persona name="Nova" personality="energetic and enthusiastic" voice_style="bright and upbeat"
/prompt voice_agent_persona name="Sage" personality="thoughtful and measured" voice_style="deep and slow"
```

### What you will see

```
Loading prompt "voice_agent_persona"...

  [tool: list_voices]          <- fires BEFORE the LLM is called (live API call inside the prompt callback)
  [tool: text_to_speech]       <- LLM picked a voice and speaks its greeting aloud
  [Playing audio: /path/to/output/output_xxx.mp3]
```

### What to do next

After the agent greets you, you can either:
- Keep chatting in text — the persona and voice stay active.
- Run `/prompt start_voice_session` to add strict spoken-only rules, then `/voice` to go fully hands-free.

---

## Prompt 2 — `start_voice_session`

### What it does

Injects a set of **session-wide behavioral rules** into the LLM's context. Every message you send after this prompt will be governed by those rules — the LLM will always call `text_to_speech` before replying, keep responses to 2–3 sentences, and avoid markdown. It also picks a voice (or uses the one you specify) and maintains it for the session.

### Why use it

- Without this prompt, the LLM may reply in text only and skip TTS.
- The rules persist for every follow-up message, not just the first one.
- Combine with `/voice` to get a true voice-to-voice loop where you speak and the AI speaks back.
- Supports topic specialization — tell it you are doing customer support, language tutoring, trivia, etc.

### Arguments

| Argument | Required | What it controls | Good example |
|---|---|---|---|
| `topic` | No | What the agent is specialized in — focuses its knowledge and tone | `"customer support"` / `"trivia host"` / `"language tutor"` |
| `language` | No | Language for the conversation. Default: English | `"English"` / `"Spanish"` / `"Hindi"` |
| `voice_id` | No | Pin a specific ElevenLabs voice ID for the whole session. If omitted, LLM picks one | `"21m00Tcm4TlvDq8ikWAM"` (Rachel) |

**Tip for `topic`:** Be specific — `"Python interview coach"` works better than `"coding"`. The LLM adjusts its vocabulary and question style around the topic.

**Tip for `voice_id`:** Run `/prompt find_voice_for_role` or `list_voices` first to get the ID you want, then pin it here.

### Example invocations

```
/prompt start_voice_session
/prompt start_voice_session topic="trivia host" language="English"
/prompt start_voice_session topic="customer support for a software product"
/prompt start_voice_session topic="Spanish language tutor" language="Spanish"
/prompt start_voice_session voice_id="21m00Tcm4TlvDq8ikWAM"
```

### What you will see

```
Loading prompt "start_voice_session"...

  [tool: list_voices]          <- only if voice_id was not specified
  [tool: text_to_speech]       <- agent greets you and speaks it aloud
  [Playing audio: /path/to/output/output_xxx.mp3]
```

### What to do next

After the greeting plays, type `/voice` to enter the continuous mic loop:



```
You: /voice

[Voice Mode] The agent will listen and speak back.
[Voice Mode] Type 'exit' at any prompt to return to text mode.

Press ENTER to speak (or type 'exit'):
  Recording... Press ENTER to stop:
  Transcribing...
  [tool: text_to_speech]
  [Playing audio: /path/to/output/output_xxx.mp3]
Press ENTER to speak (or type 'exit'):
```

Every mic turn continues the same conversation thread. The session rules (always speak, stay brief, no markdown) stay active until you type `exit`.

---

## Prompt 3 — `find_voice_for_role`

### What it does

Orchestrates a multi-step workflow: the LLM fetches all available voices, analyzes their names, categories, and labels against your role description, picks the top 3 best matches, generates a sample audio clip for each, and returns a final recommendation with the best voice ID and reason.

### Why use it

- No manual browsing of the ElevenLabs voice catalogue.
- You get audio samples so you can *hear* the candidates before committing.
- The entire workflow — list, analyze, pick, sample, recommend — is driven by the prompt text alone. No extra code.

### Arguments

| Argument | Required | What it controls | Good example |
|---|---|---|---|
| `role` | Yes | The use case or character description the voice needs to fit | `"children's audiobook narrator"` |

**Tip for `role`:** The more specific, the better. Include the medium (podcast, IVR, audiobook), the audience (children, professionals, gamers), and any tone hints (authoritative, friendly, dramatic).

### Example invocations

```
/prompt find_voice_for_role role="children's audiobook narrator"
/prompt find_voice_for_role role="corporate IVR system"
/prompt find_voice_for_role role="true crime podcast host"
/prompt find_voice_for_role role="friendly customer support agent"
/prompt find_voice_for_role role="video game villain"
```

### What you will see

```
Loading prompt "find_voice_for_role"...

  [tool: list_voices]          <- step 1: get all voices
  [tool: text_to_speech]       <- sample for recommended voice 1
  [tool: text_to_speech]       <- sample for recommended voice 2
  [tool: text_to_speech]       <- sample for recommended voice 3
  [Playing audio: /path/to/output/output_xxx.mp3]
```

### Output files

Three MP3 files are saved to `./output/` — one per recommended voice. Open and compare them before deciding which voice to use.

### What to do next

Copy the recommended voice ID from the terminal output, then use it in `/prompt start_voice_session voice_id="<id>"` or as the `voice_id` argument to `text_to_speech`.

---

## Prompt 4 — `voice_showcase`

### What it does

Renders the same phrase across N diverse voices so you can compare them side by side. The LLM fetches all voices, picks N that are meaningfully different (different gender, accent, style), calls `text_to_speech` once per voice, and prints a summary table with each voice name, ID, output file path, and a one-word character description.

### Why use it

- Fast way to audition voices without manually trying each one.
- The diversity selection is handled by the LLM — it avoids picking similar voices.
- All MP3s are generated in one command, ready to play back.

### Arguments

| Argument | Required | What it controls | Good example |
|---|---|---|---|
| `phrase` | Yes | The exact text to speak across all voices | `"Welcome to the future of AI"` |
| `count` | No | How many voices to showcase. Default: 4, max: 8 | `"4"` / `"6"` / `"8"` |

**Note:** `count` is passed as a string (e.g. `count="4"`), not a number. The server parses it internally.

**Tip for `phrase`:** Pick something that reveals character — a greeting, a dramatic statement, or a question. Short phrases (one sentence) work best because you want to focus on the voice, not the content.

### Example invocations

```
/prompt voice_showcase phrase="Welcome to the future of AI" count="4"
/prompt voice_showcase phrase="Hello, how can I help you today?"
/prompt voice_showcase phrase="In a world where anything is possible..." count="6"
/prompt voice_showcase phrase="Error 404: humanity not found." count="3"
```

### What you will see

```
Loading prompt "voice_showcase"...

  [tool: list_voices]
  [tool: text_to_speech]       <- voice 1
  [tool: text_to_speech]       <- voice 2
  [tool: text_to_speech]       <- voice 3
  [tool: text_to_speech]       <- voice 4
  [Playing audio: /path/to/output/output_xxx.mp3]
```

The terminal also prints a summary table like:

```
| Rachel  | 21m00Tcm4TlvDq8ikWAM | ./output/output_111.mp3 | warm    |
| Adam    | pNInz6obpgDQGcFmaJgB  | ./output/output_222.mp3 | deep    |
| Elli    | MF3mGyEYCl7XYWbV9V6O  | ./output/output_333.mp3 | bright  |
| Josh    | TxGEqnHWrfWFTfGW9XjX  | ./output/output_444.mp3 | calm    |
```

### Output files

N MP3 files are saved to `./output/`. Open them one by one to pick your favourite. The `voice_id` column in the table is what you need to use in other prompts or tools.

### What to do next

After comparing the clips, copy the best voice ID and use it in:
- `/prompt start_voice_session voice_id="<id>"` to lock that voice in for a session
- The `voice_id` argument of `text_to_speech` for one-off generations

---

## Quick Reference — All Arguments at a Glance

| Prompt | Argument | Required | Type | Default | Purpose |
|---|---|---|---|---|---|
| `voice_agent_persona` | `name` | Yes | string | — | Character name |
| `voice_agent_persona` | `personality` | Yes | string | — | Speaking tone and style |
| `voice_agent_persona` | `voice_style` | No | string | LLM picks | Voice character hint |
| `start_voice_session` | `topic` | No | string | General assistant | Specialization area |
| `start_voice_session` | `language` | No | string | `"English"` | Conversation language |
| `start_voice_session` | `voice_id` | No | string | LLM picks | Pin a specific voice |
| `find_voice_for_role` | `role` | Yes | string | — | Role or use-case description |
| `voice_showcase` | `phrase` | Yes | string | — | Text to render across voices |
| `voice_showcase` | `count` | No | string | `"4"` | Number of voices (max 8) |

---

## Common Mistakes

| Mistake | What happens | Fix |
|---|---|---|
| Passing `count=4` without quotes | Argument parse error | Always quote values: `count="4"` |
| Running `/voice` before any prompt | Voice loop starts with no session rules — LLM may not call TTS | Run `/prompt start_voice_session` first |
| Skipping `/voice` after `start_voice_session` | You stay in text mode — you type, AI types back | Type `/voice` after the greeting plays |
| Using a `voice_id` that does not exist | ElevenLabs returns 422 or 404 | Run `/prompt find_voice_for_role` or `list_voices` to get valid IDs |
| Omitting `name` or `personality` in `voice_agent_persona` | Prompt will not invoke — required args missing | Both are required; personality is the most important |