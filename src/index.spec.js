/* eslint-env jest */

import { createServer as createHttpServer } from 'http'

import httpRequestPlus from './'

// ===================================================================

describe('httpRequestPlus', () => {
  let server
  let port
  beforeAll(done => {
    server = createHttpServer((req, res) =>
      server.emit(req.url, req, res)
    ).listen(0, 'localhost', error => {
      if (error) {
        return done(error)
      }

      port = server.address().port
      done()
    })
  })
  afterAll(done => {
    server.close(done)
  })

  it('works', () => {
    server.once('/foo', (req, res) => res.end('bar'))

    return httpRequestPlus({ port, path: '/foo' }).readAll('utf-8').then(body => {
      expect(body).toBe('bar')
    })
  })
})
