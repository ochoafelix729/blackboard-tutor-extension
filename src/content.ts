// Starts the tutor UI when the UARK recording player's action bar has rendered.

import { LectureController } from "./content/LectureController";

function startWhenReady(): void
{
    if (document.querySelector(".ClassActionBar-measure") !== null)
    {
        new LectureController().start();
        return;
    }

    const observer = new MutationObserver(() =>
    {
        if (document.querySelector(".ClassActionBar-measure") !== null)
        {
            observer.disconnect();
            new LectureController().start();
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

startWhenReady();
