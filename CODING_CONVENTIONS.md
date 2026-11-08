# Blackboard Tutor Extension — Coding Conventions

> **Status:** Project-wide development standard   
> **Priority:** Follow this document when writing or modifying project code. If an external format or JavaScript/TypeScript grammar conflicts with a convention, follow the required syntax and keep the exception as narrow as possible.

## 1. Core rules (non-negotiable)

1. **Write TypeScript, not hand-written JavaScript.** Use `.ts` and `.tsx` for application code. JavaScript is acceptable only where an actual tooling/runtime constraint requires it. Compiled `.js` files are expected output and do not count as hand-written JavaScript.
2. **Use four spaces per indentation level.** Use actual spaces, **never tab characters**. Keep indentation consistent inside all blocks, objects, arrays, and multiline expressions.
3. **Use curly braces for every control-flow body**, including single-line `if`, `else`, `for`, `while`, `do`, and other control-flow branches. Never omit braces as a shortcut.
4. **Use Allman-style braces whenever JavaScript/TypeScript syntax permits:** put the opening `{` on its own line at the indentation level of the statement, with the closing `}` on its own line.
5. **Use camelCase for all project-controlled identifiers**, including variables, constants, functions, parameters, properties, interfaces, types, classes, enums, and source filenames. Never introduce snake_case or SCREAMING_SNAKE_CASE identifiers. Names dictated by browser APIs, external services, existing third-party schemas, or required configuration formats are exceptions; translate them at the boundary when possible.
6. **Keep function syntax consistent:** prefer named `function` declarations for reusable, standalone functions; use arrow functions for inline callbacks and functions intentionally passed as values; use method syntax for object and class methods.
7. **Preserve correctness, type safety, and readability above stylistic uniformity** when a language feature cannot express the preferred layout.

## 2. Indentation and whitespace

Indent with **4 spaces**, never tabs. Nested blocks add 4 more spaces each.

```ts
function handleLecture(lectureId: string): void
{
    if (lectureId.length > 0)
    {
        console.log(lectureId);
    }
}
```

- Use one statement per line and a final newline at the end of every file.
- Do not align code using groups of spaces that break under renaming; indent by logical nesting.
- Do not use trailing commas in multiline object, array, parameter, and argument lists.
- Use semicolons to terminate statements.
- Use double quotes for ordinary string literals and backticks for interpolation.

## 3. Curly braces and control flow

**Required layout:**

```ts
if (isLectureReady)
{
    openTutor();
}
else if (isProcessing)
{
    showProgress();
}
else
{
    startProcessing();
}

for (const segment of segments)
{
    indexSegment(segment);
}

while (hasPendingWork())
{
    processNextJob();
}

try
{
    await loadLecture();
}
catch (error)
{
    reportError(error);
}
finally
{
    releaseResources();
}
```

**Do not write:**

```ts
if (isLectureReady) openTutor();
if (isLectureReady)
    openTutor();
if (isLectureReady) { openTutor(); }
```

`switch` blocks should use the same brace style; use braces around each `case` body if it declares block-scoped variables or benefits from independent scope.

```ts
switch (status)
{
    case 'ready':
    {
        openTutor();
        break;
    }
    case 'processing':
    {
        showProgress();
        break;
    }
    default:
    {
        showUnavailable();
    }
}
```

## 4. Function declaration conventions

Use a **named function declaration** for a reusable top-level function. This is the preferred default, including for asynchronous work.

```ts
function getLectureId(url: URL): string | null
{
    return url.searchParams.get('recordingId');
}

async function loadLecture(lectureId: string): Promise<void>
{
    await fetchLectureMetadata(lectureId);
}
```

Use an **arrow function** for inline callbacks, event listeners, and other functions passed directly as values. Give callbacks braces even if they contain just one statement.

```ts
chrome.downloads.onChanged.addListener((delta) =>
{
    handleDownloadChange(delta);
});

const readyLectures = lectures.filter((lecture) =>
{
    return lecture.isReady;
});
```

