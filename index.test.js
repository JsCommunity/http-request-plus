"use strict";

const { createServer } = require("node:http");
const { describe, it, before, after } = require("test");
const { gzipSync } = require("node:zlib");
const { Readable } = require("node:stream");
const assert = require("node:assert/strict");

const httpRequestPlus = require("./index.js");
const readStream = require("./_readStream.js");

const fromEventMethod = (emitter, method, ...args) =>
  new Promise((resolve, reject) => {
    emitter[method](...args, resolve);
    emitter.on("error", reject);
  });

const getErrorEvent = (emitter) =>
  new Promise((resolve) => emitter.once("error", resolve));

function handleRequest(req, res) {
  const event = req.url;

  if (this.listenerCount(event) === 0) {
    res.statusCode = 404;
    res.end("Not Found");
  } else {
    this.emit(event, req, res);
  }
}

async function rejectionOf(promise) {
  try {
    throw await promise;
  } catch (error) {
    return error;
  }
}

describe("httpRequestPlus", function () {
  // helper wich resolves the URL against the test HTTP server
  function req(url, opts) {
    if (typeof url === "object") {
      opts = url;
      url = undefined;
    }
    if (url === undefined) {
      url = "/";
    }
    return httpRequestPlus(new URL(url, httpUrl), opts);
  }

  // helper which adds a request handler to the test HTTP server and returns
  // the promise of the handler, which must be awaited when there are some
  // tests on the server side
  function onReq(path, cb) {
    if (typeof path === "function") {
      cb = path;
      path = "/";
    }

    return new Promise((resolve, reject) => {
      httpServer.once(path, function () {
        try {
          resolve(cb.apply(this, arguments));
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  let httpServer;
  let httpUrl;
  before(async function () {
    httpServer = createServer(handleRequest);

    await fromEventMethod(httpServer, "listen", 0, "localhost");

    const { address, port } = httpServer.address();
    httpUrl = `http://[${address}]:${port}`;
  });

  after(function () {
    return fromEventMethod(httpServer, "close");
  });

  function testResponseHelpers(response) {
    assert.equal(typeof response.buffer, "function");
    assert.equal(typeof response.json, "function");
    assert.equal(typeof response.text, "function");
  }

  describe("on connection error", function () {
    it("rejects if error before response", async function () {
      onReq((req) => req.destroy());

      const error = await rejectionOf(req());
      assert.equal(error.code, "ECONNRESET");
      assert.equal(error.response, undefined);
    });

    it("emits error event on response if error after response", async function () {
      onReq((req, res) => {
        res.flushHeaders();
        res.destroy();
      });

      const response = await req();

      const error = await getErrorEvent(response);
      assert.equal(error.code, "ECONNRESET");
    });
  });

  describe("on abortion", function () {
    it("rejects if error before response", async function () {
      const controller = new AbortController();

      onReq(() => controller.abort());

      const error = await rejectionOf(req({ signal: controller.signal }));
      assert.equal(error.code, "ABORT_ERR");
      assert.equal(error.response, undefined);
    });

    it("emits error event on response if error after response", async function () {
      const controller = new AbortController();

      onReq((req, res) => res.flushHeaders());

      const response = await req({ signal: controller.signal });

      const pError = getErrorEvent(response);
      controller.abort();

      const error = await pError;
      assert.equal(error.code, "ABORT_ERR");
    });
  });

  describe("plain body", function () {
    it("accepts a string to send alongside the request", async function () {
      await Promise.all([
        onReq(async (req, res) => {
          res.end();

          assert.equal(String(await new Promise(readStream.bind(req))), "foo");
        }),
        req({ body: "foo" }),
      ]);
    });

    it("adds content-length if missing", async function () {
      // example taken from https://nodejs.org/api/buffer.html#static-method-bufferbytelengthstring-encoding
      await Promise.all([
        onReq(async (req, res) => {
          res.end();

          assert.equal(+req.headers["content-length"], 12);
        }),
        req({ body: "\u00bd + \u00bc = \u00be" }),
      ]);
    });
  });

  describe("stream body", function () {
    it("accepts a stream to send alongside the request", async function () {
      const body = new Readable({
        read() {
          this.push("foo");
          this.push(null);
        },
      });

      await Promise.all([
        onReq(async (req, res) => {
          res.end();

          assert.equal(String(await new Promise(readStream.bind(req))), "foo");
        }),
        req({ body, method: "post" }),
      ]);
    });

    it("adds content-length if missing and the length is known", async function () {
      onReq("/input", (req, res) => res.end("foo"));
      const body = await req("/input");

      await Promise.all([
        onReq(async (req, res) => {
          res.end();

          assert.equal(+req.headers["content-length"], 3);
        }),
        req({ body }),
      ]);
    });

    it("rejects if error in request body before response", async function () {
      const body = new Readable({ read() {} });
      const promise = req({ body });
      const error = new Error();
      body.destroy(error);
      assert.equal(await rejectionOf(promise), error);
    });

    it("emits error event on response if error in request body after response", async function () {
      const body = new Readable({ read() {} });
      onReq((req, res) => res.flushHeaders());
      const response = await req({
        body,
        // trigger immediate sending of request
        headers: { expect: "100-continue" },
      });
      const error = new Error();
      body.destroy(error);
      assert.equal(await getErrorEvent(response), error);
    });
  });

  it("no duplicate errors on req error after response", async function () {
    const body = new Readable({ read() {} });
    onReq((req, res) => res.flushHeaders());
    const response = await req({
      body,
      // trigger immediate sending of request
      headers: { expect: "100-continue" },
    });

    let nErrors = 0;
    response.on("error", () => ++nErrors);

    const pError = getErrorEvent(response);
    response.req.destroy(new Error());
    await pError;

    assert.equal(nErrors, 1);
  });

  it("errors if the status is not 2xx", async function () {
    onReq((req, res) => {
      res.statusCode = 404;
      res.end();
    });

    const error = await rejectionOf(req());
    assert.equal(error.message, "404 Not Found");
    assert.equal(error.response.statusCode, 404);
    testResponseHelpers(error.response);
  });

  describe("bypassStatusCheck option", function () {
    it("prevents error if the status is not 2xx", async function () {
      onReq((req, res) => {
        res.statusCode = 404;
        res.end();
      });

      const response = await req({ bypassStatusCheck: true });
      assert.equal(response.statusCode, 404);
    });
  });

  describe("decompress option", function () {
    it("changes default accept-encoding", async function () {
      await Promise.all([
        onReq((req, res) => {
          assert.equal(req.headers["accept-encoding"], "gzip, deflate, br");

          res.end();
        }),
        req({ decompress: true }),
      ]);
    });

    const value = ["foo", "bar"];
    const text = JSON.stringify(value);
    const encoded = gzipSync(text);
    for (const [helper, result] of [
      ["buffer", Buffer.from(text)],
      ["json", value],
      ["text", text],
    ]) {
      it(`makes ${helper} decompress response`, async function () {
        onReq((req, res) => {
          res.setHeader("content-encoding", "gzip");

          res.end(encoded);
        });

        assert.deepEqual(
          await (await req({ decompress: true }))[helper](),
          result
        );
      });
    }
  });

  describe("maxRedirects options", function () {
    // create n endpoints, named from /<n> to /1 which redirects from /<n - 1> to /
    function setUpRedirects(n, code) {
      return Array.from({ length: n }, (_, i) =>
        onReq("/" + (i + 1), (req, res) => {
          res.statusCode = code;
          res.setHeader("location", i === 0 ? "/" : "/" + i);
          res.end();
        })
      );
    }

    it("follows redirects", async function () {
      setUpRedirects(1, 302);
      onReq((req, res) => res.end("Ok"));

      const response = await req("/1");
      assert.equal(await response.text(), "Ok");
    });

    it("changes method to GET and removes body", async function () {
      setUpRedirects(1, 303);

      await Promise.all([
        onReq(async (req, res) => {
          res.end();

          assert.equal(req.method, "GET");
          assert.equal(req.headers["content-length"], undefined);
          assert.equal(String(await new Promise(readStream.bind(req))), "");
        }),
        req("/1", { body: "foo", method: "POST" }),
      ]);
    });

    for (const code of [302, 307, 308]) {
      it(
        "does not change method and remove body if code is " + code,
        async function () {
          setUpRedirects(1, code);

          await Promise.all([
            onReq(async (req, res) => {
              res.end();

              assert.equal(req.method, "POST");
              assert.equal(+req.headers["content-length"], 3);
              assert.equal(
                String(await new Promise(readStream.bind(req))),
                "foo"
              );
            }),
            req("/1", { body: "foo", method: "POST" }),
          ]);
        }
      );
    }

    it("can be set to 0 to disable redirects handling", async function () {
      setUpRedirects(1, 302);

      const error = await rejectionOf(req("/1", { maxRedirects: 0 }));
      assert.equal(error.message, "302 Found");
      assert.equal(error.response.statusCode, 302);
      testResponseHelpers(error.response);
    });
  });

  describe("timeout option", function () {
    it("errors if no data has been transfered after a delay", async function () {
      onReq((req, res) => {});

      const error = await rejectionOf(req({ timeout: 10 }));
      assert.equal(error.message, "HTTP connection has timed out");
      assert.equal(error.url, httpUrl + "/");
    });
  });

  describe(".buffer()", function () {
    it("returns the response content in a buffer", async function () {
      const value = "foo bar";

      onReq((req, res) => res.end(value));

      assert.deepEqual(await (await req()).buffer(), Buffer.from(value));
    });
  });

  describe(".decompress()", function () {
    it("returns the response if not encoded", async function () {
      onReq((req, res) => res.end());

      const response = await req();
      assert.equal(response.decompress(), response);
    });

    for (const [encoding, base64] of [
      ["br", "CwOAZm9vIGJhcgM="],
      ["deflate", "eJxLy89XSEosAgAKcAKa"],
      ["gzip", "H4sIAAAAAAAAA0vLz1dISiwCADQBRr4HAAAA"],
    ]) {
      it("supports " + encoding, async function () {
        onReq((req, res) => {
          res.setHeader("content-encoding", encoding);
          res.end(Buffer.from(base64, "base64"));
        });

        assert.deepEqual(
          await new Promise(readStream.bind((await req()).decompress())),
          Buffer.from("foo bar")
        );
      });
    }

    it("thows if encoding is not supported", async function () {
      onReq((req, res) => {
        res.setHeader("content-encoding", "foo");
        res.end();
      });

      const response = await req();
      assert.throws(() => response.decompress(), {
        message: "unsupported encoding foo",
      });
    });
  });

  describe(".json()", function () {
    it("returns the response content parsed as JSON", async function () {
      const value = { foo: "bar" };

      onReq((req, res) => res.end(JSON.stringify(value)));

      assert.deepEqual(await (await req()).json(), value);
    });
  });

  describe(".text()", function () {
    it("returns the response content parsed as text", async function () {
      const value = "Hello world";

      onReq((req, res) => res.end(value));

      assert.equal(await (await req()).text(), value);
    });
  });
});
