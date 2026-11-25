import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { config, FINAL_DIR, SHORTS_DIR, VOICES_DIR } from '../config/env.js';
import { getFfmpegPath } from '../config/binaries.js';

const execFileAsync = promisify(execFile);

function formatSrtTime(totalSeconds) {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  const ms = Math.floor((totalSeconds % 1) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function buildSrtFromScript(script, durationSeconds = 60) {
  const words = script.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const wordsPerChunk = 6;
  const chunks = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '));
  }
  const slot = Math.max(1.5, durationSeconds / chunks.length);
  return chunks
    .map((text, idx) => {
      const start = idx * slot;
      const end = Math.min(durationSeconds, (idx + 1) * slot);
      return `${idx + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n`;
    })
    .join('\n');
}

export async function generateCommentaryScript({
  clipContext,
  language = 'Tamil',
  durationSeconds = 60,
}) {
  const wordsTarget = Math.min(240, Math.max(40, Math.round(durationSeconds * 2.0)));

  if (config.geminiApiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
      const langRule =
        language === 'Tamil'
          ? 'Write the ENTIRE script strictly in natural spoken Tamil (தமிழ் எழுத்துகளில், e.g., பேச்சுத் தமிழ்). Do NOT write English sentences.'
          : `Write the script in natural spoken ${language}.`;

      const prompt = `You are a viral Tamil gaming YouTube Shorts storyteller.
${langRule}
Explain the game mission/story and what happens in this highlight scene: "${clipContext || '007 இறுதி மிஷன் கிளைமாக்ஸ் சீன்'}".
Target length: around ${wordsTarget} words (fits cleanly in ${durationSeconds} seconds).
Start with a strong 3-second hook, explain the mission story clearly, and end with a quick CTA to watch the full live stream.
Return ONLY the spoken narration text (no stage directions or brackets).`;

      const res = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
      });
      if (res.text?.trim()) {
        return { source: 'gemini', script: res.text.trim() };
      }
    } catch (err) {
      console.warn('Gemini commentary script fallback:', err.message);
    }
  }

  return {
    source: 'template',
    script: `நண்பர்களே, இந்த மிஷன்ல கடைசி நேரத்துல என்ன நடந்துச்சுன்னு பாருங்க! ${clipContext || 'எதிரிகள் சுத்தி வளைச்சாலும், ஒரு சரியான பிளான் போட்டு இந்த மிஷனை முடிச்சோம்.'} கடைசி வரைக்கும் பாருங்க, இந்த சீன் வேற லெவல்ல இருக்கும். முழு லைவ் ஸ்ட்ரீம் பாக்க நம்ம சேனலை சப்ஸ்கிரைப் பண்ணிட்டு லிங்கை கிளிக் பண்ணுங்க!`,
  };
}

