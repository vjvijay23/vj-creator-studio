const $ = (id) => document.getElementById(id);

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Top Nav Tabs
document.querySelectorAll('.nav-pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-pill').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// Status Pills
async function loadStatus() {
  try {
    const s = await api('/api/status');
    const pills = [
      { label: 'FFmpeg', ok: s.binaries.ffmpeg.installed },
      { label: 'yt-dlp', ok: s.binaries.ytdlp.installed },
      { label: 'YouTube', ok: s.apis.youtubeConnected },
    ];
    $('status-pills').innerHTML = pills
      .map((p) => `<span class="pill ${p.ok ? 'ok' : 'missing'}">${p.label}</span>`)
      .join('');
  } catch {
    $('status-pills').innerHTML = '<span class="pill missing">Offline</span>';
  }
}

// API Keys Modal
$('btn-open-keys').addEventListener('click', async () => {
  $('keys-modal').style.display = 'grid';
  try {
    const k = await api('/api/settings/keys');
    $('key-yt-id').placeholder = k.youtubeClientId || '...apps.googleusercontent.com';
    $('key-yt-secret').placeholder = k.youtubeClientSecret || 'GOCSPX-...';
    $('key-gemini').placeholder = k.geminiApiKey || 'AIzaSy...';
  } catch {}
});
$('btn-close-keys').addEventListener('click', () => {
  $('keys-modal').style.display = 'none';
});
$('btn-save-keys').addEventListener('click', async () => {
  $('keys-status').style.display = 'block';
  $('keys-status').textContent = 'Saving...';
  try {
    await api('/api/settings/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        youtubeClientId: $('key-yt-id').value,
        youtubeClientSecret: $('key-yt-secret').value,
        geminiApiKey: $('key-gemini').value,
      }),
    });
    $('keys-status').textContent = 'Saved and activated!';
    await loadStatus();
  } catch (err) {
    $('keys-status').textContent = `Error: ${err.message}`;
  }
});

$('btn-save-cookies').addEventListener('click', async () => {
  const file = $('cookies-file').files[0];
  if (!file) return;
  $('keys-status').style.display = 'block';
  $('keys-status').textContent = 'Uploading cookies.txt...';
  try {
    const fd = new FormData();
    fd.append('cookies', file);
    const data = await api('/api/settings/cookies', { method: 'POST', body: fd });
    $('keys-status').textContent = data.message;
  } catch (err) {
    $('keys-status').textContent = `Error: ${err.message}`;
  }
});

// Media Lists
async function refreshMediaLists() {
  try {
    const { shorts, final } = await api('/api/shorts/list');
    const all = [
      ...final.map((f) => ({ ...f, folder: 'final' })),
      ...shorts.map((s) => ({ ...s, folder: 'shorts' })),
    ];

    $('shorts-gallery').innerHTML =
      all.length === 0
        ? '<p class="muted">No Shorts saved yet. Cut a moment above.</p>'
        : all
            .map(
              (item) => `
          <div class="video-card">
            <video src="${item.publicUrl}" controls></video>
            <div class="muted" style="margin-top:6px;">[${item.folder}] ${item.fileName} (${item.sizeMb} MB)</div>
            <a href="${item.publicUrl}" download="${item.fileName}" class="btn-outline full" style="display:block; text-align:center; text-decoration:none; margin-top:8px;">⬇ Download MP4</a>
          </div>`
            )
            .join('');

    $('voice-short-select').innerHTML =
      shorts.length === 0
        ? '<option value="">Cut a Short in Tab 1 first</option>'
        : shorts.map((s) => `<option value="${s.fileName}">${s.fileName}</option>`).join('');

    if (shorts.length > 0 && !$('voice-video-preview').src) {
      $('voice-video-preview').src = `/media/shorts/${shorts[0].fileName}`;
    }

    $('push-file-select').innerHTML =
      all.length === 0
        ? '<option value="">No Shorts yet</option>'
        : all.map((i) => `<option value="${i.folder}|${i.fileName}">[${i.folder}] ${i.fileName}</option>`).join('');
  } catch (err) {
    console.error(err);
  }
}

