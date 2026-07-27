# REST Tester

A lightweight Postman / Thunder Client–style REST client for VS Code.
Method + URL + dynamic headers + JSON body → sends via Node `fetch` (no CORS) and
renders status, time, size, response headers, and a pretty-printed body.

## Run it (dev mode)

```bash
npm install
```

Then open the folder in VS Code and press **F5** ("Run Extension").
A new VS Code window opens with the extension loaded. In it:

- Open the Command Palette (`Cmd/Ctrl+Shift+P`)
- Run **REST Tester: Open**

## Project layout

- `src/extension.ts` — activation, the webview panel, and the HTTP call (extension host = Node, so no CORS)
- `package.json` — extension manifest (command + activation)
- `.vscode/` — F5 debug + build task

## Where to take it next

- Persist request history / collections via `context.globalState`
- Save collections to a `.http`-style file in the workspace
- Environment variables (`{{baseUrl}}`) with find/replace before send
- Auth helpers (Bearer, Basic), form-data / file bodies
- Package to a `.vsix`: `npm i -g @vscode/vsce && vsce package`
