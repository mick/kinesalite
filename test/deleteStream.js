var should = require('should'),
    helpers = require('./helpers')

var target = 'DeleteStream',
    request = helpers.request,
    randomName = helpers.randomName,
    opts = helpers.opts.bind(null, target),
    assertType = helpers.assertType.bind(null, target),
    assertValidation = helpers.assertValidation.bind(null, target),
    assertNotFound = helpers.assertNotFound.bind(null, target),
    assertInUse = helpers.assertInUse.bind(null, target)

describe('deleteStream', function() {

  describe('serializations', function() {

    it('should return SerializationException when StreamName is not a String', function(done) {
      assertType('StreamName', 'String', done)
    })

  })

  describe('validations', function() {

    it('should return ValidationException for no StreamName', function(done) {
      assertValidation({},
        '1 validation error detected: ' +
        'Value null at \'streamName\' failed to satisfy constraint: ' +
        'Member must not be null', done)
    })

    it('should return ValidationException for empty StreamName', function(done) {
      assertValidation({StreamName: ''},
        '2 validation errors detected: ' +
        'Value \'\' at \'streamName\' failed to satisfy constraint: ' +
        'Member must satisfy regular expression pattern: [a-zA-Z0-9_.-]+; ' +
        'Value \'\' at \'streamName\' failed to satisfy constraint: ' +
        'Member must have length greater than or equal to 1', done)
    })

    it('should return ValidationException for long StreamName', function(done) {
      var name = new Array(129 + 1).join('a')
      assertValidation({StreamName: name},
        '1 validation error detected: ' +
        'Value \'' + name + '\' at \'streamName\' failed to satisfy constraint: ' +
        'Member must have length less than or equal to 128', done)
    })

    it('should return ResourceNotFoundException if stream does not exist', function(done) {
      var name = randomName()
      assertNotFound({StreamName: name}, 'Stream ' + name + ' under account ' + helpers.awsAccountId + ' not found.', done)
    })

  })

  describe('functionality', function() {

    it('should allow stream to be deleted while it is being created', function(done) {
      this.timeout(100000)
      var stream = {StreamName: randomName(), ShardCount: 1}
      request(helpers.opts('CreateStream', stream), function(err, res) {
        if (err) return done(err)
        res.statusCode.should.equal(200)

        request(helpers.opts('DescribeStream', stream), function(err, res) {
          if (err) return done(err)
          res.statusCode.should.equal(200)

          res.body.StreamDescription.StreamStatus.should.equal('CREATING')

          request(opts(stream), function(err, res) {
            if (err) return done(err)
            res.statusCode.should.equal(200)

            res.body.should.equal('')

            request(helpers.opts('DescribeStream', stream), function(err, res) {
              if (err) return done(err)
              res.statusCode.should.equal(200)

              res.body.StreamDescription.StreamStatus.should.equal('DELETING')
              res.body.StreamDescription.Shards.should.be.empty

              helpers.waitUntilDeleted(stream.StreamName, function(err, res) {
                if (err) return done(err)
                res.body.__type.should.equal('ResourceNotFoundException')
                done()
              })
            })
          })
        })
      })
    })

  })

})

