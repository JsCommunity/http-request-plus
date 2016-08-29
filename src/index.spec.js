/* eslint-env mocha */

import expect from 'must'
import { createServer as createHttpServer } from 'http'

import httpRequestPlus from './'

// ===================================================================

describe('httpRequestPlus', () => {
  let server
  let port
  before(done => {
    server = createHttpServer((req, res) => server.emit(req.url, req, res))

    server.listen(0, 'localhost', error => {
      if (error) {
        return done(error)
      }

      port = server.address().port
      done()
    })
  })
  after(done => {
    server.close(done)
  })

  it('works', () => {
    server.once('/foo', (req, res) => res.end('bar'))

    return expect(
      httpRequestPlus({ port, path: '/foo' }).readAll('utf-8')
    ).to.resolve.to.equal('bar')
  })
})