$('voice-short-select').addEventListener('change', (e) => {
  if (e.target.value) {
    $('voice-video-preview').src = `/media/shorts/${e.target.value}`;
  }
});

let lastDetectedMoments = [];

// Tab 1: 4K Shorts Cutter
$('btn-inspect-url').addEventListener('click', async () => {
  $('moments-output').textContent = 'Inspecting YouTube link & detecting highlight scenes...';
  try {
    const data = await api('/api/shorts/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: $('yt-url').value,
        maxShortSeconds: $('max-short-sec').value,
      }),
    });
    const { info, moments } = data;
    lastDetectedMoments = moments || [];
    $('moments-output').innerHTML =
      `<div><strong>${info.title}</strong> (${Math.round(info.duration)}s)</div>` +
      moments
        .map(
          (m) => `
        <div class="moment-item">
          <div><strong>${m.title}</strong> • Score: ${m.score}/100</div>
          <div class="muted">${m.startFormatted} → ${m.endFormatted} (${m.durationSeconds}s)</div>
          <div class="muted">${m.reason}</div>
          <button class="btn-dark mt-sm" type="button" onclick="cutMoment(${m.startSeconds}, ${m.endSeconds}, '${m.id}')">
            Cut 4K Short
          </button>
        </div>`
        )
        .join('');
  } catch (err) {
    $('moments-output').textContent = `Error: ${err.message}`;
  }
});

window.cutMoment = (startSeconds, endSeconds, id) => {
  $('cut-start').value = startSeconds;
  $('cut-end').value = endSeconds;
  $('cut-name').value = `${id}-4k-${Date.now()}`;
  $('btn-cut-url').click();
};

$('btn-montage-url').addEventListener('click', async () => {
  const url = $('yt-url').value;
  if (!url) {
    $('moments-output').textContent = 'Paste a YouTube Live/Video URL first.';
    return;
  }
  $('moments-output').textContent = 'Building 4K High-Moment Montage (cutting top highlights & stitching)...';
  try {
    let segs = lastDetectedMoments.map((m) => ({
      startSeconds: m.startSeconds,
      endSeconds: Math.min(m.endSeconds, m.startSeconds + 40),
    }));
    if (segs.length === 0) {
      const inspected = await api('/api/shorts/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, maxShortSeconds: 40 }),
      });
      segs = (inspected.moments || []).map((m) => ({
        startSeconds: m.startSeconds,
        endSeconds: m.endSeconds,
      }));
    }
    const data = await api('/api/shorts/montage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        segments: segs,
        outputName: `montage-4k-${Date.now()}`,
        quality: $('cut-quality').value,
        cropMode: $('cut-crop-mode').value,
      }),
    });
    $('moments-output').textContent = `4K Montage saved: ${data.fileName} (${data.resolution}, ${data.partsCount} clips)`;
    await refreshMediaLists();
  } catch (err) {
    $('moments-output').textContent = `Error: ${err.message}`;
  }
});

async function pollCutJob(jobId, targetEl) {
  while (true) {
    const j = await api(`/api/jobs/${jobId}`);
    const etaText = j.etaSeconds !== null ? `~${j.etaSeconds}s left` : 'calculating ETA...';
    const speedText = j.speed ? `${j.speed}x` : '—';
    targetEl.innerHTML = `
      <div style="font-weight:700; margin-bottom:6px;">${j.stage} (${j.percent}%)</div>
      <div class="bar-track" style="margin-bottom:8px;"><div class="bar-fill" style="width:${j.percent}%"></div></div>
      <div class="muted">Cut: ${j.processedSeconds}s / ${j.totalSeconds}s &bull; Speed: ${speedText} &bull; Elapsed: ${j.elapsedSeconds}s &bull; ETA: ${etaText}</div>
    `;
    if (j.status === 'done') return j.result;
    if (j.status === 'error') throw new Error(j.error || 'Cut failed');
    await new Promise((r) => setTimeout(r, 800));
  }
}

