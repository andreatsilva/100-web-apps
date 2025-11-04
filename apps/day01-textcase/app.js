const input = document.getElementById("input");
const output = document.getElementById("output");
const buttons = doccument.getElementById(".btn");

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
        const text = input.value;
        const result = actions[action](text);
        output.value = result;
    });
});