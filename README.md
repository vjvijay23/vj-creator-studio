# YouTube Live & Shorts Growth Studio

A full-stack web app and local automation tool for YouTube Live creators:

1. **Criteria & Live Booster**: Tracks YouTube Partner Program progress (500 / 1,000 subscribers, watch hours, and Shorts views) and generates high-CTR Live Stream titles, descriptions, tags, pinned comments, and pre-live checklists.
2. **High-Moment 2-Minute Shorts Cutter**: Paste a YouTube Live / VOD link (or upload a local video), detect peak replay/engagement moments, and cut them into `9:16` vertical Shorts (`1080x1920`, up to 2–3 minutes).
3. **AI Voice Cloning & Commentary**: Upload a sample of your voice to clone it via ElevenLabs, generate a commentary script (English, Tamil, or Tanglish), and mix your AI voiceover into the Short.
4. **Push to YouTube**: Connect via Google OAuth2 and upload finished Shorts directly to your YouTube channel with `#Shorts` optimization and a link back to your live stream.

## Setup

1. Copy `.env.example` to `.env` and fill in your API keys as needed:
   - `GEMINI_API_KEY` (optional, enables AI boost packs, moment scoring, and commentary scripts)
   - `ELEVENLABS_API_KEY` (required for AI voice cloning & commentary synthesis)
   - `YOUTUBE_CLIENT_ID` & `YOUTUBE_CLIENT_SECRET` (required for direct YouTube upload)
2. Install **FFmpeg** and **yt-dlp** on Windows (for video cutting & downloading):
   ```powershell
   winget install Gyan.FFmpeg
   winget install yt-dlp.yt-dlp
   ```
3. Start the studio:
   ```powershell
   npm start
   ```
4. Open [http://localhost:3000](http://localhost:3000) in your browser.
