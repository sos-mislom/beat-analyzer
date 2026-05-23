const canvas = document.getElementById("beatCanvas");
const ctx = canvas.getContext("2d");

const demoBeats = [0.08, 0.18, 0.32, 0.46, 0.58, 0.71, 0.84, 0.94];
const demoOnsets = [0.12, 0.27, 0.34, 0.51, 0.66, 0.78, 0.89];

const audioFileInput = document.getElementById("audioFile");
const analysisModeSelect = document.getElementById("analysisMode");
const targetDensityInput = document.getElementById("targetDensity");
const analyzeButton = document.getElementById("analyzeButton");
const analysisStatus = document.getElementById("analysisStatus");
const tempoStat = document.getElementById("tempoStat");
const beatCountStat = document.getElementById("beatCountStat");
const durationStat = document.getElementById("durationStat");
const jsonOutput = document.getElementById("jsonOutput");
const copyButton = document.getElementById("copyButton");
const downloadButton = document.getElementById("downloadButton");

let generatedJson = "";
let generatedFilename = "beat-map.json";

function draw() {
  const width = canvas.width;
  const height = canvas.height;
  const now = performance.now() * 0.001;
  const playhead = (now * 0.22) % 1;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b0d10";
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 42; i += 1) {
    const x = i * (width / 41);
    ctx.strokeStyle = i % 4 === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  drawWave(width, height, now);
  drawMarkers(demoBeats, width, height, "#ff3048", 96, 154);
  drawMarkers(demoOnsets, width, height, "#21d5ff", 198, 254);

  const playheadX = playhead * width;
  ctx.strokeStyle = "#72ff63";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(playheadX, 30);
  ctx.lineTo(playheadX, height - 42);
  ctx.stroke();

  ctx.fillStyle = "#f2f5f7";
  ctx.font = "700 18px Consolas, monospace";
  ctx.fillText("audio file -> beat JSON", 28, 44);

  ctx.fillStyle = "#9da9b5";
  ctx.font = "14px Consolas, monospace";
  ctx.fillText("mp3/wav    mode: grid/onsets    output: Unity Resources", 28, 70);

  requestAnimationFrame(draw);
}

function drawWave(width, height, now) {
  ctx.strokeStyle = "rgba(255, 210, 63, 0.72)";
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let x = 0; x <= width; x += 5) {
    const t = x / width;
    const amp =
      Math.sin((t * 12 + now * 0.9) * Math.PI * 2) * 24 +
      Math.sin((t * 31 - now * 0.4) * Math.PI * 2) * 9 +
      Math.sin((t * 5 + now * 0.2) * Math.PI * 2) * 18;
    const y = height * 0.5 + amp;
    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
}

function drawMarkers(values, width, height, color, y1, y2) {
  values.forEach((value, index) => {
    const x = value * width;
    const pulse = 1 + Math.sin(performance.now() * 0.006 + index) * 0.08;
    ctx.strokeStyle = color;
    ctx.lineWidth = 5 * pulse;
    ctx.beginPath();
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillRect(x - 5, y2 + 10, 10, 10);
  });
}

audioFileInput?.addEventListener("change", () => {
  const file = audioFileInput.files?.[0];
  const label = document.querySelector(".file-picker span:last-child");
  if (file && label) {
    label.textContent = file.name;
  }
});

analyzeButton?.addEventListener("click", async () => {
  const file = audioFileInput.files?.[0];
  if (!file) {
    setStatus("Choose an audio file first.");
    return;
  }

  try {
    setStatus(`Decoding ${file.name}...`);
    analyzeButton.disabled = true;
    const buffer = await decodeAudioFile(file);
    const mode = analysisModeSelect.value;
    const targetDensity = Number.parseFloat(targetDensityInput.value) || 2.0;
    setStatus(`Analyzing ${formatSeconds(buffer.duration)} of audio...`);

    await yieldToBrowser();
    const result = analyzeAudioBuffer(buffer, mode, targetDensity, file.name);
    generatedJson = JSON.stringify(result, null, 2);
    generatedFilename = `${stripExtension(file.name)}_${mode === "grid" ? "auto" : "onsets"}.json`;

    jsonOutput.value = generatedJson;
    tempoStat.textContent = result.tempo.toFixed(2);
    beatCountStat.textContent = result.beats.length.toString();
    durationStat.textContent = formatSeconds(result.duration);
    setStatus(`Done. Generated ${result.beats.length} timing points.`);
  } catch (error) {
    console.error(error);
    setStatus(`Could not analyze file: ${error.message || error}`);
  } finally {
    analyzeButton.disabled = false;
  }
});

