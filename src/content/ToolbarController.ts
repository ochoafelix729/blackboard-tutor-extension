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

    private attach(): void
    {
        const toolbar = document.querySelector(toolbarSelector);

        if (toolbar === null)
        {
            return;
        }

        this.attachButton(toolbar, "download", "Download", () =>
        {
            this.callbacks.onDownload();
        });
        this.attachButton(toolbar, "tutor", "Tutor", () =>
        {
            this.callbacks.onToggleTutor();
        });
        this.updateDownloadButton();
    }

    private attachButton(
        toolbar: Element,
        action: "download" | "tutor",
        label: string,
        listener: () => void
    ): void
    {
        if (toolbar.querySelector(`[${itemAttribute}="${action}"]`) !== null)
        {
            return;
        }

        const item = document.createElement("div");
        item.className = "ClassActionBarItem-root";
        item.setAttribute(itemAttribute, action);

        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.setAttribute("aria-label", action === "download" ? "Download lecture recording" : "Toggle lecture tutor");
        button.style.cssText = [
            "padding: 12px",
            "background: transparent",
            "color: inherit",
            "border: 0",
            "cursor: pointer",
            "font: inherit"
        ].join(";");
        button.addEventListener("click", () =>
        {
            listener();
        });

        item.append(button);
        const spacer = toolbar.querySelector("#gap-item");
        toolbar.insertBefore(item, spacer);
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
