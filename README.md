# http-request-plus

[![Package Version](https://badgen.net/npm/v/http-request-plus)](https://npmjs.org/package/http-request-plus) [![Build Status](https://travis-ci.org/JsCommunity/http-request-plus.png?branch=master)](https://travis-ci.org/JsCommunity/http-request-plus) [![PackagePhobia](https://badgen.net/packagephobia/install/http-request-plus)](https://packagephobia.now.sh/result?p=http-request-plus) [![Latest Commit](https://badgen.net/github/last-commit/JsCommunity/http-request-plus)](https://github.com/JsCommunity/http-request-plus/commits/master)

> Small wrapper around {http,https}.request()

Features:

- HTTP & HTTPs
- promise oriented
- stream oriented
- cancelable via cancel token or `response.cancel()`
- request `body` can be either a buffer/string or a stream
- content length header automatically set if available
- support `pathname` & `query` (string or object) if no `path` provided
- handle redirects (`maxRedirects = 5`)
- response emits `error` on abort and timeout

## Install

Installation of the [npm package](https://npmjs.org/package/http-request-plus):

```
> npm install --save http-request-plus
```

## Usage

### Example

> Easiest use case: just downloads and prints a page with error handling.

ES2015 - ES2016:

```js
import httpRequestPlus from "http-request-plus";

(async () => {
  try {
    console.log(
      await httpRequestPlus("http://example.org", {
        onRequest(request) {
          // this function will be called multiple times in case of redirections

          request.setTimeout(10 * 1e3);
          request.on("timeout", request.abort);
        },
      }).readAll("utf8")
    );
  } catch (error) {
    console.error("An error as occured", error);
  }
})();
```

ES5:

```js
var httpRequestPlus = require("http-request-plus").default;

httpRequestPlus("http://example.org")
  .readAll("utf8")
  .then(body => {
    console.log(body);
  })
  .catch(error => {
    console.error("An error as occured", error);
  });
```

### HTTP method helpers

```js
httpRequestPlus.delete();
httpRequestPlus.head();
httpRequestPlus.patch();
httpRequestPlus.post();
httpRequestPlus.put();
```

### `httpRequestPlus.extend(opts)`

```js
const githubRequest = httpRequestPlus.extend("https://github.com");

githubRequest.post("/api");
```

### `httpRequestPlus(options...)` → `Promise<response>`

### `Promise<response>.cancel()`

### `Promise<response>.readAll()` → `Promise<buffer>`

### `response.cancel()`

### `response.readAll()` → `Promise<buffer>`

### `response.length`

### `error.code`

### `error.response`

## Development

```
# Install dependencies
> npm install

# Run the tests
> npm test

# Continuously compile
> npm run dev

# Continuously run the tests
> npm run dev-test

# Build for production (automatically called by npm install)
> npm run build
```

## Contributions

Contributions are _very_ welcomed, either on the documentation or on
the code.

You may:

- report any [issue](https://github.com/JsCommunity/http-request-plus)
  you've encountered;
- fork and create a pull request.

## License

ISC © [Julien Fontanet](https://github.com/julien-f)