Use **method syntax** inside classes and object literals; do not arbitrarily alternate method declarations and function-valued properties.

```ts
class lectureStore
{
    async load(lectureId: string): Promise<void>
    {
        await this.fetchIndex(lectureId);
    }

    private async fetchIndex(lectureId: string): Promise<void>
    {
        // Implementation.
    }
}
```

Avoid assigning named functions to `const` unless you have a concrete need for a function value or lexical `this`:

```ts
// Avoid for ordinary reusable helpers:
const getLectureId = (url: URL): string | null =>
{
    return url.searchParams.get('recordingId');
};
```

Prefer explicit return types on exported functions, async functions, and public methods. Let TypeScript infer obvious local variable types.

## 5. camelCase naming — everywhere under our control

Use camelCase even for names that are customarily PascalCase or uppercase in other TypeScript codebases. **This is a deliberate project preference.**

| Item | Required example | Avoid |
|---|---|---|
| Variable | `lectureId` | `lecture_id` |
| Constant | `maxRetryCount` | `MAX_RETRY_COUNT` |
| Function | `processLecture` | `process_lecture` |
| Parameter | `recordingUrl` | `recording_url` |
| Property / method | `isReady`, `getStatus` | `is_ready`, `GetStatus` |
| Interface / type alias | `lectureMetadata`, `processingStatus` | `LectureMetadata`, `processing_status` |
| Class / enum | `lectureStore`, `jobStatus` | `LectureStore`, `JOB_STATUS` |
| TS source filename | `lectureProcessor.ts` | `lecture_processor.ts` |

For abbreviations, preserve natural camelCase: `apiClient`, `videoUrl`, `httpRequest`, `userId` rather than `APIClient`, `videoURL`, or `userID`.

```ts
interface lectureMetadata
{
    lectureId: string;
    durationSeconds: number;
    isIndexed: boolean;
}

type processingStatus = 'pending' | 'processing' | 'ready' | 'failed';

const maxRetryCount = 3;
```

### Boundaries and exceptions

Some names must remain unchanged for interoperability. Examples include `manifest.json`, `tsconfig.json`, Chrome API property names such as `tabId`, externally defined JSON keys, HTTP headers, and provider-defined request/response fields. Do not corrupt an external contract just to rename a field.

When an external API uses snake_case, map it **immediately** to a camelCase internal type. For example:

```ts
type providerResponse =
{
    lecture_id: string;
    duration_seconds: number;
};

interface lectureMetadata
{
    lectureId: string;
    durationSeconds: number;
}

function normalizeProviderResponse(source: providerResponse): lectureMetadata
{
    return {
        lectureId: source.lecture_id,
        durationSeconds: source.duration_seconds,
    };
}
```

The external field names above are required wire-format exceptions, **not** permission to introduce snake_case in project-owned identifiers. If we control an API's schema, use camelCase in the schema too.

## 6. Syntax exceptions to Allman-style braces

Allman style applies to blocks, but JavaScript/TypeScript also uses braces for object expressions, destructuring, import/export lists, type constructs, and embedded expressions. Favor readability and grammatical correctness rather than forcing every `{` onto a new line.

**Object literals:** Multiline objects may use an opening brace after `=` or `return`; keep fields consistently indented.

```ts
const requestOptions = {
    lectureId,
    includeTranscript: true,
};

function getRequestOptions(lectureId: string): { lectureId: string }
{
    return {
        lectureId,
    };
}
```

**Important:** Never put a newline between `return` and its value. JavaScript automatic semicolon insertion can turn that into `return;` and cause incorrect behavior.

**Arrow functions:** The arrow and opening brace must be part of one arrow-function expression; the preferred callback layout is shown above: `(...) =>` then `{` on the next line.

**Imports, destructuring, JSX/TSX expressions, template interpolation, and TypeScript type literals** can use their conventional grammar-friendly formatting. Do not compromise valid syntax to enforce a cosmetic brace position.

## 7. TypeScript-first and runtime boundaries