copyButton?.addEventListener("click", async () => {
  if (!generatedJson) {
    setStatus("Analyze a file first.");
    return;
  }

  await navigator.clipboard.writeText(generatedJson);
  setStatus("JSON copied to clipboard.");
});

downloadButton?.addEventListener("click", () => {
  if (!generatedJson) {
    setStatus("Analyze a file first.");
    return;
  }

  const blob = new Blob([generatedJson], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = generatedFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus(`Downloaded ${generatedFilename}.`);
});

async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Web Audio API is not available in this browser.");
  }

  const audioContext = new AudioContextClass();
  const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  await audioContext.close();
  return decoded;
}

function analyzeAudioBuffer(buffer, mode, targetDensity, sourceName) {
  const audio = downmixToMono(buffer);
  const sampleRate = buffer.sampleRate;
  const duration = buffer.duration;
  const hopSize = 512;
  const frameSize = 2048;
  const { times, envelope } = onsetEnvelope(audio, sampleRate, frameSize, hopSize);
  const onsets = detectOnsets(times, envelope);

  if (mode === "onsets") {
    return analyzeOnsetsMode(onsets, duration, targetDensity, sourceName);
  }

  const interval = estimateInterval(times, envelope);
  const offset = chooseOffset(onsets, interval, duration, times, envelope);
  const beats = generateGrid(offset, interval, duration);
  const tempo = interval > 0 ? 60 / interval : 0;

  return {
    tempo,
    beats,
    duration: round(duration, 3),
    analysisMode: "grid",
    analysis: {
      source: "site/script.js",
      input: sourceName,
      interval,
      offset,
      onsetCount: onsets.length,
      strongOnsets: onsets
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 64)
        .map((item) => round(item.time, 3)),
      note: "Browser analyzer uses a lightweight time-domain onset envelope."
    }
  };
}

function analyzeOnsetsMode(onsets, duration, targetDensity, sourceName) {
  if (onsets.length === 0) {
    return {
      tempo: 0,
      beats: [],
      duration: round(duration, 3),
      analysisMode: "raw",
      analysis: {
        source: "site/script.js",
        input: sourceName,
        mode: "onsets",
        onsetCount: 0
      }
    };
  }

  const targetCount = Math.max(1, Math.min(onsets.length, Math.round(duration * targetDensity)));
  const strongest = onsets.slice().sort((a, b) => b.score - a.score).slice(0, targetCount);
  const beats = strongest.map((item) => round(item.time, 3)).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < beats.length; i += 1) {
    const gap = beats[i] - beats[i - 1];
    if (gap > 0) {
      gaps.push(gap);
    }
  }
  const medianGap = median(gaps);
  const tempo = medianGap > 0 ? 60 / medianGap : 0;

  return {
    tempo,
    beats,
    duration: round(duration, 3),
    analysisMode: "raw",
    analysis: {
      source: "site/script.js",
      input: sourceName,
      mode: "onsets",
      targetDensity,
      onsetCount: onsets.length,
      selectedOnsetCount: beats.length,
      medianGap,
      note: "Browser analyzer uses a lightweight time-domain onset envelope."
    }
  };
}

function downmixToMono(buffer) {
  const length = buffer.length;
  const channelCount = buffer.numberOfChannels;
  const audio = new Float32Array(length);
  for (let channel = 0; channel < channelCount; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      audio[i] += data[i] / channelCount;
    }
  }
  return audio;
}

