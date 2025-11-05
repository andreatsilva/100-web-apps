let audioCtx;
let audioBuffer;
let source;
let analyser;
let dataArray;
let bufferLength;
let eqNodes = [];
const eqFrequencies = [60, 170, 350, 1000, 3500];
const audioFileInput = document.getElementById('audioFile');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

audioFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const arrayBuffer = await file.arrayBuffer();
  audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  setupAudioGraph();
});

playBtn.addEventListener('click', () => {
  if (!audioBuffer) return;
  if (source) source.stop();
  setupAudioGraph();
  source.start();
  drawVisualizer();
});

pauseBtn.addEventListener('click', () => {
  if (source) source.stop();
});

function setupAudioGraph() {
  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;

  // EQ
  eqNodes = eqFrequencies.map(freq => {
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = freq;
    filter.Q.value = 1;
    filter.gain.value = 0;
    return filter;
  });

  // Connect EQ nodes in series
  source.connect(eqNodes[0]);
  for (let i = 0; i < eqNodes.length - 1; i++) {
    eqNodes[i].connect(eqNodes[i + 1]);
  }

  // Analyser
  analyser = audioCtx.createAnalyser();
  eqNodes[eqNodes.length - 1].connect(analyser);
  analyser.connect(audioCtx.destination);
  analyser.fftSize = 256;
  bufferLength = analyser.frequencyBinCount;
  dataArray = new Uint8Array(bufferLength);

  // Bind sliders
  eqNodes.forEach((node, i) => {
    const slider = document.getElementById(`eq${i}`);
    slider.oninput = () => node.gain.value = parseFloat(slider.value);
  });
}

function drawVisualizer() {
  requestAnimationFrame(drawVisualizer);
  analyser.getByteFrequencyData(dataArray);

  ctx.fillStyle = '#121212';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const barWidth = (canvas.width / bufferLength) * 2.5;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const barHeight = dataArray[i];
    ctx.fillStyle = `rgb(${barHeight + 100}, 255, 200)`;
    ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
    x += barWidth + 1;
  }
}
