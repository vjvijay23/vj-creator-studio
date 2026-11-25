import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import {
  config,
  ROOT_DIR,
  DOWNLOADS_DIR,
  SHORTS_DIR,
  VOICES_DIR,
  FINAL_DIR,
  THUMBNAILS_DIR,
  saveApiKeysToEnv,
  getMaskedKeys,
} from './src/config/env.js';
import { getSystemStatus } from './src/services/systemCheck.js';
import { calculateYouTubeCriteria, generateLiveBoostPack } from './src/services/boosterService.js';
import {
  inspectYouTubeUrl,
  detectHighMoments,
  downloadAndCutShort,
  listGeneratedShorts,
} from './src/services/shortsService.js';
import {
  generateCommentaryScript,
  cloneVoiceWithElevenLabs,
  synthesizeVoiceover,
  synthesizeFreeTamilTts,
  mixVoiceoverIntoShort,
  listFinalShorts,
} from './src/services/voiceService.js';
import {
  getAuthUrl,
  handleOAuthCallback,
  isYouTubeConnected,
  getChannelStats,
  getChannelDashboard,
  uploadShortToYouTube,
} from './src/services/youtubeService.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Static frontend & generated media
app.use(express.static(path.join(ROOT_DIR, 'public')));
app.use('/media/shorts', express.static(SHORTS_DIR));
app.use('/media/final', express.static(FINAL_DIR));
app.use('/media/thumbnails', express.static(THUMBNAILS_DIR));

const uploadVoice = multer({ dest: VOICES_DIR });
const uploadVideo = multer({ dest: DOWNLOADS_DIR });
const uploadThumb = multer({ dest: THUMBNAILS_DIR });

// System & Setup Check
app.get('/api/status', async (_req, res) => {
  try {
    const status = await getSystemStatus();
    status.apis.youtubeConnected = isYouTubeConnected();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// In-App API Keys Management
app.get('/api/settings/keys', (_req, res) => {
  res.json(getMaskedKeys());
});

app.post('/api/settings/keys', (req, res) => {
  try {
    saveApiKeysToEnv(req.body || {});
    res.json({ ok: true, keys: getMaskedKeys() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1. Live Booster & Criteria Tracker
app.post('/api/criteria', (req, res) => {
  try {
    const result = calculateYouTubeCriteria(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/boost-pack', async (req, res) => {
  try {
    const pack = await generateLiveBoostPack(req.body || {});
    res.json(pack);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Live Link -> High-Moment Detection & 2-Minute Shorts Cutter
app.post('/api/shorts/inspect', async (req, res) => {
  try {
    const { url, maxShortSeconds } = req.body || {};
    if (!url) return res.status(400).json({ error: 'YouTube URL is required.' });
    const info = await inspectYouTubeUrl(url);
    const moments = await detectHighMoments({
      url,
      durationSeconds: info.duration,
      heatmap: info.heatmap,
      chapters: info.chapters,
      title: info.title,
      maxShortSeconds: maxShortSeconds || 120,
    });
    res.json({ info, moments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/shorts/cut', async (req, res) => {
  try {
    const { url, startSeconds, endSeconds, outputName, quality = '4k', cropMode = 'sharp-blur' } = req.body || {};
    const result = await downloadAndCutShort({
      url,
      startSeconds,
      endSeconds,
      outputName,
      quality,
      cropMode,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/shorts/cut-local', uploadVideo.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Video file is required.' });
    const { startSeconds = 0, endSeconds = 120, outputName, quality = '4k', cropMode = 'sharp-blur' } = req.body || {};
    const result = await downloadAndCutShort({
      localVideoPath: req.file.path,
      startSeconds: Number(startSeconds),
      endSeconds: Number(endSeconds),
      outputName,
      quality,
      cropMode,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/shorts/list', (_req, res) => {
  res.json({
    shorts: listGeneratedShorts(),
    final: listFinalShorts(),
  });
});

// 3. AI Voice Cloning & Commentary
app.post('/api/voice/script', async (req, res) => {
  try {
    const data = await generateCommentaryScript(req.body || {});
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/voice/clone', uploadVoice.single('sample'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Voice sample audio file is required.' });
    const cloned = await cloneVoiceWithElevenLabs({
      sampleFilePath: req.file.path,
      voiceName: req.body?.voiceName || 'Creator Voice',
    });
    res.json(cloned);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/voice/apply', async (req, res) => {
  try {
    const {
      shortFileName,
      script,
      voiceId,
      engine = 'free-tamil',
      freeVoice = 'ta-IN-ValluvarNeural',
      burnSubtitles = true,
      durationSeconds = 60,
    } = req.body || {};
    if (!shortFileName || !script) {
      return res.status(400).json({ error: 'shortFileName and script are required.' });
    }
    const useElevenLabs = engine === 'elevenlabs' && Boolean(voiceId || config.elevenLabsVoiceId);
    const narrationPath = useElevenLabs
      ? await synthesizeVoiceover({ script, voiceId })
      : await synthesizeFreeTamilTts({ script, voice: freeVoice });

    const mixed = await mixVoiceoverIntoShort({
      shortFileName,
      narrationAudioPath: narrationPath,
      script,
      burnSubtitles: Boolean(burnSubtitles),
      durationSeconds: Number(durationSeconds) || 60,
    });
    res.json({ ...mixed, engine: useElevenLabs ? 'elevenlabs' : 'free-tamil' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/voice/apply-direct', uploadVoice.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Recorded audio is required.' });
    const { shortFileName, script = '', burnSubtitles = 'true', durationSeconds = '60' } = req.body || {};
    if (!shortFileName) return res.status(400).json({ error: 'shortFileName is required.' });
    const mixed = await mixVoiceoverIntoShort({
      shortFileName,
      narrationAudioPath: req.file.path,
      script,
      burnSubtitles: burnSubtitles === 'true' || burnSubtitles === true,
      durationSeconds: Number(durationSeconds) || 60,
    });
    res.json({ ...mixed, engine: 'direct-mic' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. YouTube OAuth2 & Auto-Push Upload
function resolveRedirectUri(req) {
  if (process.env.YOUTUBE_REDIRECT_URI) return process.env.YOUTUBE_REDIRECT_URI;
  const host = req.get('host');
  return host ? `${req.protocol}://${host}/api/youtube/oauth2callback` : undefined;
}

app.get('/api/youtube/auth-url', (req, res) => {
  try {
    res.json({ url: getAuthUrl(resolveRedirectUri(req)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/youtube/oauth2callback', async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send('Missing OAuth code.');
    await handleOAuthCallback(String(code), resolveRedirectUri(req));
    res.send('<h2>YouTube Connected Successfully!</h2><p>You can close this tab and return to the studio.</p>');
  } catch (err) {
    res.status(500).send(`OAuth error: ${err.message}`);
  }
});

app.get('/api/youtube/channel', async (_req, res) => {
  try {
    const stats = await getChannelStats();
    res.json(stats);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/youtube/dashboard', async (_req, res) => {
  try {
    const dashboard = await getChannelDashboard();
    res.json(dashboard);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/youtube/upload', uploadThumb.single('thumbnail'), async (req, res) => {
  try {
    const body = req.body || {};
    const tags = typeof body.tags === 'string'
      ? body.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : body.tags;
    const result = await uploadShortToYouTube({
      ...body,
      tags,
      thumbnailPath: req.file ? req.file.path : '',
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(config.port, () => {
  console.log(`YouTube Live & Shorts Studio running at http://localhost:${config.port}`);
});
