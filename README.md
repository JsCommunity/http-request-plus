# http-request-plus [![Build Status](https://travis-ci.org/JsCommunity/http-request-plus.png?branch=master)](https://travis-ci.org/JsCommunity/http-request-plus)

> Small wrapper around {http,https}.request()

Features:

- HTTP & HTTPs
- promise oriented
- stream oriented
- cancelable
- request `body` can be either a buffer/string or a stream
- content length header automatically set if available
- request `query` if provided as object

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
import httpRequestPlus from 'http-request-plus'

(async () => {
  try {
    console.log(
      await httpRequestPlus('http://example.org').readAll()
    )
  } catch (error) {
    console.error('An error as occured', error)
  }
})()
```

ES5:

```js
var httpRequestPlus = require('http-request-plus').default

httpRequestPlus('http://example.org').readAll()
  .then(body => {
    console.log(body)
  })
  .catch(error => {
    console.error('An error as occured', error)
  })
```

### `httpRequestPlus(options...)` → `Promise<response>`

### `Promise<response>.cancel()`

### `Promise<response>.readAll()` → `Promise<buffer>`

### `Promise<response>.request`

### `response.cancel()`
### `response.readAll()` → `Promise<buffer>`
### `response.length`

### `error.code`
### `error.response`

## Development

### Installing dependencies

```
> npm install
```

### Compilation

The sources files are watched and automatically recompiled on changes.

```
> npm run dev
```

### Tests

```
> npm run test-dev
```

## Contributions

Contributions are *very* welcomed, either on the documentation or on
the code.

You may:

- report any [issue](https://github.com/JsCommunity/http-request-plus)
  you've encountered;
- fork and create a pull request.

## License

ISC © [Julien Fontanet](https://github.com/julien-f)
