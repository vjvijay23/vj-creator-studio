import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import { config, DATA_DIR, DOWNLOADS_DIR, SHORTS_DIR } from '../config/env.js';
import { getFfmpegPath, getYtdlpPath } from '../config/binaries.js';

const execFileAsync = promisify(execFile);
export const COOKIES_PATH = path.join(DATA_DIR, 'cookies.txt');
const META_PATH = path.join(DATA_DIR, 'shorts_meta.json');

export function readShortsMeta() {
  try {
    if (fs.existsSync(META_PATH)) return JSON.parse(fs.readFileSync(META_PATH, 'utf-8'));
  } catch {}
  return {};
}

export function saveShortMeta(fileName, meta) {
  const all = readShortsMeta();
  all[fileName] = { ...(all[fileName] || {}), ...meta, updatedAt: new Date().toISOString() };
  fs.writeFileSync(META_PATH, JSON.stringify(all, null, 2), 'utf-8');
}

export const cutJobs = new Map();

export function createJob(totalSeconds = 120, stage = 'Starting...') {
  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const job = {
    id,
    status: 'running',
    stage,
    percent: 0,
    processedSeconds: 0,
    totalSeconds,
    speed: 0,
    elapsedSeconds: 0,
    etaSeconds: null,
    startedAt: Date.now(),
    result: null,
    error: null,
  };
  cutJobs.set(id, job);
  return job;
}

function runFfmpegWithProgress(args, totalSeconds, job) {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFfmpegPath(), args);
    let stderrTail = '';

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-2000);

      const timeMatch = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const speedMatch = text.match(/speed=\s*(\d+(?:\.\d+)?)x/);

      if (timeMatch && job) {
        const secs =
          Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]);
        const speed = speedMatch ? Number(speedMatch[1]) : job.speed;
        const pct = Math.min(99, Math.round((secs / Math.max(1, totalSeconds)) * 100));
        const elapsed = Math.round((Date.now() - job.startedAt) / 1000);
        const remaining = Math.max(0, totalSeconds - secs);
        const eta = speed > 0 ? Math.round(remaining / speed) : null;

        job.processedSeconds = Math.round(secs);
        job.percent = pct;
        job.speed = speed;
        job.elapsedSeconds = elapsed;
        job.etaSeconds = eta;
      }
    });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}: ${stderrTail.slice(-300)}`));
    });
  });
}

function getCookieArgs() {
  return fs.existsSync(COOKIES_PATH) ? ['--cookies', COOKIES_PATH] : [];
}

function formatTimestamp(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return hrs > 0
    ? `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${mins}:${String(secs).padStart(2, '0')}`;
}

function extractVideoId(url) {
  const m = String(url || '').match(/(?:v=|\/live\/|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

function parseIsoDuration(iso) {
  const m = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

async function inspectViaYouTubeFallback(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('Invalid YouTube URL.');

  // Try connected YouTube OAuth if available
  try {
    const tokensPath = path.join(DATA_DIR, 'youtube_tokens.json');
    if (fs.existsSync(tokensPath) && config.youtubeClientId && config.youtubeClientSecret) {
      const { google } = await import('googleapis');
      const auth = new google.auth.OAuth2(config.youtubeClientId, config.youtubeClientSecret);
      auth.setCredentials(JSON.parse(fs.readFileSync(tokensPath, 'utf-8')));
      const yt = google.youtube({ version: 'v3', auth });
      const res = await yt.videos.list({ part: ['snippet', 'contentDetails', 'statistics'], id: [videoId] });
      const v = res.data.items?.[0];
      if (v) {
        return {
          id: v.id,
          title: v.snippet?.title || 'YouTube Video',
          duration: parseIsoDuration(v.contentDetails?.duration) || 1800,
          uploader: v.snippet?.channelTitle || 'Creator',
          viewCount: Number(v.statistics?.viewCount) || 0,
          isLive: v.snippet?.liveBroadcastContent === 'live',
          heatmap: [],
          chapters: [],
          thumbnail: v.snippet?.thumbnails?.high?.url || '',
          webpageUrl: url,
        };
      }
    }
  } catch {}

  // Public oEmbed fallback (works without auth/cookies)
  const oembedResp = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`
  );
  if (oembedResp.ok) {
    const oe = await oembedResp.json();
    return {
      id: videoId,
      title: oe.title || 'YouTube Video',
      duration: 1800,
      uploader: oe.author_name || 'Creator',
      viewCount: 0,
      isLive: false,
      heatmap: [],
      chapters: [],
      thumbnail: oe.thumbnail_url || '',
      webpageUrl: url,
    };
  }
  throw new Error('Could not fetch video metadata.');
}