$('btn-cut-url').addEventListener('click', async () => {
  $('cut-output').textContent = 'Starting cut job...';
  try {
    const { jobId } = await api('/api/shorts/cut', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: $('yt-url').value,
        startSeconds: Number($('cut-start').value),
        endSeconds: Number($('cut-end').value),
        outputName: $('cut-name').value,
        quality: $('cut-quality').value,
        cropMode: $('cut-crop-mode').value,
        async: true,
      }),
    });
    const data = await pollCutJob(jobId, $('cut-output'));
    $('cut-output').textContent = `Saved ${data.resolution} Short: ${data.fileName} (${data.durationSeconds}s)`;
    await refreshMediaLists();
  } catch (err) {
    $('cut-output').textContent = `Error: ${err.message}`;
  }
});

$('btn-cut-local').addEventListener('click', async () => {
  const file = $('local-video-file').files[0];
  if (!file) {
    $('cut-output').textContent = 'Please select a local video file first.';
    return;
  }
  $('cut-output').textContent = 'Uploading video & starting cut job...';
  try {
    const fd = new FormData();
    fd.append('video', file);
    fd.append('startSeconds', $('cut-start').value);
    fd.append('endSeconds', $('cut-end').value);
    fd.append('outputName', $('cut-name').value);
    fd.append('quality', $('cut-quality').value);
    fd.append('cropMode', $('cut-crop-mode').value);
    fd.append('async', 'true');
    const { jobId } = await api('/api/shorts/cut-local', { method: 'POST', body: fd });
    const data = await pollCutJob(jobId, $('cut-output'));
    $('cut-output').textContent = `Saved ${data.resolution} Short: ${data.fileName}`;
    await refreshMediaLists();
  } catch (err) {
    $('cut-output').textContent = `Error: ${err.message}`;
  }
});

// Tab 2: My Own Voice & Subtitles Studio
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let recInterval = null;
let recSeconds = 0;

$('btn-rec-start').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    recSeconds = 0;
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      clearInterval(recInterval);
      $('rec-dot').classList.remove('recording');
      recordedBlob = new Blob(recordedChunks, { type: 'audio/webm' });
      $('rec-preview').src = URL.createObjectURL(recordedBlob);
      $('rec-preview').style.display = 'block';
      stream.getTracks().forEach((t) => t.stop());
      $('voice-apply-output').textContent = 'Mic recording ready! Click "Mix My Voice + Studio Audio + Subtitles (4K)".';
    };
    mediaRecorder.start();
    $('rec-dot').classList.add('recording');
    $('rec-timer').textContent = '00:00';
    recInterval = setInterval(() => {
      recSeconds += 1;
      const m = String(Math.floor(recSeconds / 60)).padStart(2, '0');
      const s = String(recSeconds % 60).padStart(2, '0');
      $('rec-timer').textContent = `${m}:${s}`;
    }, 1000);
    $('btn-rec-start').disabled = true;
    $('btn-rec-stop').disabled = false;
    $('voice-apply-output').textContent = 'Recording your voice... Watch the Short on the left and narrate!';
  } catch (err) {
    $('voice-apply-output').textContent = `Microphone error: ${err.message}`;
  }
});

$('btn-rec-stop').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    $('btn-rec-start').disabled = false;
    $('btn-rec-stop').disabled = true;
  }
});

