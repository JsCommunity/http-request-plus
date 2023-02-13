"use strict";

const { createLogger } = require("@xen-orchestra/log");
const { pipeline } = require("node:stream");
const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");

// Methods that should not cause side effects
//
// See https://httpwg.org/specs/rfc9110.html#safe.methods
const SAFE_METHODS = new Set(["get", "head", "options", "trace"]);

// Methods that can be safely retried
//
// See https://httpwg.org/specs/rfc9110.html#idempotent.methods
const IDEMPOTENT_METHODS = new Set([...SAFE_METHODS, "DELETE", "PUT"]);

const stack = [
  function doRequest() {
    const { body, debug, url, ...opts } = this;

    let bodyIsStream = false;
    if (body !== undefined) {
      bodyIsStream = typeof body.pipe === "function";

      const { headers } = opts;
      if (headers?.["content-length"] === undefined) {
        const length = bodyIsStream
          ? body.headers?.["content-length"] ?? body.length
          : Buffer.byteLength(body);
        if (length !== undefined) {
          opts.headers = { ...headers, "content-length": length };
        }
      }
    }

    const isSecure = url.protocol === "https:";
    if (!isSecure) {
      assert.equal(url.protocol, "http:");
    }

    debug("sending request", { url: url.href, opts });

    const req = (isSecure ? https.request : http.request)(url, opts);

    return new Promise((resolve, reject) => {
      let _sendError = reject;
      const sendError = (error) => {
        error.opts = opts;
        error.url = url;
        _sendError(error);
      };

      req
        .on("error", sendError)
        .on("timeout", () => {
          req.destroy(new Error("HTTP connection has timed out"));
        })
        .on("response", (response) => {
          const { headers, statusCode, statusMessage } = response;
          debug("response received", { headers, statusCode, statusMessage });

          _sendError = (error) => response.emit("error", error);
          resolve(response);
        });

      if (bodyIsStream) {
        pipeline(body, req, (error) => {
          if (error != null && error.code !== "ERR_STREAM_PREMATURE_CLOSE") {
            sendError(error);
          }
        });
      } else {
        req.end(body);
      }
    });
  },
  async function handleRetries(next) {
    return next();
  },
  async function handleRedirects(next) {
    let { debug, maxRedirects = 5 } = this;
    delete this.maxRedirects;

    while (true) {
      const response = await next();

      const { statusCode } = response;
      if (maxRedirects-- > 0 && ((statusCode / 100) | 0) === 3) {
        const { location } = response.headers;
        if (location !== undefined) {
          debug("redirection", { location });

          response.req.destroy();
          this.url = new URL(location, this.url);

          // Only 307 and 308 guarantee method preservation, others
          if (!(statusCode === 307 || statusCode === 308)) {
            if (this.method !== "get") {
              debug("changing method to GET");
              this.method = "get";
            }
            const { body } = this;
            if (body !== undefined) {
              debug("removing body");
              if (typeof body.destroy === "function") {
                body.destroy();
              }
              delete this.body;
            }
          }

          continue;
        }
      }

      return response;
    }
  },
  async function assertSuccess(next) {
    const { bypassStatusCheck = false } = this;
    delete this.bypassStatusCheck;

    const response = await next();

    if (bypassStatusCheck) {
      return response;
    }

    const { statusCode } = response;
    if (((statusCode / 100) | 0) === 2) {
      return response;
    }

    const error = new Error(`${response.statusCode} ${response.statusMessage}`);
    error.response = response;
    throw error;
  },
];
function runStack(i = stack.length - 1) {
  assert(i >= 0);
  assert(i < stack.length);

  return stack[i].call(this, () => runStack.call(this, i - 1));
}

function readStream(encoding, resolve, reject) {
  const chunks = [];
  let length = 0;
  const clean = () => {
    this.removeListener("data", onData);
    this.removeListener("end", onEnd);
    this.removeListener("error", onError);
  };

  const onData = (chunk) => {
    chunks.push(chunk);
    length += chunk.length;
  };
  const onEnd = () => {
    clean();
    if (encoding === "array") {
      return resolve(chunks);
    }

    const result = Buffer.concat(chunks, length);
    resolve(
      encoding !== undefined && encoding !== "buffer"
        ? result.toString(encoding)
        : result
    );
  };
  const onError = (error) => {
    clean();
    reject(error);
  };

  this.on("data", onData);
  this.on("end", onEnd);
  this.on("error", onError);
}

function json() {
  return new Promise(readStream.bind(this, "buffer")).then(JSON.parse);
}

function text() {
  return new Promise(readStream.bind(this, "utf8"));
}

module.exports = async function httpRequestPlus(url, opts) {
  const { debug } = createLogger(
    "http-request-plus:" + Math.random().toString(36).slice(2)
  );

  opts = {
    __proto__: null,

    ...opts,

    debug,
    url: url instanceof URL ? url : new URL(url),
  };

  const { method } = opts;
  opts.method = method === undefined ? "get" : method.toLowerCase();

  try {
    const response = await runStack.call(opts);

    // augment response with classic helpers (similar to standard fetch())
    response.json = json;
    response.text = text;

    return response;
  } catch (error) {
    // augment error with useful info
    error.url = opts.url.href;
    error.opts = opts.opts;

    throw error;
  }
};
