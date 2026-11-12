// Renders tutor answers as Markdown with accessible LaTeX mathematics.

import katex from "katex";
import MarkdownIt from "markdown-it";
import texmath from "markdown-it-texmath";

const markdown = new MarkdownIt({
    html: false,
    breaks: true
}).use(texmath, {
    engine: katex,
    delimiters: ["dollars", "brackets"],
    katexOptions: {
        output: "mathml",
        throwOnError: false,
        trust: false
    }
});

export function renderAnswer(text: string): HTMLElement
{
    const container = document.createElement("div");
    container.className = "answer-text";
    container.innerHTML = markdown.render(text);
    return container;
}
