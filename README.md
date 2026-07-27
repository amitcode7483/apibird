# apibird 🐦

A lightweight **REST client for VS Code** — send API requests and inspect responses without leaving your editor. Think Postman / Thunder Client, but minimal and yours.

Set a method, URL, headers, and a JSON body, hit **Send**, and get back the status, timing, size, response headers, and a pretty-printed body.

## ✨ Features

- Request methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`
- Editable request **headers** (add/remove key-value rows)
- JSON request **body** for write requests
- Response view with **status, response time, and payload size**
- Pretty-printed JSON responses, plus a separate **response headers** tab
- Errors (bad URL, network failure, non-2xx) rendered clearly
- Runs the request in the extension host (Node), so it's **not subject to browser CORS**
- UI themed with native VS Code colors — blends into your editor

## 🖼️ Preview

![apibird sending a request in VS Code](docs/screenshot.png)

> `GET https://jsonplaceholder.typicode.com/todos/1` → `200 OK · 62 ms`

## 🚀 Getting started (development)

Requires [Node.js](https://nodejs.org/) 18+ and VS Code.

```bash
git clone https://github.com/amitcode7483/apibird.git
cd apibird
npm install
```

Then open the folder in VS Code and press **F5** to launch the Extension Development Host.
In the new window:

1. Open the Command Palette (`Cmd/Ctrl + Shift + P`)
2. Run **REST Tester: Open**
3. Enter a URL and hit **Send**

## 🧱 How it works

- **`src/extension.ts`** — registers the command, creates the webview panel, and makes the actual HTTP call via Node's `fetch` (no CORS).
- The **webview** is the UI; it talks to the extension host through `postMessage`. The host performs the request and posts the response back to be rendered.

## 🗺️ Roadmap

- [ ] Save requests and request history
- [ ] Environment variables (`{{baseUrl}}`, tokens)
- [ ] Auth helpers (Bearer, Basic)
- [ ] Form-data / file bodies
- [ ] Package and publish to the VS Code Marketplace

## 📄 License

MIT
