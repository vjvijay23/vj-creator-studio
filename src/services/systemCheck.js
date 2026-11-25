import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../config/env.js';
import { getFfmpegPath, getYtdlpPath } from '../config/binaries.js';

const execFileAsync = promisify(execFile);

async function checkBinary(cmd, args = ['--version']) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 5000 });
    const line = (stdout || stderr || '').split(/\r?\n/)[0]?.trim() || 'installed';
    return { installed: true, version: line };
  } catch {
    return { installed: false, version: null };
  }
}

export async function getSystemStatus() {
  const ffmpegCmd = getFfmpegPath();
  const ytdlpCmd = getYtdlpPath();

  const [ffmpeg, ytdlp] = await Promise.all([
    checkBinary(ffmpegCmd, ['-version']),
    checkBinary(ytdlpCmd, ['--version']),
  ]);

  return {
    binaries: {
      ffmpeg,
      ytdlp,
    },
    apis: {
      gemini: Boolean(config.geminiApiKey),
      elevenLabs: Boolean(config.elevenLabsApiKey),
      elevenLabsVoice: Boolean(config.elevenLabsVoiceId),
      youtubeOAuth: Boolean(config.youtubeClientId && config.youtubeClientSecret),
    },
    installHints: {
      windowsFfmpeg: 'winget install Gyan.FFmpeg',
      windowsYtdlp: 'winget install yt-dlp.yt-dlp',
    },
  };
}
