const textarea = document.getElementById("inputText");
const buttons = document.querySelectorAll(".tool-btn");
const statsPanel = document.getElementById("statsPanel");

function updateStats() {
  const text = textarea.value;

  const characters = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length).length;
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length).length;
  const readingTime = (words / 200).toFixed(2);

  statsPanel.innerHTML = `
    ${statBlock("Characters", characters, characters / 1000)}
    ${statBlock("Words", words, words / 500)}
    ${statBlock("Sentences", sentences, sentences / 100)}
    ${statBlock("Paragraphs", paragraphs, paragraphs / 50)}
    ${statBlock("Reading time (min)", readingTime, readingTime / 10)}
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

buttons.forEach(btn =>
  btn.addEventListener("click", () => {
    let text = textarea.value;

    switch (btn.dataset.action) {
      case "upper": text = text.toUpperCase(); break;
      case "lower": text = text.toLowerCase(); break;
      case "capitalize": text = text.replace(/\b\w/g, c => c.toUpperCase()); break;
      case "sentence": text = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase(); break;
      case "copy":
        navigator.clipboard.writeText(text);
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = "Copy Text"), 1000);
        return;
    }

    textarea.value = text;
    updateStats();
  })
);

textarea.addEventListener("input", updateStats);
updateStats();
