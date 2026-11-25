import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import { config, DOWNLOADS_DIR, SHORTS_DIR } from '../config/env.js';
import { getFfmpegPath, getYtdlpPath } from '../config/binaries.js';

const execFileAsync = promisify(execFile);

function formatTimestamp(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return hrs > 0
    ? `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${mins}:${String(secs).padStart(2, '0')}`;
}

export async function inspectYouTubeUrl(url) {
  try {
    const { stdout } = await execFileAsync(
      getYtdlpPath(),
      ['--dump-single-json', '--no-warnings', '--skip-download', url],
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
    );
    const info = JSON.parse(stdout);
    return {
      id: info.id,
      title: info.title || 'YouTube Video',
      duration: Number(info.duration) || 0,
      uploader: info.uploader || info.channel || 'Unknown',
      viewCount: Number(info.view_count) || 0,
      isLive: Boolean(info.is_live),
      heatmap: Array.isArray(info.heatmap) ? info.heatmap : [],
      chapters: Array.isArray(info.chapters) ? info.chapters : [],
      thumbnail: info.thumbnail || '',
      webpageUrl: info.webpage_url || url,
    };
  } catch (err) {
    throw new Error(
      `Could not inspect YouTube URL via yt-dlp (${err.message}). Make sure yt-dlp is installed and the URL is public.`
    );
  }
}

export async function detectHighMoments({
  url,
  durationSeconds = 0,
  heatmap = [],
  chapters = [],
  title = '',
  maxShortSeconds = 120,
}) {
  const clipLen = Math.min(180, Math.max(15, Number(maxShortSeconds) || 120));

  // 1. If YouTube heatmap (Most Replayed) data exists, pick top peaks
  if (Array.isArray(heatmap) && heatmap.length > 0) {
    const sorted = [...heatmap]
      .sort((a, b) => (b.value || 0) - (a.value || 0))
      .slice(0, 5);

    const chosen = [];
    for (const point of sorted) {
      const center = (Number(point.start_time) + Number(point.end_time)) / 2;
      const start = Math.max(0, Math.round(center - clipLen * 0.35));
      const end = durationSeconds > 0 ? Math.min(durationSeconds, start + clipLen) : start + clipLen;
      const overlaps = chosen.some((c) => Math.abs(c.startSeconds - start) < clipLen * 0.6);
      if (!overlaps && end - start >= 15) {
        chosen.push({
          id: `moment-${chosen.length + 1}`,
          title: `Peak Replay Moment #${chosen.length + 1}`,
          startSeconds: start,
          endSeconds: end,
          startFormatted: formatTimestamp(start),
          endFormatted: formatTimestamp(end),
          durationSeconds: end - start,
          score: Math.round((point.value || 0.8) * 100),
          reason: 'High viewer replay spike detected on stream timeline.',
        });
      }
      if (chosen.length >= 3) break;
    }
    if (chosen.length > 0) return chosen;
  }

  // 2. If Gemini API is available, ask Gemini to suggest high-retention clip windows
  if (config.geminiApiKey && durationSeconds > 30) {
    try {
      const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
      const prompt = `Suggest 3 high-retention YouTube Shorts segments (each up to ${clipLen} seconds) for a video/stream titled "${title}" with total duration ${durationSeconds} seconds.
Chapters: ${JSON.stringify(chapters.slice(0, 15))}
Return strict JSON array of objects:
[{"title": "Hook title", "startSeconds": 60, "endSeconds": 180, "score": 92, "reason": "Why this window hooks viewers"}]`;

      const res = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      const items = JSON.parse(res.text);
      if (Array.isArray(items) && items.length > 0) {
        return items.slice(0, 3).map((m, idx) => {
          const start = Math.max(0, Number(m.startSeconds) || 0);
          const end = Math.min(
            durationSeconds || start + clipLen,
            Math.max(start + 15, Number(m.endSeconds) || start + clipLen)
          );
          return {
            id: `moment-${idx + 1}`,
            title: m.title || `Highlight #${idx + 1}`,
            startSeconds: start,
            endSeconds: end,
            startFormatted: formatTimestamp(start),
            endFormatted: formatTimestamp(end),
            durationSeconds: end - start,
            score: Number(m.score) || 85,
            reason: m.reason || 'AI-selected high-engagement window.',
          };
        });
      }
    } catch (err) {
      console.warn('Gemini moment detection fallback:', err.message);
    }
  }

  // 3. Deterministic fallback windows based on total duration
  const total = durationSeconds > 30 ? durationSeconds : 600;
  const anchors = [0.12, 0.45, 0.75];
  return anchors.map((ratio, idx) => {
    const start = Math.max(0, Math.floor(total * ratio));
    const end = Math.min(total, start + clipLen);
    return {
      id: `moment-${idx + 1}`,
      title: `High-Potential Segment #${idx + 1}`,
      startSeconds: start,
      endSeconds: end,
      startFormatted: formatTimestamp(start),
      endFormatted: formatTimestamp(end),
      durationSeconds: Math.max(15, end - start),
      score: 88 - idx * 4,
      reason: `Selected ${clipLen}s window at ${Math.round(ratio * 100)}% stream mark (customize timestamps anytime).`,
    };
  });
}

