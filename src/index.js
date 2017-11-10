import isRedirect from 'is-redirect'
import { assign, startsWith } from 'lodash'
import { cancelable, CancelToken } from 'promise-toolbox'
import { format as formatUrl, parse as parseUrl } from 'url'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { stringify as formatQueryString } from 'querystring'

// -------------------------------------------------------------------

const { push } = Array.prototype

function extend (opts) {
  const fn = this
  const httpRequestPlus = function () {
    const args = [ opts ]
    push.apply(args, arguments)
    const token = args[1]
    if (CancelToken.is(token)) {
      args[0] = token
      args[1] = opts
    }
    return fn.apply(this, args)
  }
  addHelpers(httpRequestPlus)
  return httpRequestPlus
}

const METHODS = 'delete head patch post put'.split(' ')
const METHODS_LEN = METHODS.length

// add `extend()` and helpers for HTTP methods (except GET because
// it's the default)
const addHelpers = fn => {
  for (let i = 0; i < METHODS_LEN; ++i) {
    const method = METHODS[i]
    fn[method] = (...args) => fn(...args, { method })
  }
  fn.extend = extend
}

// URL parts accepted by http.request:
const URL_SAFE_KEYS = 'auth hostname path port protocol'.split(' ')

// URL parts preferred in http-request-plus options
const URL_PREFERRED_KEYS = 'auth hostname pathname port protocol query'.split(' ')

const pickDefined = (target, source, keys) => {
  for (let i = 0, n = keys.length; i < n; ++i) {
    const key = keys[i]
    const value = source[key]
    if (value != null) {
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

let doRequest = (cancelToken, url, { body, ...opts }) => {
  pickDefined(opts, url, URL_SAFE_KEYS)

  const req = (
    startsWith(url.protocol.toLowerCase(), 'https')
      ? httpsRequest
      : httpRequest
  )(opts)
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
    cancelToken.promise.then(reject)
    req.once('error', error => {
      error.url = formatUrl(url)
      reject(error)
    })
    req.once('response', response => {
      response.cancel = () => {
        req.abort()
      }

      response.url = formatUrl(url)

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
doRequest = (doRequest => (cancelToken, url, opts) => {
  const request = doRequest(cancelToken, url, opts)

  const { body } = opts
  if (body != null && typeof body.pipe === 'function') {
    // no redirect if body is a stream
    return request
  }

  let { maxRedirects = 5 } = opts
  const loop = request => request.then(response => {
    const { statusCode } = response
    if (isRedirect(statusCode) && maxRedirects-- > 0) {
      const { location } = response.headers
      if (location !== undefined) {
        // abort current request
        response.req.abort()

        return loop(doRequest(cancelToken, url.resolveObject(location), opts))
      }
    }

    return response
  })

  return loop(request)
})(doRequest)

// throws if status code is not 2xx
doRequest = (doRequest => (cancelToken, url, opts) =>
  doRequest(cancelToken, url, opts).then(response => {
    const { statusCode } = response
    if ((statusCode / 100 | 0) !== 2) {
      const error = new Error(response.statusMessage)
      error.code = statusCode
      error.url = response.url
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
    pathname: '/',
    protocol: 'http:'
  }
  for (let i = 1, length = arguments.length; i < length; ++i) {
    const arg = arguments[i]
    if (isString(arg)) {
      pickDefined(opts, parseUrl(arg), URL_PREFERRED_KEYS)
    } else {
      assign(opts, arg)
    }
  }

  const { body } = opts
  if (body !== undefined) {
    const headers = opts.headers = { ...opts.headers }
    if (headers['content-length'] == null) {
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
  }

  if (opts.path === undefined) {
    let path = opts.pathname
    const { query } = opts
    if (query !== undefined) {
      path += `?${isString(query) ? query : formatQueryString(query)}`
    }
    opts.path = path
  }
  delete opts.pathname
  delete opts.query

  // http.request only supports path and url.format only pathname
  const url = parseUrl(formatUrl(opts) + opts.path)

  const pResponse = doRequest(cancelToken, url, opts)
  pResponse.readAll = encoding => pResponse.then(response => response.readAll(encoding))

  return pResponse
})
addHelpers(httpRequestPlus)
export { httpRequestPlus as default }
