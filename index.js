"use strict";

const qs = require("node:querystring");

// URL parts preferred in http-request-plus options
const URL_PREFERRED_KEYS = "auth hostname pathname port protocol query".split(
  " "
);

function pickDefined(target, source, keys) {
  for (let i = 0, n = keys.length; i < n; ++i) {
    const key = keys[i];
    const value = source[key];
    if (value != null) {
      target[key] = value;
    }
  }

  return target;
}

module.exports = function httpRequestPlus() {
  const opts = {
    hostname: "localhost",
    pathname: "/",
    protocol: "http:",
  };

  for (let i = 0, n = arguments.length; i < n; ++i) {
    const arg = arguments[i];
    if (arg != null) {
      if (typeof arg === "string") {
        pickDefined(opts, new URL(arg), URL_PREFERRED_KEYS);
      } else if (typeof arg.href === "string") {
        // consider it as a WHATWG URL object
        //
        // this object must be handled differently because its properties are
        // non-enumerable
        pickDefined(opts, arg, URL_PREFERRED_KEYS);
      } else {
        Object.assign(opts, arg);
      }
    }
  }

  const { body } = opts;
  if (body !== undefined) {
    const headers = (opts.headers = { ...opts.headers });
    if (headers["content-length"] == null) {
      let tmp;
      if (typeof body === "string") {
        headers["content-length"] = Buffer.byteLength(body);
      } else if (
        ((tmp = body.headers) != null &&
          (tmp = tmp["content-length"]) != null) ||
        (tmp = body.length) != null
      ) {
        headers["content-length"] = tmp;
      }
    }
  }

  if (opts.path === undefined) {
    let path = opts.pathname;
    const { query } = opts;
    if (query !== undefined) {
      path += `?${typeof query === "string" ? query : qs.stringify(query)}`;
    }
    opts.path = path;
  }
  delete opts.pathname;
  delete opts.query;
};