export async function downloadAndCutShort({
  url,
  localVideoPath,
  startSeconds = 0,
  endSeconds = 120,
  outputName,
  quality = '4k',
  cropMode = 'sharp-blur',
}) {
  const safeBase = (outputName || `short-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  let sourceFile = localVideoPath;
  const start = Math.max(0, Number(startSeconds) || 0);
  const end = Math.max(start + 15, Number(endSeconds) || start + 120);
  const duration = Math.min(180, Math.max(5, end - start));

  if (!sourceFile) {
    if (!url) throw new Error('Either a YouTube URL or a local video file is required.');
    sourceFile = path.join(DOWNLOADS_DIR, `${safeBase}-source.mp4`);
    await execFileAsync(
      getYtdlpPath(),
      [
        '--ffmpeg-location',
        path.dirname(getFfmpegPath()),
        '--download-sections',
        `*${start}-${end}`,
        '-f',
        'bv*[height<=2160][ext=mp4]+ba[ext=m4a]/bv*[height<=2160]+ba/b',
        '--merge-output-format',
        'mp4',
        '-o',
        sourceFile,
        url,
      ],
      { timeout: 10 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 }
    );
  }

  if (!fs.existsSync(sourceFile)) {
    throw new Error('Source video file was not found after download.');
  }

  const outPath = path.join(SHORTS_DIR, `${safeBase}.mp4`);
  const targetW = quality === '1080p' ? 1080 : 2160;
  const targetH = quality === '1080p' ? 1920 : 3840;

  const args = ['-y'];
  if (localVideoPath) {
    args.push('-ss', String(start));
  }
  args.push('-i', sourceFile);
  if (localVideoPath) {
    args.push('-t', String(duration));
  }

  if (cropMode === 'full-crop') {
    args.push(
      '-vf',
      `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${targetW}:${targetH}`
    );
  } else {
    // Sharp-blur 9:16: preserves 100% original sharpness without stretching/pixelation
    args.push(
      '-filter_complex',
      `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${targetW}:${targetH},boxblur=30:5,eq=brightness=-0.12[bg];[0:v]scale=${targetW}:-2:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[vout]`,
      '-map',
      '[vout]',
      '-map',
      '0:a?'
    );
  }

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '16',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '256k',
    '-movflags',
    '+faststart',
    outPath
  );

  await execFileAsync(getFfmpegPath(), args, {
    timeout: 15 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return {
    fileName: path.basename(outPath),
    filePath: outPath,
    publicUrl: `/media/shorts/${path.basename(outPath)}`,
    durationSeconds: duration,
    resolution: `${targetW}x${targetH}`,
  };
}

export function listGeneratedShorts() {
  if (!fs.existsSync(SHORTS_DIR)) return [];
  return fs
    .readdirSync(SHORTS_DIR)
    .filter((f) => f.endsWith('.mp4'))
    .map((f) => ({
      fileName: f,
      publicUrl: `/media/shorts/${f}`,
      sizeMb: Number((fs.statSync(path.join(SHORTS_DIR, f)).size / (1024 * 1024)).toFixed(2)),
    }));
}