function onsetEnvelope(audio, sampleRate, frameSize, hopSize) {
  const frameCount = Math.max(1, Math.floor((audio.length - frameSize) / hopSize) + 1);
  const rms = new Float32Array(frameCount);
  const high = new Float32Array(frameCount);
  const envelope = new Float32Array(frameCount);
  const times = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize;
    let sumSquares = 0;
    let sumDiff = 0;
    let previous = audio[start] || 0;

    for (let i = 0; i < frameSize; i += 1) {
      const sample = audio[start + i] || 0;
      sumSquares += sample * sample;
      sumDiff += Math.abs(sample - previous);
      previous = sample;
    }

    rms[frame] = Math.sqrt(sumSquares / frameSize);
    high[frame] = sumDiff / frameSize;
    times[frame] = start / sampleRate;
  }

  const rmsFlux = positiveDiff(rms);
  const highFlux = positiveDiff(high);
  const normalizedRms = normalize(rmsFlux);
  const normalizedHigh = normalize(highFlux);

  for (let i = 0; i < frameCount; i += 1) {
    envelope[i] = normalizedRms[i] * 1.15 + normalizedHigh[i] * 0.85;
  }

  smoothInPlace(envelope, 2);
  normalizeMaxInPlace(envelope);
  return { times, envelope };
}

function positiveDiff(values) {
  const result = new Float32Array(values.length);
  for (let i = 1; i < values.length; i += 1) {
    result[i] = Math.max(0, values[i] - values[i - 1]);
  }
  return result;
}

function normalize(values) {
  const array = Array.from(values);
  const center = median(array);
  const deviations = array.map((value) => Math.abs(value - center));
  const deviation = median(deviations) + 1e-6;
  const result = new Float32Array(values.length);

  for (let i = 0; i < values.length; i += 1) {
    result[i] = Math.max(0, (values[i] - center) / deviation);
  }

  normalizeMaxInPlace(result);
  return result;
}

function smoothInPlace(values, radius) {
  const copy = new Float32Array(values);
  for (let i = 0; i < values.length; i += 1) {
    let sum = 0;
    let weightSum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const index = i + offset;
      if (index < 0 || index >= values.length) {
        continue;
      }
      const weight = radius + 1 - Math.abs(offset);
      sum += copy[index] * weight;
      weightSum += weight;
    }
    values[i] = sum / weightSum;
  }
}

function normalizeMaxInPlace(values) {
  let max = 0;
  for (const value of values) {
    if (value > max) {
      max = value;
    }
  }
  if (max <= 0) {
    return;
  }
  for (let i = 0; i < values.length; i += 1) {
    values[i] /= max;
  }
}

function detectOnsets(times, envelope) {
  if (envelope.length < 3) {
    return [];
  }

  const dt = Math.max(0.001, times[1] - times[0]);
  const minDistance = Math.max(1, Math.round(0.115 / dt));
  const threshold = Math.max(0.18, percentile(Array.from(envelope), 70));
  const onsets = [];
  let lastPeak = -minDistance;

  for (let i = 1; i < envelope.length - 1; i += 1) {
    const value = envelope[i];
    if (value < threshold || value < envelope[i - 1] || value < envelope[i + 1]) {
      continue;
    }

    if (i - lastPeak < minDistance) {
      if (onsets.length > 0 && value > onsets[onsets.length - 1].strength) {
        onsets.pop();
      } else {
        continue;
      }
    }

    const localStart = Math.max(0, i - minDistance);
    const localEnd = Math.min(envelope.length - 1, i + minDistance);
    let localFloor = value;
    for (let j = localStart; j <= localEnd; j += 1) {
      localFloor = Math.min(localFloor, envelope[j]);
    }
    const prominence = value - localFloor;
    if (prominence < 0.06) {
      continue;
    }

    onsets.push({
      time: times[i],
      strength: value,
      prominence,
      score: value + prominence
    });
    lastPeak = i;
  }

  return onsets;
}

function estimateInterval(times, envelope, minBpm = 70, maxBpm = 205) {
  if (envelope.length < 4) {
    return 60 / 120;
  }

  const dt = Math.max(0.001, times[1] - times[0]);
  const mean = Array.from(envelope).reduce((sum, value) => sum + value, 0) / envelope.length;
  const centered = Array.from(envelope, (value) => value - mean);
  const minLag = Math.max(1, Math.round((60 / maxBpm) / dt));
  const maxLag = Math.min(centered.length - 1, Math.round((60 / minBpm) / dt));

  let bestLag = minLag;
  let bestCorrelation = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    for (let i = 0; i < centered.length - lag; i += 1) {
      correlation += centered[i] * centered[i + lag];
    }
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  const autocorrInterval = bestLag * dt;
  const candidates = new Set();
  for (const multiplier of [0.5, 2 / 3, 1.0, 1.5, 2.0]) {
    const candidate = autocorrInterval * multiplier;
    if (60 / maxBpm <= candidate && candidate <= 60 / minBpm) {
      candidates.add(round(candidate, 5));
    }
  }

  for (let bpm = minBpm; bpm <= maxBpm; bpm += (maxBpm - minBpm) / 420) {
    candidates.add(round(60 / bpm, 5));
  }

  return scoreIntervals(times, envelope, Array.from(candidates).sort((a, b) => a - b));
}