export async function inspectYouTubeUrl(url) {
  const cookieArgs = getCookieArgs();
  const baseArgs = ['--dump-single-json', '--no-warnings', '--skip-download'];
  const attempts = cookieArgs.length > 0
    ? [[...cookieArgs, ...baseArgs, url]]
    : [
        [...baseArgs, url],
        ['--extractor-args', 'youtube:player_client=tv,web_embedded', ...baseArgs, url],
      ];

  let lastErr = null;
  for (const args of attempts) {
    try {
      const { stdout } = await execFileAsync(getYtdlpPath(), args, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });
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
      lastErr = err;
    }
  }

  const msg = String(lastErr?.message || '');
  if (msg.includes('not a bot')) {
    // Cloud server IP bot-check: fall back to YouTube API / oEmbed for metadata inspection
    return await inspectViaYouTubeFallback(url);
  }
  if (msg.includes('Sign in to confirm your age')) {
    throw new Error(
      'This YouTube stream is age-restricted. Open "API Keys" in the top bar and upload your YouTube cookies.txt file (or upload the downloaded .mp4 directly on the right).'
    );
  }
  throw new Error(
    `Could not inspect YouTube URL via yt-dlp (${msg}). Make sure yt-dlp is installed and the URL is public.`
  );
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
  streamTitle = '',
  momentTitle = '',
  quality = '1080p',
  cropMode = 'sharp-blur',
  job = null,
}) {
  const safeBase = (outputName || `short-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  let sourceFile = localVideoPath;
  const start = Math.max(0, Number(startSeconds) || 0);
  const end = Math.max(start + 15, Number(endSeconds) || start + 120);
  const duration = Math.min(180, Math.max(5, end - start));

  if (job) {
    job.totalSeconds = duration;
    job.stage = localVideoPath ? 'Preparing local video...' : 'Downloading stream segment...';
    job.elapsedSeconds = Math.round((Date.now() - job.startedAt) / 1000);
  }

  if (!sourceFile) {
    if (!url) throw new Error('Either a YouTube URL or a local video file is required.');
    sourceFile = path.join(DOWNLOADS_DIR, `${safeBase}-source.mp4`);
    const cookieArgs = getCookieArgs();
    const dlArgs = [
      ...cookieArgs,
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
    ];
    try {
      await execFileAsync(getYtdlpPath(), dlArgs, {
        timeout: 10 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (dlErr) {
      if (cookieArgs.length === 0 && String(dlErr.message).includes('not a bot')) {
        try {
          await execFileAsync(
            getYtdlpPath(),
            ['--extractor-args', 'youtube:player_client=tv,web_embedded', ...dlArgs],
            { timeout: 10 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 }
          );
        } catch (retryErr) {
          throw new Error(
            'YouTube blocked this cloud server IP ("Sign in to confirm you\'re not a bot"). Open "API Keys" and upload your YouTube cookies.txt, or upload the .mp4 directly on the right.'
          );
        }
      } else {
        throw dlErr;
      }
    }
  }

  if (!fs.existsSync(sourceFile)) {
    throw new Error('Source video file was not found after download.');
  }

  if (job) {
    job.stage = `Encoding ${quality === '4k' ? '4K' : '1080p'} 9:16 Short...`;
  }

  const outPath = path.join(SHORTS_DIR, `${safeBase}.mp4`);
  const targetW = quality === '4k' ? 2160 : 1080;
  const targetH = quality === '4k' ? 3840 : 1920;

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
      `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase:flags=bilinear,crop=${targetW}:${targetH},setsar=1`
    );
  } else {
    // Fast sharp-blur 9:16: blur at tiny 270x480 then upscale bg (50x faster, zero laptop lag), keep fg razor-sharp
    args.push(
      '-filter_complex',
      `[0:v]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=8:2,eq=brightness=-0.12,scale=${targetW}:${targetH}:flags=bilinear,setsar=1[bg];[0:v]scale=${targetW}:-2:flags=lanczos,setsar=1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[vout]`,
      '-map',
      '[vout]',
      '-map',
      '0:a?'
    );
  }

  args.push(
    '-threads',
    '4',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    outPath
  );

  await runFfmpegWithProgress(args, duration, job);

  const fileName = path.basename(outPath);
  saveShortMeta(fileName, {
    streamTitle: streamTitle || safeBase.replace(/[_-]+/g, ' '),
    momentTitle: momentTitle || 'Highlight Moment',
    liveUrl: url || '',
    startFormatted: formatTimestamp(start),
    endFormatted: formatTimestamp(end),
    durationSeconds: duration,
  });

  return {
    fileName,
    filePath: outPath,
    publicUrl: `/media/shorts/${fileName}`,
    durationSeconds: duration,
    resolution: `${targetW}x${targetH}`,
  };
}

export async function createHighlightMontage({
  url,
  localVideoPath,
  segments = [],
  outputName,
  streamTitle = '',
  quality = '1080p',
  cropMode = 'sharp-blur',
}) {
  const safeBase = (outputName || `montage-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  const chosenSegments =
    Array.isArray(segments) && segments.length > 0
      ? segments.slice(0, 4)
      : [
          { startSeconds: 600, endSeconds: 640 },
          { startSeconds: 2400, endSeconds: 2440 },
          { startSeconds: 5400, endSeconds: 5440 },
        ];

  const partFiles = [];
  for (let i = 0; i < chosenSegments.length; i += 1) {
    const seg = chosenSegments[i];
    const part = await downloadAndCutShort({
      url,
      localVideoPath,
      startSeconds: Number(seg.startSeconds) || 0,
      endSeconds: Number(seg.endSeconds) || (Number(seg.startSeconds) || 0) + 40,
      outputName: `${safeBase}_part${i + 1}`,
      quality,
      cropMode,
    });
    partFiles.push(part.filePath);
  }

  const listFile = path.join(DOWNLOADS_DIR, `${safeBase}-concat.txt`);
  fs.writeFileSync(
    listFile,
    partFiles.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'),
    'utf-8'
  );

  const outPath = path.join(SHORTS_DIR, `${safeBase}.mp4`);
  await execFileAsync(
    getFfmpegPath(),
    ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', outPath],
    { timeout: 10 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 }
  );

  // Clean up temporary individual parts
  for (const p of partFiles) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  if (fs.existsSync(listFile)) fs.unlinkSync(listFile);

  const targetW = quality === '4k' ? 2160 : 1080;
  const targetH = quality === '4k' ? 3840 : 1920;
  const fileName = path.basename(outPath);
  saveShortMeta(fileName, {
    streamTitle: streamTitle || safeBase.replace(/[_-]+/g, ' '),
    momentTitle: 'Best Highlights Montage',
    liveUrl: url || '',
    durationSeconds: chosenSegments.reduce((s, c) => s + ((Number(c.endSeconds) || 40) - (Number(c.startSeconds) || 0)), 0),
  });
  return {
    fileName,
    filePath: outPath,
    publicUrl: `/media/shorts/${fileName}`,
    resolution: `${targetW}x${targetH}`,
    partsCount: chosenSegments.length,
  };
}

export function listGeneratedShorts() {
  if (!fs.existsSync(SHORTS_DIR)) return [];
  return fs
    .readdirSync(SHORTS_DIR)
    .filter((f) => f.endsWith('.mp4'))
    .map((f) => {
      const st = fs.statSync(path.join(SHORTS_DIR, f));
      return {
        fileName: f,
        publicUrl: `/media/shorts/${f}`,
        sizeMb: Number((st.size / (1024 * 1024)).toFixed(2)),
        mtimeMs: st.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}
