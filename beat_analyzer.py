import argparse
import json
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks


def read_mono_wav(path: Path):
    sample_rate, data = wavfile.read(path)

    if data.ndim > 1:
        data = data.mean(axis=1)

    if np.issubdtype(data.dtype, np.integer):
        max_value = np.iinfo(data.dtype).max
        data = data.astype(np.float32) / max_value
    else:
        data = data.astype(np.float32)

    return sample_rate, data


def frame_audio(audio: np.ndarray, frame_size: int, hop_size: int):
    if len(audio) < frame_size:
        padding = frame_size - len(audio)
        audio = np.pad(audio, (0, padding))

    frame_count = 1 + (len(audio) - frame_size) // hop_size
    shape = (frame_count, frame_size)
    strides = (audio.strides[0] * hop_size, audio.strides[0])
    return np.lib.stride_tricks.as_strided(audio, shape=shape, strides=strides).copy()


def band_flux(magnitude: np.ndarray, freqs: np.ndarray, low: float, high: float):
    mask = (freqs >= low) & (freqs < high)
    if not np.any(mask):
        return np.zeros(magnitude.shape[0], dtype=np.float32)

    band = np.log1p(magnitude[:, mask])
    diff = np.diff(band, axis=0, prepend=band[:1])
    return np.maximum(diff, 0).sum(axis=1)


def normalize(values: np.ndarray):
    values = values.astype(np.float32)
    values -= np.median(values)
    deviation = np.median(np.abs(values)) + 1e-6
    return np.maximum(values / deviation, 0)


def onset_envelope(sample_rate: int, audio: np.ndarray, frame_size: int = 2048, hop_size: int = 512):
    frames = frame_audio(audio, frame_size, hop_size)
    window = np.hanning(frame_size).astype(np.float32)
    spectrum = np.fft.rfft(frames * window, axis=1)
    magnitude = np.abs(spectrum)
    freqs = np.fft.rfftfreq(frame_size, 1.0 / sample_rate)

    low_flux = band_flux(magnitude, freqs, 35, 180)
    body_flux = band_flux(magnitude, freqs, 180, 2200)
    bright_flux = band_flux(magnitude, freqs, 2200, 9000)
    full_flux = band_flux(magnitude, freqs, 35, min(12000, sample_rate / 2))

    rms = np.sqrt(np.mean(frames * frames, axis=1))
    rms_diff = np.maximum(np.diff(rms, prepend=rms[:1]), 0)

    envelope = (
        normalize(low_flux) * 1.35
        + normalize(body_flux) * 0.9
        + normalize(bright_flux) * 0.65
        + normalize(full_flux) * 0.8
        + normalize(rms_diff) * 0.85
    )
    envelope = gaussian_filter1d(envelope, sigma=1.15)
    if envelope.max() > 0:
        envelope /= envelope.max()

    times = np.arange(len(envelope), dtype=np.float32) * hop_size / sample_rate
    return times, envelope


def detect_onsets(times: np.ndarray, envelope: np.ndarray):
    if len(envelope) == 0:
        return []

    height = max(0.18, float(np.percentile(envelope, 70)))
    distance = max(1, int(0.115 / max(times[1] - times[0], 0.001)))
    peaks, properties = find_peaks(
        envelope,
        height=height,
        distance=distance,
        prominence=0.08,
    )

    scored = []
    prominences = properties.get("prominences", np.ones(len(peaks)))
    for peak, prominence in zip(peaks, prominences):
        scored.append((float(times[peak]), float(envelope[peak]), float(prominence)))

    return scored