- Enable strict TypeScript checking for new project configurations (`strict: true`), and progressively fix pre-existing code when changing the compiler configuration.
- Prefer `unknown` to `any` for values received from network messages, DOM queries, storage, and third-party APIs. Validate before accessing fields.
- Use discriminated unions for processing states where it makes invalid states harder to represent.
- Avoid non-null assertions (`!`) unless the invariant is documented and enforced.
- Treat extension content scripts, the background service worker, and future API/backend components as separate trust boundaries.
- Keep browser globals such as `chrome` in extension-only modules; do not assume they are available in generic scripts or any future server code.
- Distinguish source (`.ts`/`.tsx`) from compiled output (`.js`); edit the TypeScript source and regenerate output rather than editing generated files.
- If a tool explicitly requires a JavaScript configuration file or bootstrap script, keep it minimal and document why `.ts` cannot be used there.
- Prefer explicit module imports/exports and avoid global-scope collisions.

## 8. Async operations, failures, and logging

Use `async`/`await` for ordinary promise-based flows. Catch errors where recovery or meaningful reporting is possible, not merely to hide them.

```ts
async function initializeLecture(lectureId: string): Promise<void>
{
    try
    {
        await startLectureProcessing(lectureId);
    }
    catch (error)
    {
        console.error('Failed to initialize lecture', { lectureId, error });
        throw error;
    }
}
```

- Avoid silent `catch` blocks.
- Never log passwords, access tokens, signed media URLs, or full lecture contents by default.
- For asynchronous pipeline work, use predictable error states, retries where safe, and idempotent operations.
- Keep log fields camelCase when controlled by the project.

## 9. File organization and maintainability

- Prefer focused modules with one clear responsibility (lecture detection, media downloads, sidebar UI, message handling, transcript indexing, etc.).
- Prefer camelCase TypeScript filenames such as `lectureDetector.ts`, `downloadManager.ts`, and `sidebarController.ts`.
- Keep interfaces/types near the domain code that owns them; extract shared types only when genuinely reused.
- Do not add an abstraction, service, or new model integration simply because it may be useful later.
- Preserve the extension's existing functionality when refactoring; add tests for new behavior where practicable.
- Keep Chrome-extension-specific behavior distinct from model-provider and backend logic.

## 10. Tests and code-review expectations

Every contribution, whether written by a person or an AI assistant, should satisfy the following checklist:

- [ ] New application code is TypeScript unless a documented constraint requires JavaScript.
- [ ] Indentation uses **four spaces**, with **zero tab characters**.
- [ ] Every control-flow branch/body uses braces, including one-liners.
- [ ] Block braces use **Allman style** where grammatically permitted.
- [ ] All project-owned identifiers use camelCase, including types, classes, constants, and filenames.
- [ ] Standalone reusable functions use named declarations; callbacks use arrow functions; object/class methods use method syntax.
- [ ] External API naming exceptions are confined to integration boundaries.
- [ ] TypeScript errors, lint failures, and related tests are addressed.
- [ ] No secrets, sensitive URLs, or user lecture content are accidentally logged or committed.
- [ ] Generated JavaScript is regenerated from source, not manually edited.

## 11. Suggested automated enforcement

Use ESLint with `@typescript-eslint` to enforce brace requirements, explicit naming conventions, and consistent function syntax. Add a formatter or linter that supports **Allman brace style**; do not assume default Prettier formatting is compatible, because Prettier normally places statement opening braces on the same line.

Suggested checks to configure and test before making them CI-blocking:

- Four-space indentation and no hard tabs.
- `curly: ['error', 'all']` for mandatory braces.
- A naming-convention rule requiring camelCase for project-owned names, including `typeLike` constructs (with narrowly scoped external-format exceptions).
- Rules discouraging function expressions for reusable function declarations, while allowing inline arrow callbacks.
- TypeScript compiler in `noEmit` mode for type checking, plus lints and project tests.

**Do not install or change linting/formatting tools blindly.** Verify that they can produce and preserve Allman braces, including for `else`, `catch`, and `finally`, and document any unavoidable syntax-specific exceptions. Until tooling is configured, these documented conventions are the authoritative review standard.