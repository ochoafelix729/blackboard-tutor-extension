chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        // Only log requests from the top-level player, excluding embedded frames.
        if (details.tabId >= 0 && details.frameId === 0 && details.initiator)
        {
            try
            {
                const initiator = new URL(details.initiator)
                if (initiator.origin === "https://uark.class.com")
                {
                    console.log(details);

                    void chrome.scripting.executeScript({
                        target: { tabId: details.tabId, frameIds: [0] },
                        func: () => {
                            const attachDownloadButton = () => {
                                const toolbar = document.querySelector(".ClassActionBar-measure");
                                if (!toolbar || toolbar.querySelector('[data-actionbar-item="tutor-download"]')) return;

                                const item = document.createElement("div");
                                item.className = "ClassActionBarItem-root";
                                item.dataset.actionbarItem = "tutor-download";

                                const button = document.createElement("button");
                                button.type = "button";
                                button.textContent = "Download";
                                button.style.cssText = `
                                    padding: 12px;
                                    background: transparent;
                                    color: inherit;
                                    border: 0;
                                    cursor: pointer;
                                    font: inherit;
                                `;

                                button.addEventListener("click", () => {
                                    console.log("Download clicked");
                                    // Trigger your download here.
                                });

                                item.append(button);

                                // Insert beside Chat, Participants, and Transcript, before the spacer.
                                const spacer = toolbar.querySelector("#gap-item");
                                toolbar.insertBefore(item, spacer);
                            };

                            attachDownloadButton();

                            // Keep watching: the player may render or replace the toolbar later.
                            const tutorWindow = window as Window & {
                                __tutorToolbarObserver?: MutationObserver;
                            };
                            if (!tutorWindow.__tutorToolbarObserver) {
                                tutorWindow.__tutorToolbarObserver = new MutationObserver(attachDownloadButton);
                                tutorWindow.__tutorToolbarObserver.observe(document.documentElement, {
                                    childList: true,
                                    subtree: true,
                                });
                            }

                            // placeholder -  sidebar
                            if (document.getElementById("tutor-sidebar")) return;

                            const style = document.createElement("style");
                            style.textContent = `
                                html {
                                    width: calc(100% - 320px) !important;
                                }

                                #tutor-sidebar {
                                    position: fixed;
                                    top: 0;
                                    right: 0;
                                    width: 320px;
                                    height: 100vh;
                                    box-sizing: border-box;
                                    padding: 20px;
                                    overflow: auto;
                                    background: white;
                                    color: #222;
                                    border-left: 1px solid #ddd;
                                    font: 16px system-ui;
                                    z-index: 2147483647;
                                }
                            `;

                            const sidebar = document.createElement("aside");
                            sidebar.id = "tutor-sidebar";
                            sidebar.textContent = "Lecture tutor";

                            document.head.append(style);
                            document.documentElement.append(sidebar);
                        },
                    }).catch(console.error);
                }
            }
            catch (error)
            {
                console.error("Request handler failed:", error);
                return;
            }
        }
        else
        {
            return;
        }
    },
    {
        urls: ["https://*.class.com/*"],
        types: ["media", "xmlhttprequest", "other"]
    }
);