export async function cloneVoiceWithElevenLabs({ sampleFilePath, voiceName = 'My Creator Voice' }) {
  if (!config.elevenLabsApiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set. Add it in "API Keys" in the sidebar.');
  }
  if (!fs.existsSync(sampleFilePath)) {
    throw new Error('Voice sample file not found.');
  }

  // Convert recorded/uploaded audio (e.g. .webm from browser mic) to clean MP3 for ElevenLabs
  const mp3Path = path.join(VOICES_DIR, `sample-${Date.now()}.mp3`);
  await execFileAsync(
    getFfmpegPath(),
    ['-y', '-i', sampleFilePath, '-vn', '-ar', '44100', '-ac', '1', '-b:a', '192k', mp3Path],
    { timeout: 60000 }
  );

  const formData = new FormData();
  formData.append('name', voiceName);
  formData.append('description', 'Cloned creator voice for Tamil YouTube Shorts storytelling');
  const fileBuffer = fs.readFileSync(mp3Path);
  const blob = new Blob([fileBuffer], { type: 'audio/mpeg' });
  formData.append('files', blob, path.basename(mp3Path));

  const resp = await fetch('https://api.elevenlabs.io/v1/voices/add', {
    method: 'POST',
    headers: { 'xi-api-key': config.elevenLabsApiKey },
    body: formData,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs voice clone failed (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  return { voiceId: data.voice_id, voiceName };
}

export async function synthesizeVoiceover({ script, voiceId }) {
  const targetVoiceId = voiceId || config.elevenLabsVoiceId;
  if (!config.elevenLabsApiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set. Add it in "API Keys" in the sidebar.');
  }
  if (!targetVoiceId) {
    throw new Error('No Voice ID provided. Record/upload your voice first or set ELEVENLABS_VOICE_ID.');
  }

  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(targetVoiceId)}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': config.elevenLabsApiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: script,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.85,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs TTS failed (${resp.status}): ${errText}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  const outAudioPath = path.join(VOICES_DIR, `narration-${Date.now()}.mp3`);
  fs.writeFileSync(outAudioPath, Buffer.from(arrayBuffer));
  return outAudioPath;
}

export async function synthesizeFreeTamilTts({ script, voice = 'ta-IN-ValluvarNeural' }) {
  const tmpDir = path.join(VOICES_DIR, `tts-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioFilePath } = await tts.toFile(tmpDir, script);
  return audioFilePath;
}

export async function mixVoiceoverIntoShort({
  shortFileName,
  narrationAudioPath,
  script = '',
  burnSubtitles = true,
  durationSeconds = 60,
}) {
  const inputVideo = path.join(SHORTS_DIR, path.basename(shortFileName));
  if (!fs.existsSync(inputVideo)) {
    throw new Error(`Short file not found: ${shortFileName}`);
  }
  if (!fs.existsSync(narrationAudioPath)) {
    throw new Error('Narration audio file not found.');
  }

  const outName = `voiced-${path.basename(shortFileName)}`;
  const outPath = path.join(FINAL_DIR, outName);

  let srtPath = '';
  const args = ['-y', '-i', inputVideo, '-i', narrationAudioPath];

  if (burnSubtitles && script.trim()) {
    srtPath = path.join(VOICES_DIR, `subs-${Date.now()}.srt`);
    fs.writeFileSync(srtPath, buildSrtFromScript(script, durationSeconds), 'utf-8');
    // Escape Windows drive colon and backslashes for FFmpeg subtitles filter
    const escapedSrt = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    args.push(
      '-filter_complex',
      `[0:v]subtitles='${escapedSrt}':force_style='FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=160'[vout];[0:a]volume=0.22[bg];[1:a]highpass=f=80,lowpass=f=8500,afftdn,acompressor=threshold=-18dB:ratio=3:attack=5:release=80,volume=1.35[vo];[bg][vo]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      '-threads',
      '4',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p'
    );
  } else {
    args.push(
      '-filter_complex',
      '[0:a]volume=0.22[bg];[1:a]highpass=f=80,lowpass=f=8500,afftdn,acompressor=threshold=-18dB:ratio=3:attack=5:release=80,volume=1.35[vo];[bg][vo]amix=inputs=2:duration=first:dropout_transition=2[aout]',
      '-map',
      '0:v',
      '-map',
      '[aout]',
      '-c:v',
      'copy'
    );
  }

  args.push('-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', outPath);

  await execFileAsync(getFfmpegPath(), args, {
    timeout: 8 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return {
    fileName: outName,
    filePath: outPath,
    publicUrl: `/media/final/${outName}`,
    subtitlesBurned: Boolean(srtPath),
  };
}

export function listFinalShorts() {
  if (!fs.existsSync(FINAL_DIR)) return [];
  return fs
    .readdirSync(FINAL_DIR)
    .filter((f) => f.endsWith('.mp4'))
    .map((f) => {
      const st = fs.statSync(path.join(FINAL_DIR, f));
      return {
        fileName: f,
        publicUrl: `/media/final/${f}`,
        sizeMb: Number((st.size / (1024 * 1024)).toFixed(2)),
        mtimeMs: st.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}
