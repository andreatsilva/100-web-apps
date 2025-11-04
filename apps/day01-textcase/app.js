const textarea = document.getElementById("input");
const buttons = document.querySelectorAll("[data-action]");
const statsPanel = document.getElementById("statsPanel");
const fancyBtn = document.getElementById("fancyBtn");
const copyBtn = document.getElementById("copyBtn");
let fancyIndex = 0;
let originalText = "";



copyBtn.addEventListener("click", async () => {
  const text = textarea.value;
  if (!text.trim()) return;

  await navigator.clipboard.writeText(text);

  copyBtn.innerText = "✅ Copied!";
  copyBtn.disabled = true;

  setTimeout(() => {
    copyBtn.innerText = "Copy";
    copyBtn.disabled = false;
  }, 1200);
});

// FANCY FONT MAPS
const fancyFonts = [
  { name: "Normal", map: t => t },
  { name: "Bold", map: t => replaceRange(t, 0x1d400, 0x1d41a) },
  { name: "Italic", map: t => replaceRange(t, 0x1d434, 0x1d44e) },
  { name: "Bold Italic", map: t => replaceRange(t, 0x1d468, 0x1d482) },
  { name: "Script", map: t => replaceRange(t, 0x1d49c, 0x1d4b6) },
  { name: "Bold Script", map: t => replaceRange(t, 0x1d4d0, 0x1d4ea) },
  { name: "Fraktur", map: t => replaceRange(t, 0x1d504, 0x1d51e) },
  { name: "Double Struck", map: t => replaceRange(t, 0x1d538, 0x1d552) },
  { name: "Monospace", map: t => replaceRange(t, 0x1d670, 0x1d68a) },
  { name: "Circled", map: circleText },
  { name: "Squared", map: squareText },
];

// Unicode mappers
function replaceRange(text, upperBase, lowerBase) {
  return text
    .replace(/[A-Z]/g, c =>
      String.fromCodePoint(c.charCodeAt(0) - 65 + upperBase)
    )
    .replace(/[a-z]/g, c =>
      String.fromCodePoint(c.charCodeAt(0) - 97 + lowerBase)
    );
}

function circleText(text) {
  return text.replace(/[a-z]/g, c =>
    String.fromCodePoint(c.charCodeAt(0) - 97 + 0x24d0)
  );
}

function squareText(text) {
  return text.replace(/[A-Z]/g, c =>
    String.fromCodePoint(c.charCodeAt(0) - 65 + 0x1f130)
  );
}

// ✅ Fancy Font Button
fancyBtn.addEventListener("click", () => {
  const text = textarea.value;
  if (!text.trim()) return;

  if (fancyIndex === 0) originalText = text;

  fancyIndex = (fancyIndex + 1) % fancyFonts.length;
  textarea.value = fancyFonts[fancyIndex].map(originalText);

  updateStats();
});


// CASE TRANSFORMS
buttons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const action = btn.getAttribute("data-action");
    const text = textarea.value;

    const transformations = {
      upper: () => text.toUpperCase(),
      lower: () => text.toLowerCase(),
      title: () => text.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()),
      sentence: () => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase(),
      camel: () => text.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase()),
      snake: () => text.toLowerCase().replace(/\s+/g, "_"),
      kebab: () => text.toLowerCase().replace(/\s+/g, "-"),
    };

    textarea.value = transformations[action]();
    updateStats();
  });
});

// 📊 Stats system stays the same
function formatReadingTime(words) {
  const wpm = 200;
  const minutes = Math.floor(words / wpm);
  const seconds = Math.round((words % wpm) / (wpm / 60));
  if (minutes === 0 && seconds === 0) return "< 1 sec";
  if (minutes === 0) return `${seconds} sec`;
  if (seconds === 0) return `${minutes} min`;
  return `${minutes} min ${seconds} sec`;
}

function updateStats() {
  const text = textarea.value;
  const characters = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length).length;
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length).length;
  const readingTime = formatReadingTime(words);

  statsPanel.innerHTML = `
    ${statBlock("Characters", characters, characters / 1000)}
    ${statBlock("Words", words, words / 500)}
    ${statBlock("Sentences", sentences, sentences / 100)}
    ${statBlock("Paragraphs", paragraphs, paragraphs / 50)}
    ${statBlock("Reading time (min)", readingTime, words / 2000)}
  `;
}

function statBlock(label, value, percent) {
  const width = Math.min(percent * 100, 100);
  return `
    <div>
      <p class="mb-1">${label}: <span class="font-semibold">${value}</span></p>
      <div class="w-full bg-gray-700 h-2 rounded">
        <div class="bg-blue-500 h-2 rounded" style="width:${width}%"></div>
      </div>
    </div>
  `;
}

// Auto-update stats
textarea.addEventListener("input", updateStats);
updateStats();
