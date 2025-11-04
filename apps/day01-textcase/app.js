const textarea = document.getElementById("input");
const buttons = document.querySelectorAll("[data-action]");

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
