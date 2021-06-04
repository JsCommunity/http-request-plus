/* eslint-env jest */

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
  beforeAll((done) => {
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
  afterAll((done) => {
    server.close(done);
  });

  it("works", () => {
    server.once("/foo", (req, res) => res.end("bar"));

    return httpRequestPlus({ port, path: "/foo" })
      .readAll("utf-8")
      .then((body) => {
        expect(body).toBe("bar");
      });
  });

  describe("error", () => {
    it("contains the requested URL", () => {
      return httpRequestPlus({ hostname: "invalid.", path: "/foo" }).catch(
        (err) => {
          expect(err.url).toBe(`http://invalid./foo`);
        }
      );
    });

    it("contains the requested URL on error status code", () => {
      server.once("/foo", (req, res) => httpError(res));

      return httpRequestPlus({ port, path: "/foo" }).catch((err) => {
        expect(err.url).toBe(`http://localhost:${port}/foo`);

        return freeStream(err.response);
      });
    });
  });

  describe("response", () => {
    it("contains the requested URL", () => {
      server.once("/foo", (req, res) => res.end("foo"));

      return httpRequestPlus({ port, path: "/foo" }).then((res) => {
        expect(res.url).toBe(`http://localhost:${port}/foo`);

        return freeStream(res);
      });
    });

    it("contains the requested URL after redirection", () => {
      server.once("/foo", (req, res) => redirect(res, "/bar"));
      server.once("/bar", (req, res) => res.end("bar"));

      return httpRequestPlus({ port, path: "/foo" }).then((res) => {
        expect(res.url).toBe(`http://localhost:${port}/bar`);

        return freeStream(res);
      });
    });
  });

  describe("CancelToken", () => {
    it("can cancel the request", async () => {
      const { cancel, token } = CancelToken.source();

      cancel();
      expect(
        await rejectionOf(httpRequestPlus(token, { port }))
      ).toBeInstanceOf(Cancel);
    });

    it("can cancel the response which emit an error event", async () => {
      // something needs to be written to close finish the request
      server.once("/", (req, res) => res.write("foo"));

      const { cancel, token } = CancelToken.source();

      const r = await httpRequestPlus(token, { port });
      cancel();
      const error = await new Promise((resolve) => r.on("error", resolve));
      expect(error).toBeInstanceOf(Error);
      expect(error.canceled).toBe(true);
      expect(error.message).toBe("HTTP request has been canceled");
      expect(error.method).toBe("GET");
      expect(error.url).toBe(`http://localhost:${port}/`);
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

    expect(actualError.url).toBe(`http://localhost:${port}/post`);
    expect(actualError).toBe(error);
    expect(body.destroyed).toBe(true);
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
    expect(error).toBeInstanceOf(Error);
    expect(error.canceled).toBe(false);
    expect(error.message).toBe("HTTP connection abruptly closed");
    expect(error.method).toBe("GET");
    expect(error.url).toBe(`http://localhost:${port}/`);
  });
});
