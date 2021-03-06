var https = require('https'),
    fs = require('fs'),
    crypto = require('crypto'),
    uuid = require('node-uuid'),
    validations = require('./validations'),
    db = require('./db')

var MAX_REQUEST_BYTES = 7 * 1024 * 1024

var validApis = ['Kinesis_20131202'],
    validOperations = ['AddTagsToStream', 'CreateStream', 'DeleteStream', 'DescribeStream', 'GetRecords',
      'GetShardIterator', 'ListStreams', 'ListTagsForStream', 'MergeShards', 'PutRecord', 'PutRecords',
      'RemoveTagsFromStream', 'SplitShard'],
    actions = {},
    actionValidations = {}

module.exports = kinesalite

function kinesalite(options) {
  options = options || {}
  options.key = options.key || fs.readFileSync(__dirname + '/key.pem')
  options.cert = options.cert || fs.readFileSync(__dirname + '/cert.pem')
  options.ca = options.ca || fs.readFileSync(__dirname + '/ca.pem')
  options.requestCert = true
  options.rejectUnauthorized = false
  return https.createServer(options, httpHandler.bind(null, db.create(options)))
}

validOperations.forEach(function(action) {
  action = validations.toLowerFirst(action)
  actions[action] = require('./actions/' + action)
  actionValidations[action] = require('./validations/' + action)
})

function sendData(req, res, data, statusCode) {
  var body = data != null ? JSON.stringify(data) : ''
  req.removeAllListeners()
  res.statusCode = statusCode || 200
  res.setHeader('Content-Type', res.contentType)
  res.setHeader('Content-Length', Buffer.byteLength(body, 'utf8'))
  // AWS doesn't send a 'Connection' header but seems to use keep-alive behaviour
  //res.setHeader('Connection', '')
  //res.shouldKeepAlive = false
  res.end(body)
}

function httpHandler(store, req, res) {
  if (req.method == 'DELETE') {
    req.destroy()
    return res.destroy()
  }
  var body
  req.on('error', function(err) { throw err })
  req.on('data', function(data) {
    var newLength = data.length + (body ? body.length : 0)
    if (newLength > MAX_REQUEST_BYTES) {
      req.removeAllListeners()
      res.statusCode = 413
      res.setHeader('Transfer-Encoding', 'chunked')
      return res.end()
    }
    body = body ? Buffer.concat([body, data], newLength) : data
  })
  req.on('end', function() {

    body = body ? body.toString() : ''

    // All responses after this point have a RequestId
    res.setHeader('x-amzn-RequestId', uuid.v1())
    res.setHeader('x-amz-id-2', crypto.randomBytes(72).toString('base64'))

    var contentType = req.headers['content-type']

    if (contentType != 'application/x-amz-json-1.1' && contentType != 'application/json') {
      req.removeAllListeners()
      res.statusCode = 403
      body = req.headers.authorization ?
          '<AccessDeniedException>\n' +
          '  <Message>Unable to determine service/operation name to be authorized</Message>\n' +
          '</AccessDeniedException>\n' :
          '<MissingAuthenticationTokenException>\n' +
          '  <Message>Missing Authentication Token</Message>\n' +
          '</MissingAuthenticationTokenException>\n'
      res.setHeader('Content-Length', Buffer.byteLength(body, 'utf8'))
      return res.end(body)
    }

    res.contentType = contentType

    var target = (req.headers['x-amz-target'] || '').split('.')

    if (target.length != 2 || !~validApis.indexOf(target[0]) || !~validOperations.indexOf(target[1])) {
      if (contentType == 'application/json') {
        return sendData(req, res, {
          Output: {__type: 'com.amazon.coral.service#UnknownOperationException', message: null},
          Version: '1.0',
        }, 200)
      }
      return sendData(req, res, {__type: 'UnknownOperationException'}, 400)
    }

    // AWS doesn't seem to care about the HTTP path, so no checking needed for that

    var action = validations.toLowerFirst(target[1])

    // THEN check body, see if the JSON parses:

    var data
    if (contentType != 'application/json' || (contentType == 'application/json' && body)) {
      try {
        data = JSON.parse(body)
      } catch (e) {
        if (contentType == 'application/json') {
          return sendData(req, res, {
            Output: {__type: 'com.amazon.coral.service#SerializationException', Message: null},
            Version: '1.0',
          }, 200)
        }
        return sendData(req, res, {__type: 'SerializationException'}, 400)
      }
    }

    // After this point, application/json doesn't seem to progress any further
    if (contentType == 'application/json') {
      return sendData(req, res, {
        Output: {__type: 'com.amazon.coral.service#UnknownOperationException', message: null},
        Version: '1.0',
      }, 200)
    }

    var auth = req.headers.authorization

    if (!auth)
      return sendData(req, res, {
        __type: 'MissingAuthenticationTokenException',
        message: 'Missing Authentication Token',
      }, 400)

    var authParams = auth.split(' ').slice(1).join('').split(',').reduce(function(obj, x) {
          var keyVal = x.trim().split('=')
          obj[keyVal[0]] = keyVal[1]
          return obj
        }, {}),
        date = req.headers['x-amz-date'] || req.headers.date

    var headers = ['Credential', 'Signature', 'SignedHeaders']
    var msg = ''
    headers.forEach(function(header) {
      if (!authParams[header])
        msg += 'Authorization header requires \'' + header + '\' parameter. '
    })
    if (!date)
      msg += 'Authorization header requires existence of either a \'X-Amz-Date\' or a \'Date\' header. '
    if (msg) {
      return sendData(req, res, {
        __type: 'IncompleteSignatureException',
        message: msg + 'Authorization=' + auth,
      }, 400)
    }

    var actionValidation = actionValidations[action]
    try {
      data = validations.checkTypes(data, actionValidation.types)
      validations.checkValidations(data, actionValidation.types, actionValidation.custom, target[1])
    } catch (e) {
      if (e.statusCode) return sendData(req, res, e.body, e.statusCode)
      throw e
    }

    actions[action](store, data, function(err, data) {
      if (err && err.statusCode) return sendData(req, res, err.body, err.statusCode)
      if (err) throw err
      sendData(req, res, data)
    })
  })
}

if (require.main === module) kinesalite().listen(4567)

