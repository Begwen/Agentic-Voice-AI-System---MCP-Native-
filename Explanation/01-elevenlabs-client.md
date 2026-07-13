# File 1: src/elevenlabs-client.ts — Line by Line

This file is a pure HTTP wrapper around the ElevenLabs REST API.
It has zero knowledge of MCP, Claude, or voice loops.
Its only job: take arguments, make an HTTP request, return the result.

---

## Lines 1–3 — File-level comment

```typescript
/**
 * ElevenLabs API client — thin wrapper over the REST API.
 */
```

A JSDoc comment describing what the file does. Not executable — just documentation.

---

## Line 5 — Base URL constant

```typescript
const BASE_URL = "https://api.elevenlabs.io/v1";
```

All ElevenLabs API endpoints start with this URL. Storing it as a constant means if the URL ever changes, you only update it in one place. Every method in the class appends to this string (e.g. `${BASE_URL}/voices`).

---

## Lines 7–14 — Voice interface

```typescript
export interface Voice {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  description: string | null;
  preview_url: string | null;
}
```

A TypeScript **interface** describes the shape of a Voice object returned by ElevenLabs.

- `export` — makes this type available to other files that import from this one.
- `interface` — defines the expected fields and their types. Think of it as a contract: "any Voice object MUST have these fields with these types."
- `voice_id: string` — unique ID used to select a voice when calling TTS.
- `labels: Record<string, string>` — a key-value dictionary. ElevenLabs uses labels like `{ "gender": "female", "accent": "american" }`.
- `string | null` — the field can be either a string or null (missing/not provided).

---

## Lines 16–23 — Model interface

```typescript
export interface Model {
  model_id: string;
  name: string;
  description: string;
  can_do_text_to_speech: boolean;
  can_do_voice_conversion: boolean;
  languages: { language_id: string; name: string }[];
}
```

Describes a TTS/STT model returned by ElevenLabs.

- `boolean` — true or false. `can_do_text_to_speech` tells you whether this model supports TTS.
- `languages: { language_id: string; name: string }[]` — an array of inline objects. The `[]` means "array of". So this is a list of languages, each with an ID and a name.

---

## Lines 25–30 — VoiceSettings interface

```typescript
export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style?: number;
  use_speaker_boost?: boolean;
}
```

Optional tuning parameters you can pass when generating speech.

- `stability` — 0 to 1. Higher = more consistent/monotone. Lower = more expressive/variable.
- `similarity_boost` — 0 to 1. How closely the output matches the original voice sample.
- `style?` and `use_speaker_boost?` — the `?` means optional. You don't have to provide these.

---

## Lines 32–37 — Class declaration and constructor

```typescript
export class ElevenLabsClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
```

- `export class` — defines a reusable class that other files can import and instantiate.
- `private apiKey: string` — the API key is stored as a private field. `private` means only methods inside this class can read it — it cannot be accessed from outside.
- `constructor(apiKey: string)` — runs once when you do `new ElevenLabsClient("sk-...")`. It saves the key to `this.apiKey` so all other methods can use it.

---

## Lines 39–44 — Private headers helper

```typescript
private headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "xi-api-key": this.apiKey,
    ...extra,
  };
}
```

Every ElevenLabs API request must include the API key in a header called `xi-api-key`. Rather than repeating this in every method, this helper builds the headers object once.

- `extra: Record<string, string> = {}` — optional extra headers. Default is empty `{}`.
- `...extra` — spread operator. Merges the extra headers into the returned object.
- For most calls this returns `{ "xi-api-key": "sk-..." }`.
- For TTS (which also needs `Content-Type: application/json`) it returns `{ "xi-api-key": "...", "Content-Type": "application/json" }`.

---

## Lines 47–54 — listVoices()

```typescript
async listVoices(): Promise<Voice[]> {
  const res = await fetch(`${BASE_URL}/voices`, {
    headers: this.headers(),
  });
  if (!res.ok) throw new Error(`ElevenLabs API error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { voices: Voice[] };
  return data.voices;
}
```

Fetches all available voices from ElevenLabs.

- `async` — this function runs asynchronously (doesn't block while waiting for the network).
- `Promise<Voice[]>` — the return type. This function eventually returns an array of Voice objects.
- `fetch(url, options)` — Node.js built-in HTTP client. Makes a GET request.
- `await fetch(...)` — pauses here and waits for the response before continuing.
- `if (!res.ok)` — `res.ok` is true for HTTP 200–299. If the request failed (e.g. 401, 429), throw an error with the status code and error body.
- `await res.json()` — parses the response body as JSON.
- `as { voices: Voice[] }` — TypeScript cast. We tell TypeScript "trust us, this JSON has a `voices` array".
- `return data.voices` — ElevenLabs wraps the array in `{ voices: [...] }`, so we unwrap it.

---

## Lines 57–63 — getVoice()

```typescript
async getVoice(voiceId: string): Promise<Voice> {
  const res = await fetch(`${BASE_URL}/voices/${encodeURIComponent(voiceId)}`, {
    headers: this.headers(),
  });
  if (!res.ok) throw new Error(`ElevenLabs API error: ${res.status} ${await res.text()}`);
  return (await res.json()) as Voice;
}
```

Gets full details for a single voice by its ID.

- `encodeURIComponent(voiceId)` — URL-encodes the voice ID. Voice IDs contain alphanumeric characters but it's a safety measure to prevent URL injection if a weird ID appears.
- Returns the entire JSON object cast as a `Voice` (not wrapped in a `voices` array like listVoices).

---

## Lines 66–72 — listModels()

```typescript
async listModels(): Promise<Model[]> {
  const res = await fetch(`${BASE_URL}/models`, {
    headers: this.headers(),
  });
  if (!res.ok) throw new Error(`ElevenLabs API error: ${res.status} ${await res.text()}`);
  return (await res.json()) as Model[];
}
```

Fetches all available TTS/STT models. Simpler than `listVoices` — ElevenLabs returns the array directly (no wrapper object), so we just parse and return.

---

## Lines 75–98 — textToSpeech()

```typescript
async textToSpeech(
  voiceId: string,
  text: string,
  modelId: string = "eleven_multilingual_v2",
  voiceSettings?: VoiceSettings,
): Promise<Buffer> {
  const body: Record<string, unknown> = {
    text,
    model_id: modelId,
  };
  if (voiceSettings) body.voice_settings = voiceSettings;

  const res = await fetch(
    `${BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs API error: ${res.status} ${await res.text()}`);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}
