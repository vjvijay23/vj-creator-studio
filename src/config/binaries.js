import ffmpegStatic from 'ffmpeg-static';
import path from 'path';
import fs from 'fs';
import { DATA_DIR } from './env.js';

export function getFfmpegPath() {
  return ffmpegStatic || 'ffmpeg';
}

export function getYtdlpPath() {
  const localBin = path.join(DATA_DIR, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return 'yt-dlp';
}