function scoreIntervals(times, envelope, candidates) {
  const duration = times.length ? times[times.length - 1] : 0;
  if (duration <= 0 || candidates.length === 0) {
    return 60 / 120;
  }

  let bestInterval = candidates[0];
  let bestScore = -Infinity;
  for (const interval of candidates) {
    const { score } = bestGridScore(times, envelope, interval, duration);
    const densityBias = Math.sqrt(0.5 / interval);
    const adjustedScore = score * clamp(densityBias, 0.85, 1.18);
    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestInterval = interval;
    }
  }

  return bestInterval;
}

function bestGridScore(times, envelope, interval, duration) {
  let bestScore = -Infinity;
  let bestOffset = 0;
  const offsetSteps = 64;

  for (let step = 0; step < offsetSteps; step += 1) {
    const offset = (interval * step) / offsetSteps;
    const values = [];
    for (let t = offset; t < duration; t += interval) {
      values.push(interpolate(times, envelope, t));
    }
    if (values.length < 2) {
      continue;
    }
    const score = mean(values) * 0.7 + percentile(values, 75) * 0.3;
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }

  return { score: bestScore, offset: bestOffset };
}

function chooseOffset(onsets, interval, duration, times, envelope) {
  const { offset: gridOffset } = bestGridScore(times, envelope, interval, duration);
  if (!onsets.length || interval <= 0) {
    return gridOffset;
  }

  let sin = 0;
  let cos = 0;
  for (const onset of onsets) {
    const phase = ((onset.time % interval) / interval) * Math.PI * 2;
    const weight = Math.max(0.05, onset.score);
    sin += Math.sin(phase) * weight;
    cos += Math.cos(phase) * weight;
  }

  let phase = Math.atan2(sin, cos);
  if (phase < 0) {
    phase += Math.PI * 2;
  }
  let onsetOffset = (phase / (Math.PI * 2)) * interval;
  let offset = onsetOffset;

  if (circularDistance(gridOffset, onsetOffset, interval) < interval * 0.22) {
    offset = gridOffset;
  }

  const early = onsets.filter((item) => item.time < Math.min(4.0, duration));
  if (early.length) {
    const strongest = early.slice().sort((a, b) => b.score - a.score)[0];
    const strongestPhase = strongest.time % interval;
    if (circularDistance(strongestPhase, offset, interval) < interval * 0.18) {
      offset = strongestPhase;
    }
  }

  return offset;
}

function generateGrid(offset, interval, duration) {
  const beats = [];
  if (interval <= 0 || duration <= 0) {
    return beats;
  }

  let t = offset;
  while (t > 0) {
    t -= interval;
  }
  while (t < 0) {
    t += interval;
  }
  while (t <= duration + interval * 0.25) {
    beats.push(round(Math.max(0, t), 3));
    t += interval;
  }

  return beats;
}

function interpolate(xs, ys, x) {
  if (x <= xs[0]) {
    return ys[0];
  }
  for (let i = 1; i < xs.length; i += 1) {
    if (x <= xs[i]) {
      const alpha = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] * (1 - alpha) + ys[i] * alpha;
    }
  }
  return ys[ys.length - 1];
}

function circularDistance(a, b, period) {
  const raw = Math.abs(a - b);
  return Math.min(raw, period - raw);
}

function mean(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) {
    return 0;
  }
  return percentile(values, 50);
}

function percentile(values, p) {
  if (!values.length) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const index = (sorted.length - 1) * (p / 100);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  const alpha = index - lower;
  return sorted[lower] * (1 - alpha) + sorted[upper] * alpha;
}

function round(value, digits) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stripExtension(filename) {
  return filename.replace(/\.[^.]+$/, "");
}

function formatSeconds(seconds) {
  return `${Number(seconds).toFixed(2)}s`;
}

function setStatus(message) {
  analysisStatus.textContent = message;
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

draw();