def estimate_interval(times: np.ndarray, envelope: np.ndarray, min_bpm: float = 70, max_bpm: float = 205):
    if len(envelope) < 4:
        return 60.0 / 120.0

    frame_dt = float(times[1] - times[0])
    centered = envelope - envelope.mean()
    autocorr = np.correlate(centered, centered, mode="full")[len(centered) - 1 :]

    min_lag = max(1, int((60.0 / max_bpm) / frame_dt))
    max_lag = min(len(autocorr) - 1, int((60.0 / min_bpm) / frame_dt))
    if max_lag <= min_lag:
        return 60.0 / 120.0

    segment = autocorr[min_lag:max_lag]
    best_lag = int(np.argmax(segment)) + min_lag
    autocorr_interval = best_lag * frame_dt

    candidates = set()
    for multiplier in (0.5, 2.0 / 3.0, 1.0, 1.5, 2.0):
        candidate = autocorr_interval * multiplier
        if 60.0 / max_bpm <= candidate <= 60.0 / min_bpm:
            candidates.add(round(float(candidate), 5))

    for bpm in np.linspace(min_bpm, max_bpm, 420):
        candidates.add(round(float(60.0 / bpm), 5))

    return score_intervals(times, envelope, sorted(candidates))


def score_intervals(times: np.ndarray, envelope: np.ndarray, candidates):
    duration = float(times[-1]) if len(times) else 0.0
    if duration <= 0 or not candidates:
        return 60.0 / 120.0

    best_interval = candidates[0]
    best_score = -1.0

    for interval in candidates:
        score, _ = best_grid_score(times, envelope, interval, duration)

        # Small bias toward denser playable pulses. Without this, busy tracks can
        # collapse into half-time or 3:2 grids that look mathematically valid but
        # feel late under the crosshair.
        density_bias = np.sqrt(0.5 / interval)
        score *= float(np.clip(density_bias, 0.85, 1.18))

        if score > best_score:
            best_score = score
            best_interval = interval

    return float(best_interval)


def best_grid_score(times: np.ndarray, envelope: np.ndarray, interval: float, duration: float):
    if interval <= 0:
        return 0.0, 0.0

    best_score = -1.0
    best_offset = 0.0
    offset_steps = 64

    for offset in np.linspace(0.0, interval, offset_steps, endpoint=False):
        grid = np.arange(offset, duration, interval)
        if len(grid) < 2:
            continue

        values = np.interp(grid, times, envelope)
        score = float(np.mean(values) * 0.7 + np.percentile(values, 75) * 0.3)

        if score > best_score:
            best_score = score
            best_offset = float(offset)

    return best_score, best_offset


def choose_offset(onsets, interval: float, duration: float, times=None, envelope=None):
    if times is not None and envelope is not None and interval > 0:
        _, grid_offset = best_grid_score(times, envelope, interval, duration)
    else:
        grid_offset = None

    if not onsets or interval <= 0:
        return grid_offset if grid_offset is not None else 0.0

    weighted_phases = []
    for onset_time, strength, prominence in onsets:
        phase = (onset_time % interval) / interval * np.pi * 2.0
        weight = max(0.05, strength + prominence)
        weighted_phases.append((phase, weight))

    sin = sum(np.sin(phase) * weight for phase, weight in weighted_phases)
    cos = sum(np.cos(phase) * weight for phase, weight in weighted_phases)
    phase = np.arctan2(sin, cos)
    if phase < 0:
        phase += np.pi * 2.0

    onset_offset = float(phase / (np.pi * 2.0) * interval)
    offset = onset_offset

    if grid_offset is not None:
        if circular_distance(grid_offset, onset_offset, interval) < interval * 0.22:
            offset = grid_offset

    # Snap offset to a strong early onset if it is close enough. This helps
    # songs with a short pickup feel better from the first shot.
    early = [item for item in onsets if item[0] < min(4.0, duration)]
    if early:
        strongest = max(early, key=lambda item: item[1] + item[2])
        strongest_phase = strongest[0] % interval
        if circular_distance(strongest_phase, offset, interval) < interval * 0.18:
            offset = strongest_phase

    return offset


def circular_distance(a: float, b: float, period: float):
    raw = abs(a - b)
    return min(raw, period - raw)


def generate_grid(offset: float, interval: float, duration: float):
    beats = []
    if interval <= 0 or duration <= 0:
        return beats

    t = offset
    while t > 0:
        t -= interval
    while t < 0:
        t += interval

    while t <= duration + interval * 0.25:
        beats.append(round(float(max(0.0, t)), 3))
        t += interval

    return beats


