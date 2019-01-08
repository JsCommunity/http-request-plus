/* eslint-env jest */

import { Cancel, CancelToken } from "promise-toolbox";
import { createServer as createHttpServer } from "http";

import httpRequestPlus from "./";

// ===================================================================

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

const rejectionOf = p =>
  p.then(
    _ => {
      throw _;
    },
    _ => _
  );

// ===================================================================

describe("httpRequestPlus", () => {
  let server;
  let port;
  beforeAll(done => {
    server = createHttpServer((req, res) =>
      server.emit(req.url, req, res)
    ).listen(0, "localhost", error => {
      if (error) {
        return done(error);
      }

      port = server.address().port;
      done();
    });
  });
  afterAll(done => {
    server.close(done);
  });

  it("works", () => {
    server.once("/foo", (req, res) => res.end("bar"));

    return httpRequestPlus({ port, path: "/foo" })
      .readAll("utf-8")
      .then(body => {
        expect(body).toBe("bar");
      });
  });

  describe("error", () => {
    it("contains the requested URL", () => {
      return httpRequestPlus({ hostname: "invalid.", path: "/foo" }).catch(
        err => {
          expect(err.url).toBe(`http://invalid./foo`);
        }
      );
    });

    it("contains the requested URL on error status code", () => {
      server.once("/foo", (req, res) => httpError(res));

      return httpRequestPlus({ port, path: "/foo" }).catch(err => {
        expect(err.url).toBe(`http://localhost:${port}/foo`);
      });
    });
  });

  describe("response", () => {
    it("contains the requested URL", () => {
      server.once("/foo", (req, res) => res.end("foo"));

      return httpRequestPlus({ port, path: "/foo" }).then(res => {
        expect(res.url).toBe(`http://localhost:${port}/foo`);
      });
    });

    it("contains the requested URL after redirection", () => {
      server.once("/foo", (req, res) => redirect(res, "/bar"));
      server.once("/bar", (req, res) => res.end("bar"));

      return httpRequestPlus({ port, path: "/foo" }).then(res => {
        expect(res.url).toBe(`http://localhost:${port}/bar`);
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
      expect(
        await new Promise(resolve => r.on("error", resolve))
      ).toBeInstanceOf(Cancel);
    });
  });
});
