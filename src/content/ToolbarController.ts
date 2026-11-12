// Adds resilient tutor and download controls to the Class.com action bar.

export interface ToolbarCallbacks
{
    onDownload(): void;
    onToggleTutor(): void;
}

const toolbarSelector = ".ClassActionBar-measure";
const itemAttribute = "data-blackboard-tutor-action";

export class ToolbarController
{
    private readonly callbacks: ToolbarCallbacks;
    private readonly observer: MutationObserver;
    private canDownload = false;

    constructor(callbacks: ToolbarCallbacks)
    {
        this.callbacks = callbacks;
        this.observer = new MutationObserver(() =>
        {
            this.attach();
        });
    }

    start(): void
    {
        this.installStyles();
        this.attach();
        this.observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    setCanDownload(canDownload: boolean): void
    {
        this.canDownload = canDownload;
        this.updateDownloadButton();
    }

    private installStyles(): void
    {
        if (document.getElementById("blackboard-tutor-toolbar-styles") !== null)
        {
            return;
        }

        const style = document.createElement("style");
        style.id = "blackboard-tutor-toolbar-styles";
        style.textContent = `
            [data-blackboard-tutor-action] button {
                border-radius: 4px;
            }

            [data-blackboard-tutor-action] button:not(:disabled):hover {
                background-color: #4c4c50 !important;
            }

            [data-blackboard-tutor-action] button:focus-visible {
                outline: 2px solid #dedede;
                outline-offset: -2px;
            }
        `;
        (document.head ?? document.documentElement).append(style);
    }

    private attach(): void
    {
        const toolbar = document.querySelector(toolbarSelector);

        if (toolbar === null)
        {
            return;
        }

        let group = toolbar.querySelector('[data-blackboard-tutor-group]');

        if (group === null)
        {
            group = document.createElement("div");
            group.setAttribute("data-blackboard-tutor-group", "");
            (group as HTMLElement).style.cssText = "display: inline-flex; align-items: center; flex: 0 0 auto;";
            this.attachButton(group, "download", "Download", () =>
            {
                this.callbacks.onDownload();
            });
            this.attachButton(group, "tutor", "Tutor", () =>
            {
                this.callbacks.onToggleTutor();
            });
            toolbar.insertBefore(group, toolbar.querySelector("#gap-item"));
        }

        this.updateDownloadButton();
    }

    private attachButton(
        group: Element,
        action: "download" | "tutor",
        label: string,
        listener: () => void
    ): void
    {
        const item = document.createElement("div");
        item.setAttribute(itemAttribute, action);

        const button = document.createElement("button");
        button.type = "button";
        button.style.cssText = [
            "display: flex",
            "flex-direction: column",
            "align-items: center",
            "justify-content: center",
            "gap: 6px",
            "padding: 10px 16px 6px",
            "background: transparent",
            "color: #dedede",
            "border: 0",
            "font: inherit",
            "font-size: 14px",
            "line-height: 1.2",
            "white-space: nowrap",
            "cursor: pointer"
        ].join(";");
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("viewBox", "0 0 24 24");
        icon.setAttribute("width", "24");
        icon.setAttribute("height", "24");
        icon.setAttribute("fill", "currentColor");
        icon.setAttribute("aria-hidden", "true");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", action === "download"
            ? "M5 20h14v-2H5v2zm7-3 5-5-1.41-1.41L13 13.17V3h-2v10.17l-2.59-2.58L7 12l5 5z"
            : "M12 3 1 9l11 6 9-4.91V17h2V9L12 3zm-6 9.73V17l6 3.27L18 17v-4.27l-6 3.27-6-3.27z");
        icon.append(path);
        const text = document.createElement("span");
        text.textContent = label;
        button.append(icon, text);
        button.setAttribute("aria-label", action === "download" ? "Download lecture recording" : "Toggle lecture tutor");
        button.addEventListener("click", () =>
        {
            listener();
        });

        item.append(button);
        group.append(item);
    }

    private updateDownloadButton(): void
    {
        const item = document.querySelector(`[${itemAttribute}="download"]`);
        const button = item?.querySelector("button");

        if (button instanceof HTMLButtonElement)
        {
            button.disabled = !this.canDownload;
            button.title = this.canDownload
                ? "Download the detected lecture recording"
                : "Start lecture playback so the recording can be detected";
            button.style.opacity = this.canDownload ? "1" : "0.55";
            button.style.cursor = this.canDownload ? "pointer" : "not-allowed";
        }
    }
}