$('btn-apply-direct').addEventListener('click', async () => {
  const shortFileName = $('voice-short-select').value;
  if (!shortFileName) {
    $('voice-apply-output').textContent = 'Select a Short first.';
    return;
  }
  const uploadedAudio = $('direct-voice-file').files[0];
  const audioToUse = uploadedAudio || recordedBlob;
  if (!audioToUse) {
    $('voice-apply-output').textContent = 'Record your voice or upload an audio file first.';
    return;
  }

  $('voice-apply-output').textContent = 'Applying Studio Voice EQ, ducking game audio, and burning Tamil subtitles...';
  try {
    const fd = new FormData();
    fd.append('audio', audioToUse, uploadedAudio ? uploadedAudio.name : 'my-voice.webm');
    fd.append('shortFileName', shortFileName);
    fd.append('script', $('voice-script').value);
    fd.append('burnSubtitles', String($('burn-subtitles').checked));
    fd.append('durationSeconds', $('voice-dur').value);
    const data = await api('/api/voice/apply-direct', { method: 'POST', body: fd });
    $('voice-apply-output').textContent = `Done! Saved to Stored Shorts Library: ${data.fileName}`;
    await refreshMediaLists();
  } catch (err) {
    $('voice-apply-output').textContent = `Error: ${err.message}`;
  }
});

// Tab 3: Criteria & Boost Pack
$('btn-calc-criteria').addEventListener('click', async () => {
  try {
    const data = await api('/api/criteria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscribers: $('subs').value,
        watchHours: $('hours').value,
        shortsViews90d: $('shortsViews').value,
        targetDays: $('targetDays').value,
      }),
    });
    const t2 = data.tier2;
    const dp = data.dailyPlan;
    const rows = [
      { label: 'Subscribers (Goal: 1,000)', cur: t2.subscribers.current, tgt: t2.subscribers.target, pct: t2.subscribers.pct },
      { label: 'Watch Hours (Goal: 4,000)', cur: t2.watchHours.current, tgt: t2.watchHours.target, pct: t2.watchHours.pct },
      { label: 'Shorts Views 90d (Goal: 10M)', cur: t2.shortsViews.current.toLocaleString(), tgt: '10M', pct: t2.shortsViews.pct },
    ];
    $('criteria-bars').innerHTML = rows
      .map(
        (r) => `
      <div class="bar-item">
        <div class="bar-label"><span>${r.label}</span><span>${r.cur} / ${r.tgt} (${r.pct}%)</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${r.pct}%"></div></div>
      </div>`
      )
      .join('');
    $('criteria-output').style.display = 'block';
    $('criteria-output').textContent =
      `Daily Target (${dp.targetDays} days): +${dp.subsPerDay} subs/day, +${dp.watchHoursPerDay} watch hrs/day.`;
  } catch (err) {
    $('criteria-output').style.display = 'block';
    $('criteria-output').textContent = `Error: ${err.message}`;
  }
});

$('btn-boost-pack').addEventListener('click', async () => {
  $('boost-output').textContent = 'Generating SEO pack...';
  try {
    const data = await api('/api/boost-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: $('boost-topic').value,
        niche: $('boost-niche').value,
        language: $('boost-lang').value,
        liveUrl: $('boost-url').value,
      }),
    });
    $('boost-output').textContent =
      `TOP TITLES:\n${data.titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n` +
      `DESCRIPTION:\n${data.description}\n\nTAGS: ${data.tags.join(', ')}\nHASHTAGS: ${data.hashtags.join(' ')}`;
  } catch (err) {
    $('boost-output').textContent = `Error: ${err.message}`;
  }
});

// Tab 4: Push to YouTube
$('btn-connect-yt').addEventListener('click', async () => {
  try {
    const { url } = await api('/api/youtube/auth-url');
    window.open(url, '_blank');
  } catch (err) {
    $('yt-channel-output').textContent = `Error: ${err.message}`;
  }
});

$('btn-check-channel').addEventListener('click', loadYouTubeDashboard);

