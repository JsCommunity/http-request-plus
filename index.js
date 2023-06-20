"use strict";

const { createLogger } = require("@xen-orchestra/log");
const { pipeline } = require("node:stream");
const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");

const readStream = require("./_readStream.js");

function buffer() {
  return new Promise(readStream.bind(this));
}

function json() {
  return new Promise(readStream.bind(this)).then(JSON.parse);
}

function text() {
  return new Promise(readStream.bind(this)).then(String);
}

const stack = [
  function doRequest({ body, ...opts }) {
    const { debug, url } = this;

    const hasBody = body !== undefined;
    let bodyIsStream = false;
    if (hasBody) {
      bodyIsStream = typeof body.pipe === "function";

      const { headers } = opts;
      if (headers["content-length"] === undefined) {
        const length = bodyIsStream
          ? body.headers?.["content-length"] ?? body.length
          : Buffer.byteLength(body);
        if (length !== undefined) {
          opts.headers["content-length"] = length;
        }
      }
    }

    const isSecure = url.protocol === "https:";
    if (!isSecure) {
      assert.equal(url.protocol, "http:");
    }

    debug("sending request", { url: url.href, hasBody, bodyIsStream, opts });

    const req = (isSecure ? https.request : http.request)(url, opts);

    return new Promise((resolve, reject) => {
      let _sendError = reject;
      const sendError = (error) => {
        _sendError(error);
      };

      req
        .on("error", sendError)
        .on("timeout", () => {
          const error = new Error("HTTP connection has timed out");
          error.url = url.href;
          req.destroy(error);
        })
        .on("response", (response) => {
          const { headers, statusCode, statusMessage } = response;
          debug("response received", { headers, statusCode, statusMessage });

          response.buffer = buffer;

          // augment response with classic helpers (similar to standard fetch())
          response.json = json;
          response.text = text;

          _sendError = (error) => response.destroy(error);
          resolve(response);
        });

      // if `Expect: 100-continue`, wait before sending the body
      const sendBody = bodyIsStream
        ? () => {
            // avoid duplicate error handling on req
            req.off("error", sendError);

            pipeline(body, req, (error) => {
              if (error != null) {
                sendError(error);
              }
            });
          }
        : () => req.end(body);
      if (opts.headers.expect === "100-continue") {
        req.on("continue", sendBody);
      } else {
        sendBody();
      }
    });
  },
  async function handleRedirects({ maxRedirects = 5, ...opts }, next) {
    const { debug } = this;

    while (true) {
      const response = await next(opts);

      const { statusCode } = response;
      if (maxRedirects > 0 && ((statusCode / 100) | 0) === 3) {
        --maxRedirects;

        const { location } = response.headers;
        if (location !== undefined) {
          debug("redirection", { location });

          response.req.destroy();
          this.url = new URL(location, this.url);

          // This implementation does not change method/body if 302
          //
          // 307 and 308 requires that method/body stay unchanged
          if (
            !(statusCode === 302 || statusCode === 307 || statusCode === 308)
          ) {
            if (opts.method !== "GET") {
              debug("changing method to GET");
              opts.method = "GET";
            }
            const { body } = opts;
            if (body !== undefined) {
              debug("removing body");

              const { headers } = opts;
              if (headers["content-length"]) {
                delete headers["content-length"];
              }

              if (typeof body.destroy === "function") {
                body.destroy();
              }
              delete opts.body;
            }
          }

          continue;
        }
      }

      return response;
    }
  },
  async function assertSuccess({ bypassStatusCheck = false, ...opts }, next) {
    const response = await next(opts);

    if (bypassStatusCheck) {
      this.debug("bypassing status check");
      return response;
    }

    const { statusCode } = response;
    if (((statusCode / 100) | 0) === 2) {
      return response;
    }

    const error = new Error(`${response.statusCode} ${response.statusMessage}`);
    Object.defineProperty(error, "response", { value: response });
    throw error;
  },
];
function runStack(i, ...args) {
  assert(i >= 0);
  assert(i < stack.length);

  return stack[i].call(this, ...args, (...args) =>
    runStack.call(this, i - 1, ...args)
  );
}

module.exports = async function httpRequestPlus(url, opts) {
  url = url instanceof URL ? url : new URL(url);

  const { debug } = createLogger(
    "http-request-plus:" +
      url.hostname +
      url.pathname +
      ":" +
      Math.random().toString(36).slice(2, 6)
  );

  const ctx = { debug, url };

  opts = {
    __proto__: null,

    ...opts,
  };

  const { headers, method } = opts;

  // normalize headers: clone (to avoid mutate user object) and lowercase
  const normalizedHeaders = { __proto__: null };
  if (headers !== undefined) {
    for (const key of Object.keys(headers)) {
      const lcKey = key.toLowerCase();

      assert.equal(
        normalizedHeaders[lcKey],
        undefined,
        "duplicate header " + key
      );
      normalizedHeaders[lcKey] = headers[key];
    }
  }
  opts.headers = normalizedHeaders;

  // normalize method: default value and upper case
  opts.method = method === undefined ? "GET" : method.toUpperCase();

  try {
    const response = await runStack.call(ctx, stack.length - 1, opts);

    return response;
  } catch (error) {
    // augment error with useful info
    error.originalUrl = url.href;
    error.url = ctx.url.href;

    debug(error);

    throw error;
  }
};
