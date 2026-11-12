// Declares the Markdown math plugin's interface for the sidebar renderer.

declare module "markdown-it-texmath"
{
    import type MarkdownIt from "markdown-it";

    const texmath: MarkdownIt.PluginWithOptions<{
        engine: typeof import("katex");
        delimiters: string[];
        katexOptions: import("katex").KatexOptions;
    }>;
    export default texmath;
}
