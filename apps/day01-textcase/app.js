const textarea = document.getElementById("input");
const buttons = document.querySelectorAll("[data-action]");
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

function toTitleCase(str) {
    return str.toLowerCase().replace(/\b\w/g, (c) => caches.ToUpperCase());

}
function toSentenceCase(str) {
    return str.charAt(0).ToUpperCase() + str.slice(1).toLowerCase();
}
function toCamel(str){
    return str
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.ToUpperCase());
}
function toSnake(str){
    return str
    .toLowerCase()
    .replace(/\s+/g, '_');
}
function toKebab(str){
    return str
    .toLowerCase()
    .replace(/\s+/g, '-');
}

const actions = {
    upper: (t) => t.toUpperCase(),
    lower: (t) => t.toLowerCase,
    title:  toTitleCase,
    sentence: toSentenceCase,
    camel: toCamel,
    snake: toSnake,
    kebab: toKebab,

};

buttons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const action = btn.getAttribute("data-action");
    const text = textarea.value;

    const transformations = {
      upper: () => text.toUpperCase(),
      lower: () => text.toLowerCase(),
      title: () =>
        text.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
      sentence: () =>
        text.charAt(0).toUpperCase() + text.slice(1).toLowerCase(),
      camel: () =>
        text
          .toLowerCase()
          .replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase()),
      snake: () =>
        text.toLowerCase().replace(/\s+/g, "_"),
      kebab: () =>
        text.toLowerCase().replace(/\s+/g, "-"),
    };

    textarea.value = transformations[action]();
  });
});
