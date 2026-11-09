// Prints aggregate model tokens and estimated API costs from the local JSONL ledger.

import { loadServerConfig } from "../server/config";
import { CostLedger } from "../server/CostLedger";

function getLectureId(): string | null
{
    const index = process.argv.indexOf("--lecture-id");
    return index < 0 ? null : process.argv[index + 1] ?? null;
}

const config = loadServerConfig();
const ledger = new CostLedger(config.costLedgerPath);

void ledger.summarize(getLectureId()).then((summary) =>
{
    console.log(JSON.stringify(summary, null, 4));
}).catch((error: unknown) =>
{
    console.error(error instanceof Error ? error.message : "Could not summarize tutor costs.");
    process.exitCode = 1;
});
