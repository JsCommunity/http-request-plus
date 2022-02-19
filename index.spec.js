const assert = require("assert");
const { after, before, describe, it } = require("tap").mocha;
const { Cancel, CancelToken } = require("promise-toolbox");
const { createServer: createHttpServer } = require("http");
const { Readable } = require("stream");

const httpRequestPlus = require("./");

// ===================================================================

const freeStream = (s) =>
  new Promise((resolve, reject) => {
    s.on("end", resolve);
    s.on("error", reject);
    s.resume();
  });

const httpError = (res, code = 404, body = undefined) => {
  res.writeHead(code);
  res.end(body);
};

const redirect = (res, url) => {
  res.writeHead(307, {
    location: url,
  });
  res.end();
};

const rejectionOf = (p) =>
  p.then(
    (_) => {
      throw _;
    },
    (_) => _
  );

// ===================================================================

describe("httpRequestPlus", () => {
  let server;
  let port;
  before((done) => {
    server = createHttpServer((req, res) =>
      server.emit(req.url, req, res)
    ).listen(0, "localhost", (error) => {
      if (error) {
        return done(error);
      }

      port = server.address().port;
      done();
    });
  });
  after((done) => {
    server.close(done);
  });

  it("works", () => {
    server.once("/foo", (req, res) => res.end("bar"));

    return httpRequestPlus({ port, path: "/foo" })
      .readAll("utf-8")
      .then((body) => {
        assert.strictEqual(body, "bar");
      });
  });

  /* eslint-disable node/no-unsupported-features/node-builtins */
  if (typeof URL !== "undefined") {
    it("supports URL params", async () => {
      server.once("/foo", (req, res) => res.end("bar"));

      const url = new URL("http://localhost/foo");
      url.port = port;

      return httpRequestPlus(url)
        .readAll("utf-8")
        .then((body) => {
          assert.strictEqual(body, "bar");
        });
    });
  }
  /* eslint-enable node/no-unsupported-features/node-builtins */

  describe("error", () => {
    it("contains the requested URL", () => {
      return httpRequestPlus({ hostname: "invalid.", path: "/foo" }).catch(
        (err) => {
          assert.strictEqual(err.url, `http://invalid./foo`);
        }
      );
    });

    it("contains the requested URL on error status code", () => {
      server.once("/foo", (req, res) => httpError(res));

      return httpRequestPlus({ port, path: "/foo" }).catch((err) => {
        assert.strictEqual(err.url, `http://localhost:${port}/foo`);

        return freeStream(err.response);
      });
    });
  });

  describe("bypassStatusCheck", () => {
    it("can be used do disable status check", async () => {
      const statusCode = 401;
      const body = "body";
      server.once("/", (_, res) => httpError(res, statusCode, body));

      const response = await httpRequestPlus({ bypassStatusCheck: true, port });
      assert.strictEqual(response.statusCode, statusCode);
      assert.strictEqual(await response.readAll("utf8"), body);
    });
  });

  describe("response", () => {
    it("contains the requested URL", () => {
      server.once("/foo", (req, res) => res.end("foo"));

      return httpRequestPlus({ port, path: "/foo" }).then((res) => {
        assert.strictEqual(res.url, `http://localhost:${port}/foo`);

        return freeStream(res);
      });
    });

    it("contains the requested URL after redirection", () => {
      server.once("/foo", (req, res) => redirect(res, "/bar"));
      server.once("/bar", (req, res) => res.end("bar"));

      return httpRequestPlus({ port, path: "/foo" }).then((res) => {
        assert.strictEqual(res.url, `http://localhost:${port}/bar`);

        return freeStream(res);
      });
    });
  });

  describe("CancelToken", () => {
    it("can cancel the request", async () => {
      const { cancel, token } = CancelToken.source();

      cancel();
      assert(
        (await rejectionOf(httpRequestPlus(token, { port }))) instanceof Cancel
      );
    });

    it("can cancel the response which emit an error event", async () => {
      // something needs to be written to close finish the request
      server.once("/", (req, res) => res.write("foo"));

      const { cancel, token } = CancelToken.source();

      const r = await httpRequestPlus(token, { port });
      cancel();
      const error = await new Promise((resolve) => r.on("error", resolve));
      assert(error instanceof Error);
      assert.strictEqual(error.canceled, true);
      assert.strictEqual(error.message, "HTTP request has been canceled");
      assert.strictEqual(error.method, "GET");
      assert.strictEqual(error.timeout, false);
      assert.strictEqual(error.url, `http://localhost:${port}/`);
    });
  });

  it("handles stream body error", async () => {
    const error = new Error();
    const body = new Readable({
      read() {
        this.emit("error", error);
      },
    });

    server.once("/post", (req, res) => req.resume().on("end", () => res.end()));

    const actualError = await rejectionOf(
      httpRequestPlus.post({ port, path: "/post", body })
    );

    assert.strictEqual(actualError.url, `http://localhost:${port}/post`);
    assert.strictEqual(actualError, error);
    assert.strictEqual(body.destroyed, true);
  });

  it("handles aborted response", async () => {
    server.once("/", (req, res) => {
      res.write(" ");
      setImmediate(() => {
        res.destroy();
      });
    });

    const res = await httpRequestPlus({ path: "/", port });
    const error = await new Promise((resolve) => {
      res.on("error", resolve);
    });
    assert(error instanceof Error);
    assert.strictEqual(error.canceled, false);
    assert.strictEqual(error.message, "HTTP connection abruptly closed");
    assert.strictEqual(error.method, "GET");
    assert.strictEqual(error.timeout, false);
    assert.strictEqual(error.url, `http://localhost:${port}/`);
  });

  it("handles timeout", async () => {
    server.once("/", (req, res) => {
      res.write(" ");
    });

    const res = await httpRequestPlus({ path: "/", port, timeout: 10 });
    const error = await new Promise((resolve) => {
      res.on("error", resolve);
    });
    assert(error instanceof Error);
    assert.strictEqual(error.canceled, false);
    assert.strictEqual(error.message, "HTTP connection has timed out");
    assert.strictEqual(error.method, "GET");
    assert.strictEqual(error.timeout, true);
    assert.strictEqual(error.url, `http://localhost:${port}/`);
  });
});