def analyze_wav(path: Path):
    sample_rate, audio = read_mono_wav(path)
    duration = len(audio) / sample_rate
    times, envelope = onset_envelope(sample_rate, audio)
    onsets = detect_onsets(times, envelope)
    interval = estimate_interval(times, envelope)
    offset = choose_offset(onsets, interval, duration, times, envelope)
    beats = generate_grid(offset, interval, duration)
    tempo = 60.0 / interval if interval > 0 else 0.0

    return {
        "tempo": tempo,
        "beats": beats,
        "duration": round(duration, 3),
        "analysisMode": "grid",
        "analysis": {
            "source": "Tools/beat_analyzer.py",
            "interval": interval,
            "offset": offset,
            "onsetCount": len(onsets),
            "strongOnsets": [
                round(item[0], 3)
                for item in sorted(onsets, key=lambda item: item[1] + item[2], reverse=True)[:64]
            ],
        },
    }


def analyze_wav_onsets(path: Path, target_density: float = 2.0):
    sample_rate, audio = read_mono_wav(path)
    duration = len(audio) / sample_rate
    times, envelope = onset_envelope(sample_rate, audio)
    onsets = detect_onsets(times, envelope)

    if not onsets:
        return {
            "tempo": 0.0,
            "beats": [],
            "duration": round(duration, 3),
            "analysisMode": "raw",
            "analysis": {
                "source": "Tools/beat_analyzer.py",
                "mode": "onsets",
                "onsetCount": 0,
            },
        }

    target_count = int(max(1, min(len(onsets), round(duration * target_density))))
    strongest = sorted(onsets, key=lambda item: item[1] + item[2], reverse=True)[:target_count]
    beats = sorted(round(float(item[0]), 3) for item in strongest)
    gaps = [b - a for a, b in zip(beats, beats[1:]) if b > a]
    median_gap = float(np.median(gaps)) if gaps else 0.0
    tempo = 60.0 / median_gap if median_gap > 0 else 0.0

    return {
        "tempo": tempo,
        "beats": beats,
        "duration": round(duration, 3),
        "analysisMode": "raw",
        "analysis": {
            "source": "Tools/beat_analyzer.py",
            "mode": "onsets",
            "targetDensity": target_density,
            "onsetCount": len(onsets),
            "selectedOnsetCount": len(beats),
            "medianGap": median_gap,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Generate Unity beat JSON from wav onset analysis.")
    parser.add_argument("paths", nargs="+", help="WAV files or folders to analyze.")
    parser.add_argument("--suffix", default="_auto", help="Suffix for generated JSON files.")
    parser.add_argument("--mode", choices=("grid", "onsets"), default="grid")
    parser.add_argument("--target-density", type=float, default=2.0, help="Onset mode target beats per second.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing generated files.")
    args = parser.parse_args()

    wav_paths = []
    for raw_path in args.paths:
        path = Path(raw_path)
        if path.is_dir():
            wav_paths.extend(sorted(path.rglob("*.wav")))
        elif path.suffix.lower() == ".wav":
            wav_paths.append(path)

    for wav_path in wav_paths:
        output_path = wav_path.with_name(wav_path.stem + args.suffix + ".json")
        if output_path.exists() and not args.overwrite:
            print(f"skip {output_path} (exists)")
            continue

        result = analyze_wav(wav_path) if args.mode == "grid" else analyze_wav_onsets(wav_path, args.target_density)
        output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        offset = result["analysis"].get("offset")
        offset_text = f", offset={offset:.3f}" if offset is not None else ""
        print(
            f"{wav_path}: mode={args.mode}, tempo={result['tempo']:.3f}, "
            f"beats={len(result['beats'])}{offset_text}, "
            f"onsets={result['analysis'].get('onsetCount', 0)} -> {output_path}"
        )


if __name__ == "__main__":
    main()
