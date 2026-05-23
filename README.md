# Unity Beat Analyzer

Small Python tool that analyzes WAV files and generates beat-map JSON files for Unity rhythm mechanics.

The output format is intentionally simple:

```json
{
  "tempo": 120.0,
  "beats": [0.12, 0.62, 1.12],
  "duration": 95.4,
  "analysisMode": "grid"
}
```

## Features

- Reads mono or stereo `.wav` files.
- Detects onset energy in low, body, bright and full-spectrum bands.
- Supports two output modes:
  - `grid`: estimates tempo, offset and exports a regular beat grid.
  - `onsets`: exports strongest transient moments directly.
- Can analyze one WAV file or all WAV files inside a folder.
- Produces UTF-8 JSON compatible with Unity `TextAsset` loading.

## Install

Requires Python 3.10+.

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

On macOS/Linux:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Usage

Analyze one file with a regular grid:

```bash
python beat_analyzer.py path/to/song.wav --mode grid --suffix _auto
```

Analyze one file as raw onsets:

```bash
python beat_analyzer.py path/to/song.wav --mode onsets --target-density 2.0 --suffix _onsets
```

Analyze every `.wav` in a folder:

```bash
python beat_analyzer.py path/to/music-folder --mode onsets --suffix _onsets --overwrite
```

The generated JSON is written next to the WAV file:

```text
song.wav
song_onsets.json
```

## Unity Integration

Place generated JSON files under a Unity `Resources` path, for example:

```text
Assets/Resources/Music/MyTrack/MyTrack_onsets.json
```

Then load it as a `TextAsset` and deserialize fields:

- `tempo`
- `beats`
- `duration`
- `analysisMode`
- `analysis`

The original ADHD prototype used this layout:

```text
Assets/Resources/Music/<TrackName>/<TrackName>_onsets.json
```

## Output Modes

### grid

Best when the track has a clear tempo and you want deterministic beat timing.

The analyzer estimates:

- tempo
- beat interval
- offset
- regular beat positions

### onsets

Best when the track has irregular hits, breaks, vocal chops or active percussion.

The analyzer selects the strongest transient moments. `--target-density` controls how many events per second are kept.

## Notes

- The tool currently supports WAV input only.
- For MP3/OGG, convert to WAV first.
- If the beat feels late or early in-game, adjust the generated JSON offset or Unity-side beat offset.
- Generated beat maps may still need manual review for final game feel.

## License

MIT
