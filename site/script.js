const canvas = document.getElementById("beatCanvas");
const ctx = canvas.getContext("2d");

const beats = [0.08, 0.18, 0.32, 0.46, 0.58, 0.71, 0.84, 0.94];
const onsets = [0.12, 0.27, 0.34, 0.51, 0.66, 0.78, 0.89];

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
  drawMarkers(beats, width, height, "#ff3048", 96, 154);
  drawMarkers(onsets, width, height, "#21d5ff", 198, 254);

  const playheadX = playhead * width;
  ctx.strokeStyle = "#72ff63";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(playheadX, 30);
  ctx.lineTo(playheadX, height - 42);
  ctx.stroke();

  ctx.fillStyle = "#f2f5f7";
  ctx.font = "700 18px Consolas, monospace";
  ctx.fillText("song.wav -> beat JSON", 28, 44);

  ctx.fillStyle = "#9da9b5";
  ctx.font = "14px Consolas, monospace";
  ctx.fillText("tempo: 120.0    mode: grid/onsets    output: Resources/Music", 28, 70);

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

draw();
