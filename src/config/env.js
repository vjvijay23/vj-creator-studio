import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '../..');
export const ENV_PATH = path.join(ROOT_DIR, '.env');

export const DATA_DIR = path.join(ROOT_DIR, 'workspace_data');
export const DOWNLOADS_DIR = path.join(DATA_DIR, 'downloads');
export const SHORTS_DIR = path.join(DATA_DIR, 'shorts');
export const VOICES_DIR = path.join(DATA_DIR, 'voices');
export const FINAL_DIR = path.join(DATA_DIR, 'final');
export const THUMBNAILS_DIR = path.join(DATA_DIR, 'thumbnails');

for (const dir of [DATA_DIR, DOWNLOADS_DIR, SHORTS_DIR, VOICES_DIR, FINAL_DIR, THUMBNAILS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || '',
  youtubeClientId: process.env.YOUTUBE_CLIENT_ID || '',
  youtubeClientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
  youtubeRedirectUri:
    process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3000/api/youtube/oauth2callback',
};

export function saveApiKeysToEnv(updates = {}) {
  const keyMap = {
    geminiApiKey: 'GEMINI_API_KEY',
    elevenLabsApiKey: 'ELEVENLABS_API_KEY',
    elevenLabsVoiceId: 'ELEVENLABS_VOICE_ID',
    youtubeClientId: 'YOUTUBE_CLIENT_ID',
    youtubeClientSecret: 'YOUTUBE_CLIENT_SECRET',
    youtubeRedirectUri: 'YOUTUBE_REDIRECT_URI',
  };

  for (const [cfgKey, envKey] of Object.entries(keyMap)) {
    if (typeof updates[cfgKey] === 'string' && updates[cfgKey].trim() !== '') {
      config[cfgKey] = updates[cfgKey].trim();
      process.env[envKey] = config[cfgKey];
    }
  }

  const lines = [
    `PORT=${config.port}`,
    `GEMINI_API_KEY=${config.geminiApiKey}`,
    `ELEVENLABS_API_KEY=${config.elevenLabsApiKey}`,
    `ELEVENLABS_VOICE_ID=${config.elevenLabsVoiceId}`,
    `YOUTUBE_CLIENT_ID=${config.youtubeClientId}`,
    `YOUTUBE_CLIENT_SECRET=${config.youtubeClientSecret}`,
    `YOUTUBE_REDIRECT_URI=${config.youtubeRedirectUri}`,
  ];
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf-8');
}

export function getMaskedKeys() {
  const mask = (val) => (val ? `${val.slice(0, 4)}••••${val.slice(-4)}` : '');
  return {
    geminiApiKey: mask(config.geminiApiKey),
    elevenLabsApiKey: mask(config.elevenLabsApiKey),
    elevenLabsVoiceId: config.elevenLabsVoiceId || '',
    youtubeClientId: mask(config.youtubeClientId),
    youtubeClientSecret: mask(config.youtubeClientSecret),
    youtubeRedirectUri: config.youtubeRedirectUri,
  };
}
