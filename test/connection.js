var request = require('./helpers').request,
    uuidRegex = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/

function assertBody(statusCode, contentType, body, done) {
  return function(err, res) {
    if (err) return done(err)
    res.statusCode.should.equal(statusCode)
    res.body.should.eql(body)
    if (contentType != null) {
      res.headers['content-type'].should.equal(contentType)
    } else {
      res.headers.should.not.have.property('content-type')
    }
    if (typeof res.body != 'string') res.body = JSON.stringify(res.body)
    res.headers['content-length'].should.equal(String(Buffer.byteLength(res.body, 'utf8')))
    res.headers['x-amzn-requestid'].should.match(uuidRegex)
    new Buffer(res.headers['x-amz-id-2'], 'base64').length.should.be.within(72, 80)
    done()
  }
}

describe('kinesalite connections', function() {

  describe('basic', function() {

    it.skip('should return 413 if request too large', function(done) {
      this.timeout(100000)
      var body = Array(7 * 1024 * 1024 + 1), i
      for (i = 0; i < body.length; i++)
        body[i] = 'a'

      request({body: body.join(''), noSign: true}, function(err, res) {
        if (err) return done(err)
        res.statusCode.should.equal(413)
        res.headers['transfer-encoding'].should.equal('chunked')
        done()
      })
    })

    it.skip('should not return 413 if request not too large', function(done) {
      this.timeout(100000)
      var body = Array(7 * 1024 * 1024), i
      for (i = 0; i < body.length; i++)
        body[i] = 'a'

      request({body: body.join(''), noSign: true}, function(err, res) {
        if (err && err.code == 'HPE_INVALID_CONSTANT') return
        if (err) return done(err)
        res.statusCode.should.equal(403)
        done()
      })
    })

    it('should hang up socket if a DELETE', function(done) {
      request({method: 'DELETE', noSign: true}, function(err) {
        err.code.should.equal('ECONNRESET')
        done()
      })
    })

    function assertMissingTokenXml(done) {
      return assertBody(403, null,
        '<MissingAuthenticationTokenException>\n' +
        '  <Message>Missing Authentication Token</Message>\n' +
        '</MissingAuthenticationTokenException>\n', done)
    }

    function assertAccessDeniedXml(done) {
      return assertBody(403, null,
        '<AccessDeniedException>\n' +
        '  <Message>Unable to determine service/operation name to be authorized</Message>\n' +
        '</AccessDeniedException>\n', done)
    }

    it('should return MissingAuthenticationTokenException if GET with no auth', function(done) {
      request({method: 'GET', noSign: true}, assertMissingTokenXml(done))
    })

    it('should return MissingAuthenticationTokenException if PUT with no auth', function(done) {
      request({method: 'PUT', noSign: true}, assertMissingTokenXml(done))
    })

    it('should return MissingAuthenticationTokenException if POST with no auth', function(done) {
      request({noSign: true}, assertMissingTokenXml(done))
    })

    it('should return AccessDeniedException if GET', function(done) {
      request({method: 'GET'}, assertAccessDeniedXml(done))
    })

    it('should return AccessDeniedException if PUT', function(done) {
      request({method: 'PUT'}, assertAccessDeniedXml(done))
    })

    it('should return AccessDeniedException if POST with no body', function(done) {
      request(assertAccessDeniedXml(done))
    })

    it('should return AccessDeniedException if body and no Content-Type', function(done) {
      request({body: '{}'}, assertAccessDeniedXml(done))
    })

    it('should return AccessDeniedException if x-amz-json-1.0 Content-Type', function(done) {
      request({headers: {'content-type': 'application/x-amz-json-1.0'}}, assertAccessDeniedXml(done))
    })

    it('should return AccessDeniedException if invalid target', function(done) {
      request({headers: {'x-amz-target': 'Kinesis_20131202.ListStream'}}, assertAccessDeniedXml(done))
    })

    it('should return AccessDeniedException if no Content-Type', function(done) {
      request({headers: {'x-amz-target': 'Kinesis_20131202.ListStreams'}}, assertAccessDeniedXml(done))
    })
  })

  describe('JSON', function() {

    function assertUnknownOperation(done) {
      return assertBody(400, 'application/x-amz-json-1.1', {__type: 'UnknownOperationException'}, done)
    }

    function assertUnknownOperationDeprecated(done) {
      return assertBody(200, 'application/json', {
        Output: {__type: 'com.amazon.coral.service#UnknownOperationException', message: null},
        Version: '1.0',
      }, done)
    }

    function assertSerialization(done) {
      return assertBody(400, 'application/x-amz-json-1.1', {__type: 'SerializationException'}, done)
    }

    function assertSerializationDeprecated(done) {
      return assertBody(200, 'application/json', {
        Output: {__type: 'com.amazon.coral.service#SerializationException', Message: null},
        Version: '1.0',
      }, done)
    }

    function assertMissingAuthenticationToken(done) {
      return assertBody(400, 'application/x-amz-json-1.1', {
        __type: 'MissingAuthenticationTokenException',
        message: 'Missing Authentication Token',
      }, done)
    }

    function assertIncompleteSignature(str, done) {
      return assertBody(400, 'application/x-amz-json-1.1', {
        __type: 'IncompleteSignatureException',
        message: 'Authorization header requires \'Credential\' parameter. ' +
          'Authorization header requires \'Signature\' parameter. ' +
          'Authorization header requires \'SignedHeaders\' parameter. ' +
          'Authorization header requires existence of either a \'X-Amz-Date\' or a \'Date\' header. ' +
          'Authorization=' + str,
      }, done)
    }

    it('should return UnknownOperationException if no target', function(done) {
      request({headers: {'content-type': 'application/x-amz-json-1.1'}}, assertUnknownOperation(done))
    })

    it('should return UnknownOperationException if no target and no auth', function(done) {
      request({headers: {'content-type': 'application/x-amz-json-1.1'}, noSign: true}, assertUnknownOperation(done))
    })

    it('should return UnknownOperationException if no target and application/json', function(done) {
      request({headers: {'content-type': 'application/json'}}, assertUnknownOperationDeprecated(done))
    })

    it('should return UnknownOperationException if valid target and application/json', function(done) {
      request({headers: {
        'content-type': 'application/json',
        'x-amz-target': 'Kinesis_20131202.ListStreams',
      }}, assertUnknownOperationDeprecated(done))
    })

    it('should return SerializationException if no body', function(done) {
      request({headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'Kinesis_20131202.ListStreams',
      }}, assertSerialization(done))
    })

    it('should return SerializationException if no body and no auth', function(done) {
      request({headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'Kinesis_20131202.ListStreams',
      }, noSign: true}, assertSerialization(done))
    })

    it('should return SerializationException if non-JSON body', function(done) {
      request({headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'Kinesis_20131202.ListStreams',
      }, body: 'hello', noSign: true}, assertSerialization(done))
    })

    it('should return UnknownOperationException if valid target and body and application/json', function(done) {
      request({headers: {
        'content-type': 'application/json',
        'x-amz-target': 'Kinesis_20131202.ListStreams',
      }, body: '{}', noSign: true}, assertUnknownOperationDeprecated(done))
    })

    it('should return SerializationException if non-JSON body and application/json', function(done) {
      request({headers: {
        'content-type': 'application/json',
        'x-amz-target': 'Kinesis_20131202.ListStreams',
      }, body: 'hello', noSign: true}, assertSerializationDeprecated(done))
    })

    it('should return MissingAuthenticationTokenException if no auth', function(done) {
      request({headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'Kinesis_20131202.ListStreams',
      }, body: '{}', noSign: true}, assertMissingAuthenticationToken(done))
    })

    it('should return IncompleteSignatureException if invalid auth', function(done) {
      request({headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'Kinesis_20131202.ListStreams',
        'Authorization': 'X',
      }, body: '{}', noSign: true}, assertIncompleteSignature('X', done))
    })

  })

})
