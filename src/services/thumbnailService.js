import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Client } from '@gradio/client';
import { THUMBNAILS_DIR } from '../config/env.js';
import { getFfmpegPath } from '../config/binaries.js';

const execFileAsync = promisify(execFile);

export async function generateThumbnail({
  userPhotoPath,
  gameCoverPath,
  titleText = '',
}) {
  if (!userPhotoPath || !gameCoverPath) {
    throw new Error('Both your photo and the game cover image are required.');
  }

  const outName = `thumb-${Date.now()}.png`;
  const outPath = path.join(THUMBNAILS_DIR, outName);

  const targetBlob = new Blob([fs.readFileSync(gameCoverPath)]);
  const sourceBlob = new Blob([fs.readFileSync(userPhotoPath)]);

  const client = await Client.connect('felixrosberg/face-swap');
  const result = await client.predict('/run_inference', {
    target: targetBlob,
    source: sourceBlob,
    slider: 100,
    adv_slider: 100,
    settings: [],
  });

  const outputItem = Array.isArray(result?.data) ? result.data[0] : result?.data;
  const imageUrl = outputItem?.url || outputItem?.path || (typeof outputItem === 'string' ? outputItem : '');
  if (!imageUrl) {
    throw new Error('Free face-swap service did not return an image. Please try again in a few seconds.');
  }

  const resp = await fetch(imageUrl);
  if (!resp.ok) {
    throw new Error(`Failed to download face-swapped thumbnail (${resp.status}).`);
  }

  const rawBuffer = Buffer.from(await resp.arrayBuffer());
  const rawPath = path.join(THUMBNAILS_DIR, `raw-${outName}`);
  fs.writeFileSync(rawPath, rawBuffer);

  // Resize/crop to crisp 1280x720 YouTube thumbnail, and optionally add title text
  const safeText = (titleText || '').replace(/[:'\\]/g, '').trim().slice(0, 32);
  const vf = safeText
    ? `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,drawtext=text='${safeText}':fontcolor=yellow:fontsize=74:borderw=6:bordercolor=black:x=48:y=H-110`
    : `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720`;

  await execFileAsync(
    getFfmpegPath(),
    ['-y', '-i', rawPath, '-vf', vf, '-frames:v', '1', outPath],
    { timeout: 60000 }
  );
  fs.unlinkSync(rawPath);

  return {
    source: 'free-ai-faceswap',
    fileName: outName,
    publicUrl: `/media/thumbnails/${outName}`,
  };
}

export function listThumbnails() {
  if (!fs.existsSync(THUMBNAILS_DIR)) return [];
  return fs
    .readdirSync(THUMBNAILS_DIR)
    .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f) && !f.startsWith('raw-'))
    .map((f) => ({
      fileName: f,
      publicUrl: `/media/thumbnails/${f}`,
    }));
}
