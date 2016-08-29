import assign from 'lodash/assign'
import isString from 'lodash/isString'
import startsWith from 'lodash/startsWith'
import { parse as parseUrl } from 'url'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { stringify as formatQueryString } from 'querystring'

// -------------------------------------------------------------------

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

const httpRequestPlus = (...args) => {
  let req

  const pResponse = new Promise((resolve, reject) => {
    const opts = {}
    for (let i = 0, length = args.length; i < length; ++i) {
      const arg = args[i]
      assign(opts, isString(arg) ? parseUrl(arg) : arg)
    }

    const {
      body,
      headers: { ...headers } = {},
      protocol,
      query,
      ...rest
    } = opts

    if (headers['content-length'] == null && body != null) {
      let tmp
      if (isString(body)) {
        headers['content-length'] = Buffer.byteLength(body)
      } else if (
        (
          (tmp = body.headers) &&
          (tmp = tmp['content-length']) != null
        ) ||
        (tmp = body.length) != null
      ) {
        headers['content-length'] = tmp
      }
    }

    if (query) {
      rest.path = `${rest.pathname || rest.path || '/'}?${
        isString(query)
          ? query
          : formatQueryString(query)
      }`
    }

    req = (
      protocol && startsWith(protocol.toLowerCase(), 'https')
        ? httpsRequest
        : httpRequest
    )({
      ...rest,
      headers
    })

    if (body) {
      if (typeof body.pipe === 'function') {
        body.pipe(req)
      } else {
        req.end(body)
      }
    } else {
      req.end()
    }
    req.on('error', reject)
    req.once('response', resolve)
  }).then(response => {
    response.cancel = () => {
      req.abort()
    }
    response.readAll = encoding => readAllStream(response, encoding)

    const length = response.headers['content-length']
    if (length) {
      response.length = length
    }

    const code = response.statusCode
    if (code < 200 || code >= 300) {
      const error = new Error(response.statusMessage)
      error.code = code
      Object.defineProperty(error, 'response', {
        configurable: true,
        value: response,
        writable: true
      })

      throw error
    }

    return response
  })

  pResponse.cancel = () => {
    req.emit('error', new Error('HTTP request canceled!'))
    req.abort()
  }
  pResponse.readAll = encoding => pResponse.then(response => response.readAll(encoding))
  pResponse.request = req

  return pResponse
}
export { httpRequestPlus as default }
