import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { config, DATA_DIR, FINAL_DIR, SHORTS_DIR } from '../config/env.js';

const TOKENS_PATH = path.join(DATA_DIR, 'youtube_tokens.json');

function getOAuth2Client(redirectUri) {
  if (!config.youtubeClientId || !config.youtubeClientSecret) {
    throw new Error('YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET must be configured in .env.');
  }
  return new google.auth.OAuth2(
    config.youtubeClientId,
    config.youtubeClientSecret,
    redirectUri || config.youtubeRedirectUri
  );
}

export function getAuthUrl(redirectUri) {
  const oauth2Client = getOAuth2Client(redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ],
  });
}

export async function handleOAuthCallback(code, redirectUri) {
  const oauth2Client = getOAuth2Client(redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
  return tokens;
}

export function isYouTubeConnected() {
  return fs.existsSync(TOKENS_PATH);
}

function getAuthenticatedClient() {
  const oauth2Client = getOAuth2Client();
  if (!fs.existsSync(TOKENS_PATH)) {
    throw new Error('YouTube account is not connected yet. Click "Connect YouTube" first.');
  }
  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}

export async function getChannelStats() {
  const auth = getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });
  const res = await youtube.channels.list({
    part: ['snippet', 'statistics', 'contentDetails'],
    mine: true,
  });
  const ch = res.data.items?.[0];
  if (!ch) return null;
  return {
    id: ch.id,
    title: ch.snippet?.title,
    customUrl: ch.snippet?.customUrl || '',
    avatar: ch.snippet?.thumbnails?.medium?.url || ch.snippet?.thumbnails?.default?.url || '',
    subscribers: Number(ch.statistics?.subscriberCount) || 0,
    views: Number(ch.statistics?.viewCount) || 0,
    videoCount: Number(ch.statistics?.videoCount) || 0,
    uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads || '',
  };
}

export async function getChannelDashboard() {
  const channel = await getChannelStats();
  if (!channel) throw new Error('No YouTube channel found for this Google account.');

  const auth = getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });

  let recentVideos = [];
  if (channel.uploadsPlaylistId) {
    const plRes = await youtube.playlistItems.list({
      part: ['contentDetails'],
      playlistId: channel.uploadsPlaylistId,
      maxResults: 8,
    });
    const ids = (plRes.data.items || [])
      .map((i) => i.contentDetails?.videoId)
      .filter(Boolean);

    if (ids.length > 0) {
      const vidRes = await youtube.videos.list({
        part: ['snippet', 'statistics', 'contentDetails'],
        id: ids,
      });
      recentVideos = (vidRes.data.items || []).map((v) => ({
        id: v.id,
        title: v.snippet?.title || 'Untitled',
        publishedAt: v.snippet?.publishedAt,
        thumbnail: v.snippet?.thumbnails?.medium?.url || '',
        views: Number(v.statistics?.viewCount) || 0,
        likes: Number(v.statistics?.likeCount) || 0,
        comments: Number(v.statistics?.commentCount) || 0,
        duration: v.contentDetails?.duration || '',
        url: `https://youtube.com/watch?v=${v.id}`,
      }));
    }
  }

  const avgViews =
    recentVideos.length > 0
      ? Math.round(recentVideos.reduce((s, v) => s + v.views, 0) / recentVideos.length)
      : 0;

  const subsRemaining500 = Math.max(0, 500 - channel.subscribers);
  const subsRemaining1000 = Math.max(0, 1000 - channel.subscribers);

  return {
    channel,
    recentVideos,
    insights: {
      avgViewsRecent: avgViews,
      subsRemaining500,
      subsRemaining1000,
      fastReachActions: [
        `Post 1–2 high-retention 4K Shorts every day from your live streams—Shorts are currently the fastest subscriber funnel to close your remaining ${subsRemaining1000} subscribers.`,
        `Hook viewers in the first 3 seconds with your own energetic Tamil voiceover and burned-in Tamil subtitles (no silent intro).`,
        `Always pin a comment and add your Live Stream link in the Short's description/related video so Shorts viewers convert into live viewers.`,
        `Schedule your Live Streams 2–4 hours ahead with a clear mission title so YouTube sends notifications before you start.`,
        `Keep your thumbnail text to 2–4 bold words max and focus on high contrast + emotion.`,
      ],
      contentProperties: {
        titleFormula: '[Curiosity Hook / Climax] + [Game/Mission Name] + Tamil | #Shorts (under 65 chars)',
        descriptionTemplate:
          'Line 1: 1-sentence hook summarizing the mission climax.\nLine 2: Watch the full live stream here -> [LIVE_URL]\nLine 3: Subscribe for daily Tamil gaming stories!\nLine 4: #Shorts #TamilGaming #[GameName]',
        recommendedTags: [
          'tamil gaming',
          'tamil gaming live',
          'youtube shorts tamil',
          'story mode tamil',
          'gaming highlights tamil',
          '007 tamil',
          'live stream highlights',
        ],
        bestPostingCadence: 'Go Live 3–4x/week (7:00–9:30 PM IST) + Upload 1–2 Shorts daily (12:30 PM & 6:30 PM IST).',
      },
    },
  };
}

export async function uploadShortToYouTube({
  fileName,
  folder = 'final',
  title,
  description,
  tags = [],
  privacyStatus = 'private',
  liveStreamUrl = '',
  thumbnailPath = '',
}) {
  const auth = getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });

  const baseDir = folder === 'shorts' ? SHORTS_DIR : FINAL_DIR;
  const videoPath = path.join(baseDir, path.basename(fileName));
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${fileName}`);
  }

  const finalTitle = title?.includes('#Shorts') ? title : `${title || 'Live Highlight'} #Shorts`;
  const finalDescription = `${description || ''}${
    liveStreamUrl ? `\n\nWatch Full Live Stream: ${liveStreamUrl}` : ''
  }\n\n#Shorts #YouTubeLive`.trim();

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: finalTitle.slice(0, 100),
        description: finalDescription,
        tags: Array.isArray(tags) ? tags : [],
        categoryId: '20',
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(videoPath),
    },
  });

  if (thumbnailPath && fs.existsSync(thumbnailPath)) {
    await youtube.thumbnails.set({
      videoId: res.data.id,
      media: { body: fs.createReadStream(thumbnailPath) },
    });
  }

  return {
    videoId: res.data.id,
    url: `https://youtube.com/shorts/${res.data.id}`,
    privacyStatus,
  };
}