async function loadYouTubeDashboard() {
  $('yt-dashboard-wrap').innerHTML = '<p class="hint">Loading your YouTube Channel Dashboard...</p>';
  try {
    const d = await api('/api/youtube/dashboard');
    const ch = d.channel;
    const ins = d.insights;

    $('yt-dashboard-wrap').innerHTML = `
      <div class="dash-header">
        ${ch.avatar ? `<img class="dash-avatar" src="${ch.avatar}" alt="${ch.title}" />` : ''}
        <div>
          <div style="font-weight:800; font-size:1.15rem;">${ch.title} ${ch.customUrl ? `<span class="muted">(${ch.customUrl})</span>` : ''}</div>
          <div class="muted">Channel ID: ${ch.id}</div>
        </div>
      </div>
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">Subscribers</div><div class="kpi-val">${ch.subscribers.toLocaleString()}</div></div>
        <div class="kpi-card"><div class="kpi-label">Total Channel Views</div><div class="kpi-val">${ch.views.toLocaleString()}</div></div>
        <div class="kpi-card"><div class="kpi-label">Total Videos</div><div class="kpi-val">${ch.videoCount.toLocaleString()}</div></div>
        <div class="kpi-card"><div class="kpi-label">Avg Views (Recent)</div><div class="kpi-val">${ins.avgViewsRecent.toLocaleString()}</div></div>
        <div class="kpi-card"><div class="kpi-label">To 1,000 Subs</div><div class="kpi-val">${ins.subsRemaining1000.toLocaleString()} left</div></div>
      </div>
      <h3 style="margin:8px 0 10px; font-size:0.95rem;">Recent Uploads &amp; Live Streams</h3>
      <div class="recent-list">
        ${
          d.recentVideos.length === 0
            ? '<p class="muted">No public/unlisted videos found yet.</p>'
            : d.recentVideos
                .map(
                  (v) => `
              <div class="recent-card">
                ${v.thumbnail ? `<img src="${v.thumbnail}" alt="${v.title}" />` : ''}
                <div class="recent-card-body">
                  <div style="font-weight:700; margin-bottom:4px;">${v.title}</div>
                  <div class="muted">${v.views.toLocaleString()} views • ${v.likes} likes • ${v.comments} comments</div>
                </div>
              </div>`
                )
                .join('')
        }
      </div>
    `;

    $('yt-reach-output').textContent =
      `HOW TO GET REACH FASTER ON YOUR CHANNEL:\n` +
      ins.fastReachActions.map((a, i) => `${i + 1}. ${a}`).join('\n') +
      `\n\nCONTENT UPDATE PROPERTIES (USE ON EVERY UPLOAD):\n` +
      `• Title Formula: ${ins.contentProperties.titleFormula}\n` +
      `• Best Schedule: ${ins.contentProperties.bestPostingCadence}\n` +
      `• Recommended Tags: ${ins.contentProperties.recommendedTags.join(', ')}\n\n` +
      `• Description Structure:\n${ins.contentProperties.descriptionTemplate}`;

    await loadStatus();
  } catch (err) {
    $('yt-dashboard-wrap').innerHTML = `<div class="console-box">${err.message}</div>`;
  }
}

$('btn-upload-yt').addEventListener('click', async () => {
  const val = $('push-file-select').value;
  if (!val) {
    $('push-output').textContent = 'Select a video first.';
    return;
  }
  const [folder, fileName] = val.split('|');
  $('push-output').textContent = 'Uploading 4K Short to YouTube...';
  try {
    const fd = new FormData();
    fd.append('folder', folder);
    fd.append('fileName', fileName);
    fd.append('title', $('push-title').value);
    fd.append('description', $('push-desc').value);
    fd.append('liveStreamUrl', $('push-live-url').value);
    fd.append('tags', $('push-tags').value);
    fd.append('privacyStatus', $('push-privacy').value);
    if ($('push-schedule').value) {
      fd.append('publishAt', $('push-schedule').value);
    }
    const thumbFile = $('push-thumb-file').files[0];
    if (thumbFile) fd.append('thumbnail', thumbFile);

    const data = await api('/api/youtube/upload', { method: 'POST', body: fd });
    $('push-output').textContent = data.publishAt
      ? `Scheduled! URL: ${data.url} (Publishes at ${new Date(data.publishAt).toLocaleString()})`
      : `Uploaded! URL: ${data.url} (${data.privacyStatus})`;
  } catch (err) {
    $('push-output').textContent = `Error: ${err.message}`;
  }
});

// Init
loadStatus();
refreshMediaLists();
loadYouTubeDashboard();
