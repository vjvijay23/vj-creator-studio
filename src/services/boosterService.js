import { GoogleGenAI } from '@google/genai';
import { config } from '../config/env.js';

export function calculateYouTubeCriteria({
  subscribers = 0,
  watchHours = 0,
  shortsViews90d = 0,
  targetDays = 60,
}) {
  const subs = Math.max(0, Number(subscribers) || 0);
  const hours = Math.max(0, Number(watchHours) || 0);
  const shorts = Math.max(0, Number(shortsViews90d) || 0);
  const days = Math.max(1, Number(targetDays) || 60);

  const tier1 = {
    name: 'Fan Funding Tier (Memberships & Super Chat)',
    subscribers: { current: subs, target: 500, pct: Math.min(100, Math.round((subs / 500) * 100)) },
    watchHours: { current: hours, target: 3000, pct: Math.min(100, Math.round((hours / 3000) * 100)) },
    shortsViews: { current: shorts, target: 3_000_000, pct: Math.min(100, Math.round((shorts / 3_000_000) * 100)) },
  };

  const tier2 = {
    name: 'Full Ad Revenue Partner Tier',
    subscribers: { current: subs, target: 1000, pct: Math.min(100, Math.round((subs / 1000) * 100)) },
    watchHours: { current: hours, target: 4000, pct: Math.min(100, Math.round((hours / 4000) * 100)) },
    shortsViews: { current: shorts, target: 10_000_000, pct: Math.min(100, Math.round((shorts / 10_000_000) * 100)) },
  };

  const subsNeeded = Math.max(0, 1000 - subs);
  const hoursNeeded = Math.max(0, 4000 - hours);
  const shortsNeeded = Math.max(0, 10_000_000 - shorts);

  return {
    tier1,
    tier2,
    dailyPlan: {
      targetDays: days,
      subsPerDay: Math.ceil(subsNeeded / days),
      watchHoursPerDay: Number((hoursNeeded / days).toFixed(1)),
      shortsViewsPerDay: Math.ceil(shortsNeeded / days),
      recommendedShortsPerStream: 3,
      recommendedLiveStreamsPerWeek: 4,
    },
  };
}

export async function generateLiveBoostPack({
  topic,
  niche = 'Gaming / IRL',
  language = 'English',
  liveUrl = '',
}) {
  const cleanTopic = (topic || 'Epic Live Stream').trim();

  if (config.geminiApiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
      const prompt = `You are a YouTube Live & Shorts growth strategist.
Generate a high-CTR Live Stream Boost Pack for:
- Topic: ${cleanTopic}
- Niche: ${niche}
- Language: ${language}
- Live URL: ${liveUrl || 'TBD'}

Return strict JSON with keys:
{
  "titles": ["3 high-CTR title options under 70 chars"],
  "description": "SEO-rich YouTube Live description with timestamps placeholder and call to action",
  "tags": ["12 comma-ready SEO tags"],
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "pinnedComment": "Engaging pinned comment driving viewers to subscribe and watch Shorts",
  "thumbnailHook": "3-word bold text overlay idea for the thumbnail",
  "preLiveChecklist": ["5 concrete steps to maximize initial push when going live"]
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });

      const parsed = JSON.parse(response.text);
      return { source: 'gemini', ...parsed };
    } catch (err) {
      // Fall back to deterministic template if Gemini call fails
      console.warn('Gemini boost generation failed, using template fallback:', err.message);
    }
  }

  return {
    source: 'template',
    titles: [
      `${cleanTopic} LIVE! Don't Miss This Insane Moment`,
      `Can We Pull This Off?! | ${cleanTopic} (${niche} Live)`,
      `${cleanTopic} — Live Challenge + Viewer Interaction!`,
    ],
    description: `Welcome to the live stream: ${cleanTopic}!\n\nWatch live, drop your thoughts in chat, and check out our 2-minute highlight Shorts!\n${liveUrl ? `\nLive Stream Link: ${liveUrl}\n` : ''}\nSubscribe and hit the bell so you never miss the next live push!`,
    tags: [
      cleanTopic.toLowerCase(),
      `${niche.toLowerCase()} live`,
      'youtube live',
      'live stream highlights',
      'viral shorts',
      'trending live',
      `${cleanTopic.toLowerCase()} highlights`,
      'live commentary',
      'stream moments',
      'youtube growth',
    ],
    hashtags: ['#YouTubeLive', '#LiveStream', '#Highlights', '#Shorts', '#Viral'],
    pinnedComment: `Welcome to the stream! Drop a comment with your favorite moment so we can clip it into a Short!${liveUrl ? ` Watch live: ${liveUrl}` : ''}`,
    thumbnailHook: 'WAIT FOR IT!',
    preLiveChecklist: [
      'Schedule your live stream at least 2-4 hours early so subscribers get notified.',
      'Use a high-contrast thumbnail with 2-4 bold words max and clear facial/action focus.',
      'Open with a 30-second hook immediately when going live (avoid silent "starting soon" dead air).',
      'Pin an interactive question in live chat to boost early comment velocity.',
      'Within 1 hour after the stream, cut 2-3 high-moment Shorts (up to 2 min) linking back to the live replay.',
    ],
  };
}
