import isRedirect from 'is-redirect'
import { assign, startsWith } from 'lodash'
import { cancelable } from 'promise-toolbox'
import { format as formatUrl, parse as parseUrl } from 'url'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { stringify as formatQueryString } from 'querystring'

// -------------------------------------------------------------------

// assign safe URL parts to an object:
// - defined
// - accepted by http.request
const URL_SAFE_KEYS = 'auth hostname path port protocol'.split(' ')
const URL_SAFE_KEYS_LEN = URL_SAFE_KEYS.length
const assignSafeUrlParts = (target, url) => {
  for (let i = 0; i < URL_SAFE_KEYS_LEN; ++i) {
    const key = URL_SAFE_KEYS[i]
    const value = url[key]
    if (value !== null) {
      target[key] = value
    }
  }

  return target
}

const isString = value => typeof value === 'string'

const readAllStream = (stream, encoding) => new Promise((resolve, reject) => {
  const chunks = []
  let length = 0
  const clean = () => {
    stream.removeListener('data', onData)
    stream.removeListener('end', onEnd)
    stream.removeListener('error', onError)
  }

  const onData = chunk => {
    chunks.push(chunk)
    length += chunk.length
  }
  const onEnd = () => {
    clean()
    if (encoding === 'array') {
      return resolve(chunks)
    }

    const result = Buffer.concat(chunks, length)
    resolve(encoding ? result.toString(encoding) : result)
  }
  const onError = error => {
    clean()
    reject(error)
  }

  stream.on('data', onData)
  stream.on('end', onEnd)
  stream.on('error', onError)
})

// -------------------------------------------------------------------

let doRequest = (cancelToken, url, opts) => {
  const {
    body,
    headers: { ...headers } = {},
    query,
    ...rest
  } = opts

  if (headers['content-length'] == null && body != null) {
    let tmp
    if (isString(body)) {
      headers['content-length'] = Buffer.byteLength(body)
    } else if (
      (
        (tmp = body.headers) != null &&
        (tmp = tmp['content-length']) != null
      ) ||
      (tmp = body.length) != null
    ) {
      headers['content-length'] = tmp
    }
  }

  if (query !== undefined) {
    rest.path = `${rest.pathname || rest.path || '/'}?${
      isString(query)
        ? query
        : formatQueryString(query)
    }`
  }

  assignSafeUrlParts(rest, url)
  rest.headers = headers

  const { protocol } = rest

  const req = (
    protocol !== null && startsWith(protocol.toLowerCase(), 'https')
      ? httpsRequest
      : httpRequest
  )(rest)
  cancelToken.promise.then(() => {
    req.abort()
  })

  if (body !== undefined) {
    if (typeof body.pipe === 'function') {
      body.pipe(req)
    } else {
      req.end(body)
    }
  } else {
    req.end()
  }

  return new Promise((resolve, reject) => {
    req.once('error', reject)
    req.once('response', response => {
      response.readAll = encoding => readAllStream(response, encoding)

      const length = response.headers['content-length']
      if (length !== undefined) {
        response.length = +length
      }

      resolve(response)
    })
  })
}

// handles redirects
doRequest = (doRequest => (cancelToken, url, opts) =>
  doRequest(cancelToken, url, opts).then(response => {
    const { statusCode } = response
    if (isRedirect(statusCode)) {
      const { location } = response.headers
      if (location !== undefined) {
        return doRequest(cancelToken, url.resolveObject(location), opts)
      }
    }

    return response
  })
)(doRequest)

// throws if status code is not 2xx
doRequest = (doRequest => (cancelToken, url, opts) =>
  doRequest(cancelToken, url, opts).then(response => {
    const { statusCode } = response
    if ((statusCode / 100 | 0) !== 2) {
      const error = new Error(response.statusMessage)
      error.code = statusCode
      Object.defineProperty(error, 'response', {
        configurable: true,
        value: response,
        writable: true
      })

      throw error
    }

    return response
  })
)(doRequest)

const httpRequestPlus = cancelable(function (cancelToken) {
  const opts = {
    hostname: 'localhost',
    path: '/',
    protocol: 'http:'
  }
  for (let i = 1, length = arguments.length; i < length; ++i) {
    const arg = arguments[i]
    if (isString(arg)) {
      assignSafeUrlParts(opts, parseUrl(arg))
    } else {
      assign(opts, arg)
    }
  }

  // http.request only supports path and url.format only pathname
  const url = parseUrl(formatUrl(opts) + opts.path)

  const pResponse = doRequest(cancelToken, url, opts)
  pResponse.readAll = encoding => pResponse.then(response => response.readAll(encoding))

  return pResponse
})
export { httpRequestPlus as default }

// helpers for HTTP methods (expect GET because it's the default)
'delete head patch post put'.split(' ').forEach(method => {
  httpRequestPlus[method] = (...args) =>
    httpRequestPlus(...args, { method })
})
