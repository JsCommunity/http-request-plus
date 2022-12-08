# http-request-plus

[![Package Version](https://badgen.net/npm/v/http-request-plus)](https://npmjs.org/package/http-request-plus) [![Build Status](https://travis-ci.org/JsCommunity/http-request-plus.png?branch=master)](https://travis-ci.org/JsCommunity/http-request-plus) [![PackagePhobia](https://badgen.net/packagephobia/install/http-request-plus)](https://packagephobia.now.sh/result?p=http-request-plus) [![Latest Commit](https://badgen.net/github/last-commit/JsCommunity/http-request-plus)](https://github.com/JsCommunity/http-request-plus/commits/master)

> Small package that provides a promise-based, stream-oriented wrapper around the http and https modules.

Features:

- HTTP & HTTPs
- promise oriented
- stream oriented
- request body can be either a buffer/string or a stream
- content length header automatically set if available
- handle redirects
- response emits `error` on timeout

## Install

Installation of the [npm package](https://npmjs.org/package/http-request-plus):

```
> npm install --save http-request-plus
```

## Usage

### Example

> Easy use case: just downloads and prints a page with error handling.

ES2015 - ES2016:

```js
import httpRequestPlus from "http-request-plus";

async function main() {
  // this is a standard Node's IncomingMessage augmented with the following method:
  //
  // - buffer(): returns a promise to the content of the response in a Buffer
  // - json(): returns a promise to the content of the response parsed as JSON
  // - text(): returns a promise to the content of the response parsed as a UTF-8 string
  const response = await httpRequestPlus("http://example.org", {
    // A request body can provided, either as a buffer/string or a stream
    body: "foo bar",

    // By default, http-request-plus throws if the reponse's status Code is not 2xx
    //
    // This option can be used to bypass this
    bypassStatusCheck: true,

    // Maximum number of redirects that should be handled by http-request-plus
    //
    // Defaults to 5
    maxRedirects: 0,

    // all other options are forwarded to native {http,https}.request()
    //
    // including `timeout` and `signal` which will properly trigger errors
  });

  // any error occuring after the response has been received, including abortion,
  // timeout, or body error (if body is a stream) will be emitted as an `error`
  // event on the response object

  console.log(await response.text());
}

main().catch((error) => console.error("FATAL:", error));
```

## Contributions

Contributions are _very_ welcomed, either on the documentation or on
the code.

You may:

- report any [issue](https://github.com/JsCommunity/http-request-plus)
  you've encountered;
- fork and create a pull request.

## Related Resources

- [Node.js HTTP Documentation](https://nodejs.org/api/http.html)
- [Node.js HTTPS Documentation](https://nodejs.org/api/https.html)

## License

ISC © [Julien Fontanet](https://github.com/julien-f)
