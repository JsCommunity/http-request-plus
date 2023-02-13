"use strict";

const assert = require("node:assert/strict");
const execFile = require("node:util").promisify(
  require("node:child_process").execFile
);
const { createServer } = require("node:http");
const { createServer: createSecureServer } = require("node:https");
const { describe, it, before, after } = require("test");
const { Readable } = require("node:stream");

const hrp = require("./");

const fromEvent = (emitter, event) =>
  new Promise((resolve, reject) => {
    emitter.on(event, resolve);
    if (event !== "error") {
      emitter.on("error", reject);
    }
  });

const fromEventMethod = (emitter, method, ...args) =>
  new Promise((resolve, reject) => {
    emitter[method](...args, resolve);
    emitter.on("error", reject);
  });

function handleRequest(req, res) {
  this.emit(req.url, req, res);
}

async function rejectionOf(promise) {
  try {
    throw await promise;
  } catch (error) {
    return error;
  }
}

describe("httpRequestPlus", function () {
  function onReq(path, cb) {
    if (typeof path === "function") {
      cb = path;
      path = "/";
    }

    httpServer.once(path, cb);
  }

  let httpServer, httpsServer;
  let httpUrl, httpsUrl;
  before(async function () {
    httpServer = createServer(handleRequest);

    // generate a self-signed certificate
    const [, key, cert] =
      /^(-----BEGIN PRIVATE KEY-----.+-----END PRIVATE KEY-----\n)(-----BEGIN CERTIFICATE-----.+-----END CERTIFICATE-----\n)$/s.exec(
        (
          await execFile(
            "openssl",
            "req -batch -new -x509 -nodes -newkey rsa:2048 -keyout -".split(" ")
          )
        ).stdout
      );
    httpsServer = createSecureServer({ cert, key }, handleRequest);

    await Promise.all([
      fromEventMethod(httpServer, "listen", 0, "localhost").then(() => {
        const { address, port } = httpServer.address();
        httpUrl = `http://[${address}]:${port}`;
      }),
      fromEventMethod(httpsServer, "listen", 0, "localhost").then(() => {
        const { address, port } = httpsServer.address();
        httpsUrl = `https://[${address}]:${port}`;
      }),
    ]);
  });

  after(function () {
    return Promise.all([
      fromEventMethod(httpServer, "close"),
      fromEventMethod(httpsServer, "close"),
    ]);
  });

  describe("on connection error", function () {
    it("rejects if error before response", async function () {
      onReq((req, res) => {
        req.destroy();
      });

      const error = await rejectionOf(hrp(httpUrl));
      assert.equal(error.code, "ECONNRESET");
    });

    it("emits error event on response if error after response", async function () {
      onReq((req, res) => {
        res.flushHeaders();
        res.destroy();
      });

      const response = await hrp(httpUrl);

      const error = await fromEvent(response, "error");
      assert.equal(error.code, "ECONNRESET");
    });
  });

  describe("on abortion", function () {
    it("rejects if error before response", async function () {
      const controller = new AbortController();
      onReq((req, res) => {
        controller.abort();
      });
      const error = await rejectionOf(
        hrp(httpUrl, { signal: controller.signal })
      );
      assert.equal(error.code, "ABORT_ERR");
    });

    it("emits error event on response if error after response", async function () {
      const controller = new AbortController();
      onReq((req, res) => {
        res.flushHeaders();
        setInterval(() => {
          controller.abort();
          req.destroy();
          res.destroy();
        }, 10);
      });
      const response = await hrp(httpUrl, { signal: controller.signal });
      const error = await fromEvent(response, "error");
      assert.equal(error.code, "ABORT_ERR");
      response.destroy();
      response.req.destroy();
    });
  });

  describe("body option", function () {
    it("accepts a string to send alongside the request", async function () {
      onReq((req, res) => {
        res.flushHeaders();
      });
    });

    it("rejects if error in request body before response", async function () {
      const body = new Readable({ read() {} });

      const promise = hrp(httpUrl, { body });

      const error = new Error();
      body.destroy(error);

      assert.equal(await rejectionOf(promise), error);
    });

    it("emits error event on response if error in request body after response", async function () {
      const body = new Readable({ read() {} });

      onReq((req, res) => {
        res.flushHeaders();
      });

      const response = await hrp(httpUrl, {
        body,

        // trigger immediate sending of request
        headers: { expect: "100-continue" },
      });

      const error = new Error();
      body.destroy(error);

      assert.equal(await fromEvent(response, "error"), error);
    });
  });

  it("errors if the status is not 2xx", async function () {
    onReq((req, res) => {
      res.statusCode = 404;
      res.end();
    });

    const error = await rejectionOf(hrp(httpUrl));
    assert.equal(error.message, "404 Not Found");
    assert.equal(error.response.statusCode, 404);
  });

  describe("bypassStatusCheck option", function () {
    it("prevents error if the status is not 2xx", async function () {
      onReq((req, res) => {
        res.statusCode = 404;
        res.end();
      });

      const response = await hrp(httpUrl, { bypassStatusCheck: true });
      assert.equal(response.statusCode, 404);
    });
  });

  describe("timeout option", function () {
    it("errors if no data has been transfered after a delay", async function () {
      onReq((req, res) => {});

      const error = await rejectionOf(hrp(httpUrl, { timeout: 10 }));
      assert.equal(error.message, "HTTP connection has timed out");
    });
  });

  describe(".json()", function () {
    it("returns the response content parsed as JSON", async function () {
      const value = { foo: "bar" };

      onReq((req, res) => {
        res.end(JSON.stringify(value));
      });

      assert.deepEqual(await (await hrp(httpUrl)).json(), value);
    });
  });

  describe(".text()", function () {
    it("returns the response content parsed as text", async function () {
      const value = "Hello world";

      onReq((req, res) => {
        res.end(value);
      });

      assert.equal(await (await hrp(httpUrl)).text(), value);
    });
  });
});
