/* eslint-env jest */

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
});
