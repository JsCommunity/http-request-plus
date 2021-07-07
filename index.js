const cancelable = require("promise-toolbox/cancelable");
const CancelToken = require("promise-toolbox/CancelToken");
const isRedirect = require("is-redirect");
const { request: httpRequest } = require("http");
const { request: httpsRequest } = require("https");
const { stringify: formatQueryString } = require("querystring");

// eslint-disable-next-line node/no-unsupported-features/node-builtins
const pump = require("stream").pipeline || require("pump");

// eslint-disable-next-line node/no-deprecated-api
const { format: formatUrl, parse: parseUrl } = require("url");

// -------------------------------------------------------------------

const { push } = Array.prototype;

function extend(opts) {
  const fn = this;
  const httpRequestPlus = function () {
    const args = [opts];
    push.apply(args, arguments);
    const token = args[1];
    if (CancelToken.is(token)) {
      args[0] = token;
      args[1] = opts;
    }
    return fn.apply(this, args);
  };
  addHelpers(httpRequestPlus);
  return httpRequestPlus;
}

const METHODS = "delete head patch post put".split(" ");
const METHODS_LEN = METHODS.length;

// add `extend()` and helpers for HTTP methods (except GET because
// it's the default)
const addHelpers = (fn) => {
  for (let i = 0; i < METHODS_LEN; ++i) {
    const method = METHODS[i];
    fn[method] = (...args) => fn(...args, { method });
  }
  fn.extend = extend;
};

// URL parts accepted by http.request:
const URL_SAFE_KEYS = "auth hostname path port protocol".split(" ");

// URL parts preferred in http-request-plus options
const URL_PREFERRED_KEYS = "auth hostname pathname port protocol query".split(
  " "
);

const pickDefined = (target, source, keys) => {
  for (let i = 0, n = keys.length; i < n; ++i) {
    const key = keys[i];
    const value = source[key];
    if (value != null) {
      target[key] = value;
    }
  }

  return target;
};

const makeSymbol =
  typeof Symbol !== "undefined"
    ? Symbol
    : (desc) => "@@http-request-plus/" + desc;

const $$canceled = makeSymbol("canceled");
const $$timeout = makeSymbol("timeout");

function emitAbortedError() {
  // https://github.com/nodejs/node/issues/18756
  if (!this.complete) {
    const { req } = this;

    const canceled = Boolean(req[$$canceled]);
    const timeout = Boolean(req[$$timeout]);

    const error = new Error(
      canceled
        ? "HTTP request has been canceled"
        : timeout
        ? "HTTP connection has timed out"
        : "HTTP connection abruptly closed"
    );
    error.canceled = canceled;
    error.method = req.method;
    error.url = this.url;
    error.timeout = timeout;
    this.emit("error", error);
  }
}

const isString = (value) => typeof value === "string";

function readAllStreamHelper(encoding, resolve, reject) {
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

function readAllStream(encoding) {
  return new Promise(readAllStreamHelper.bind(this, encoding));
}

// -------------------------------------------------------------------

function abort() {
  this[$$canceled] = true;
  this.abort();
}

function timeoutReq() {
  this[$$timeout] = true;
  this.abort();
}

// helper to abort a response
function abortResponse() {
  this.removeListener("aborted", emitAbortedError);
  this.resume();
  this.req.abort();
}

let doRequest = (cancelToken, url, { body, onRequest, ...opts }) => {
  pickDefined(opts, url, URL_SAFE_KEYS);

  const req = (
    url.protocol.toLowerCase().startsWith("https") ? httpsRequest : httpRequest
  )(opts);

  const abortReq = abort.bind(req);
  cancelToken.promise.then(abortReq);
  req.once("timeout", timeoutReq);

  if (onRequest !== undefined) {
    onRequest(req);
  }

  return new Promise((resolve, reject) => {
    // no problem if called multiple times
    const onError = (error) => {
      error.url = formatUrl(url);
      reject(error);
    };

    if (body !== undefined) {
      if (typeof body.pipe === "function") {
        pump(body, req, (error) => {
          if (error != null) {
            onError(error);
          }
        });
      } else {
        req.end(body);
      }
    } else {
      req.end();
    }

    cancelToken.promise.then(reject);
    req.once("error", onError);
    req.once("response", (response) => {
      response.cancel = abortResponse;

      response.url = formatUrl(url);

      response.readAll = readAllStream;

      const length = response.headers["content-length"];
      if (length !== undefined) {
        response.length = +length;
      }

      response.once("aborted", emitAbortedError);

      resolve(response);
    });
  });
};

// handles redirects
doRequest = ((doRequest) => (cancelToken, url, opts) => {
  const request = doRequest(cancelToken, url, opts);

  const { body } = opts;
  if (body != null && typeof body.pipe === "function") {
    // no redirect if body is a stream
    return request;
  }

  let { maxRedirects = 5 } = opts;
  if (maxRedirects === 0) {
    return request;
  }

  const onResponse = (response) => {
    const { statusCode } = response;
    if (isRedirect(statusCode) && maxRedirects-- > 0) {
      const { location } = response.headers;
      if (location !== undefined) {
        // abort current request
        response.cancel();

        return loop(doRequest(cancelToken, url.resolveObject(location), opts));
      }
    }

    return response;
  };
  const loop = (request) => request.then(onResponse);

  return loop(request);
})(doRequest);

// throws if status code is not 2xx
doRequest = ((doRequest) => {
  const onResponse = (response) => {
    const { statusCode } = response;
    if (((statusCode / 100) | 0) !== 2) {
      const error = new Error(response.statusMessage);
      error.code = statusCode;
      error.url = response.url;
      Object.defineProperty(error, "response", {
        configurable: true,
        value: response,
        writable: true,
      });

      throw error;
    }

    return response;
  };

  return (cancelToken, url, opts) =>
    doRequest(cancelToken, url, opts).then(onResponse);
})(doRequest);

const httpRequestPlus = cancelable(function (cancelToken) {
  const opts = {
    hostname: "localhost",
    pathname: "/",
    protocol: "http:",
  };
  for (let i = 1, length = arguments.length; i < length; ++i) {
    const arg = arguments[i];
    if (isString(arg)) {
      pickDefined(opts, parseUrl(arg), URL_PREFERRED_KEYS);
    } else {
      Object.assign(opts, arg);
    }
  }

  const { body } = opts;
  if (body !== undefined) {
    const headers = (opts.headers = { ...opts.headers });
    if (headers["content-length"] == null) {
      let tmp;
      if (isString(body)) {
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
      path += `?${isString(query) ? query : formatQueryString(query)}`;
    }
    opts.path = path;
  }
  delete opts.pathname;
  delete opts.query;

  // http.request only supports path and url.format only pathname
  const url = parseUrl(formatUrl(opts) + opts.path);

  const pResponse = doRequest(cancelToken, url, opts);
  pResponse.readAll = (encoding) =>
    pResponse.then((response) => response.readAll(encoding));

  return pResponse;
});
addHelpers(httpRequestPlus);
module.exports = httpRequestPlus;
