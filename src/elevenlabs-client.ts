/**
 * ElevenLabs API client — thin wrapper over the REST API.
 */

const BASE_URL = "https://api.elevenlabs.io/v1";

export interface Voice {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  description: string | null;
  preview_url: string | null;
}

export interface Model {
  model_id: string;
  name: string;
  description: string;
  can_do_text_to_speech: boolean;
  can_do_voice_conversion: boolean;
  languages: { language_id: string; name: string }[];
}

export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style?: number;
  use_speaker_boost?: boolean;
}

export class ElevenLabsClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "xi-api-key": this.apiKey,
      ...extra,
    };
  }

  /** List all available voices. */
  async listVoices(): Promise<Voice[]> {
    const res = await fetch(`${BASE_URL}/voices`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`ElevenLabs API error: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { voices: Voice[] };
    return data.voices;
  }

  /** Get details for a single voice. */
  async getVoice(voiceId: string): Promise<Voice> {
    const res = await fetch(`${BASE_URL}/voices/${encodeURIComponent(voiceId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`ElevenLabs API error: ${res.status} ${await res.text()}`);
    return (await res.json()) as Voice;
  }

  /** List available models. */
  async listModels(): Promise<Model[]> {
    const res = await fetch(`${BASE_URL}/models`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`ElevenLabs API error: ${res.status} ${await res.text()}`);
    return (await res.json()) as Model[];
  }

  /** Convert text to speech — returns raw audio bytes (mp3). */
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

  /** Get user subscription / usage info. */
  async getUserInfo(): Promise<Record<string, unknown>> {
    const res = await fetch(`${BASE_URL}/user`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`ElevenLabs API error: ${res.status} ${await res.text()}`);
    return (await res.json()) as Record<string, unknown>;
  }

  /** Transcribe audio file bytes to text using ElevenLabs Speech-to-Text. */
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
      headers: { "xi-api-key": this.apiKey }, // no Content-Type — fetch sets multipart boundary automatically
      body: formData,
    });
    if (!res.ok) throw new Error(`ElevenLabs STT error: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { text: string };
    return data.text;
  }

  /** Get pronunciation dictionaries list. */
  async getHistory(pageSize: number = 20): Promise<Record<string, unknown>> {
    const res = await fetch(`${BASE_URL}/history?page_size=${pageSize}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`ElevenLabs API error: ${res.status} ${await res.text()}`);
    return (await res.json()) as Record<string, unknown>;
  }
}