```

The core method — converts text to speech and returns the raw audio bytes.

- `modelId: string = "eleven_multilingual_v2"` — default parameter. If caller doesn't pass a model, use this one.
- `voiceSettings?: VoiceSettings` — optional. If not passed, voice uses its default settings.
- `const body = { text, model_id: modelId }` — builds the JSON request body. The shorthand `{ text }` is the same as `{ text: text }`.
- `if (voiceSettings) body.voice_settings = voiceSettings` — only add `voice_settings` to the body if it was provided. ElevenLabs ignores it if absent.
- `method: "POST"` — this is a POST request (sending data), not a GET.
- `headers: this.headers({ "Content-Type": "application/json" })` — adds `Content-Type` on top of the API key header. Required for POST requests with a JSON body.
- `body: JSON.stringify(body)` — converts the JS object to a JSON string for the request body.
- `await res.arrayBuffer()` — audio data is binary (not text), so we read it as a raw ArrayBuffer.
- `Buffer.from(arrayBuf)` — converts the ArrayBuffer to a Node.js Buffer (which is easier to write to disk with `fs.writeFile`).

---

## Lines 101–107 — getUserInfo()

```typescript
async getUserInfo(): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}/user`, {
    headers: this.headers(),
  });
  if (!res.ok) throw new Error(`ElevenLabs API error: ${res.status} ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}
```

Returns your account info — character quota, usage, subscription tier.

- `Record<string, unknown>` — a loose type meaning "any JSON object". We don't define a strict interface for this because we just pass it through as JSON.

---

## Lines 110–130 — speechToText()

```typescript
async speechToText(
  audioBuffer: Buffer,
  filename: string = "audio.wav",
  modelId: string = "scribe_v1",
  languageCode?: string,
): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: "audio/wav" });
  formData.append("file", blob, filename);
  formData.append("model_id", modelId);
  if (languageCode) formData.append("language_code", languageCode);

  const res = await fetch(`${BASE_URL}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": this.apiKey },
    body: formData,
  });
  if (!res.ok) throw new Error(`ElevenLabs STT error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { text: string };
  return data.text;
}
```

Transcribes audio to text. This method is different from the others because it sends a **file upload** (multipart/form-data), not JSON.

- `audioBuffer: Buffer` — the raw audio bytes read from disk.
- `new FormData()` — creates a multipart form, which is the standard way to upload files over HTTP.
- `new Uint8Array(audioBuffer)` — converts the Node.js Buffer to a Uint8Array. This is required because `Blob` does not accept a `Buffer` directly in TypeScript.
- `new Blob([...], { type: "audio/wav" })` — wraps the bytes in a Blob with the correct MIME type.
- `formData.append("file", blob, filename)` — attaches the audio blob as the "file" field with its filename.
- `formData.append("model_id", modelId)` — text fields added the same way.
- `if (languageCode) formData.append(...)` — only sends the language hint if it was provided. Without it, ElevenLabs auto-detects (which can get confused by accented English → wrongly picks Hindi).
- `headers: { "xi-api-key": this.apiKey }` — deliberately NOT using `this.headers({ "Content-Type": "..." })` here. When you pass FormData as the body, `fetch` automatically sets `Content-Type: multipart/form-data; boundary=...` with the correct boundary. If you set it manually, the boundary is missing and the request fails.
- `return data.text` — ElevenLabs returns `{ text: "transcribed string" }`, we unwrap and return just the string.

---

## Lines 133–139 — getHistory()

```typescript
async getHistory(pageSize: number = 20): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}/history?page_size=${pageSize}`, {
    headers: this.headers(),
  });
  if (!res.ok) throw new Error(`ElevenLabs API error: ${res.status} ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}
```

Retrieves the history of past TTS generations.

- `?page_size=${pageSize}` — query parameter appended to the URL. Controls how many items to return.
- Default is 20 items. Caller can request up to 100.

---

## Line 140 — Class closing brace

```typescript
}
```

Closes the `ElevenLabsClient` class. Everything above between lines 32–140 is part of the class.

---

## Summary

| Method | HTTP Verb | Endpoint | Returns |
|---|---|---|---|
| `listVoices()` | GET | `/v1/voices` | `Voice[]` |
| `getVoice(id)` | GET | `/v1/voices/{id}` | `Voice` |
| `listModels()` | GET | `/v1/models` | `Model[]` |
| `textToSpeech(...)` | POST | `/v1/text-to-speech/{id}` | `Buffer` (MP3 bytes) |
| `getUserInfo()` | GET | `/v1/user` | JSON object |
| `speechToText(...)` | POST | `/v1/speech-to-text` | `string` (transcript) |
| `getHistory(n)` | GET | `/v1/history` | JSON object |

All methods follow the same pattern:
1. Build URL and body
2. `await fetch(...)` with the API key header
3. Check `res.ok`, throw if error
4. Parse and return the response
