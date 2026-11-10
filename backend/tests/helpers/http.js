const { createServer } = require("node:http");
const { once } = require("node:events");

async function createHttpClient(appOrServer) {
  const ownsServer = typeof appOrServer === "function";
  const server = ownsServer ? createServer(appOrServer) : appOrServer;

  if (ownsServer) {
    const listening = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await listening;
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("O cliente HTTP de teste precisa de um servidor TCP em execução.");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let closing;

  return {
    baseUrl,
    async request(method, path, { token, headers, query, json, body } = {}) {
      const url = new URL(path, baseUrl);
      if (url.origin !== baseUrl) throw new Error("Use somente URLs da API local de teste.");
      for (const [key, value] of new URLSearchParams(query)) {
        url.searchParams.append(key, value);
      }

      const requestHeaders = new Headers(headers);
      if (token !== undefined) requestHeaders.set("Authorization", `Bearer ${token}`);
      if (json !== undefined) {
        if (body !== undefined) throw new Error("Envie apenas json ou body.");
        requestHeaders.set("Content-Type", "application/json");
        body = JSON.stringify(json);
      }
      const response = await fetch(url, {
        method, headers: requestHeaders, body, redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
      const responseHeaders = Object.fromEntries(response.headers);
      const contentType = responseHeaders["content-type"] ?? "";
      const bytes = Buffer.from(await response.arrayBuffer());
      const isJson = /\bjson\b/i.test(contentType);
      const isText = isJson || /^text\//i.test(contentType);
      const text = isText || bytes.length === 0 ? bytes.toString("utf8") : undefined;
      return {
        status: response.status,
        headers: responseHeaders,
        body: isJson && text ? JSON.parse(text) : text ?? bytes,
        text,
      };
    },
    async close() {
      if (!ownsServer) return;
      closing ??= new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
      await closing;
    },
  };
}

module.exports = { createHttpClient };
