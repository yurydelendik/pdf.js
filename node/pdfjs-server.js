var io = require('socket.io').listen(8090)
  , fs = require('fs')
  , http = require('http')
  , url = require('url')

function decode(data) {
  if (data == null || typeof data !== 'object')
    return data;

  if ('Uint8Array' in data) {
    var array = data.Uint8Array;
    var target = new Uint8Array(array.length);
    for (var j = 0; j < array.length; j++)
      target[j] = array.charCodeAt(j) & 0xFF;
    return target;
  }

  var obj = data instanceof Array ? [] : {};
  for (var i in data)
    obj[i] = decode(data[i]);
  return obj;
}

function encode(data) {
  if (data == null || typeof data !== 'object')
    return data;

  if (data instanceof Uint8Array) {
    var array = '';
    for (var j = 0; j < data.length; j++)
      array += String.fromCharCode(data[j]);
    return { Uint8Array: array };
  }

  var obj = data instanceof Array ? [] : {};
  for (var i in data)
    obj[i] = encode(data[i]);
  return obj;
}

function downloadFile(requestUrl, callback) {
  var host = url.parse(requestUrl).hostname;
  var port = url.parse(requestUrl).port;
  var httpClient = http.createClient(port, host);

  var request = httpClient.request('GET', requestUrl, {
    host: host + ':' + port
  });
  request.end();

  request.addListener('response', function (response) {
      response.setEncoding('binary')
      var body = '';
      response.addListener('data', function (chunk) {
          body += chunk;
      });
      response.addListener('end', function() {
         var data = new Uint8Array(body.length);
         for (var i = 0; i < body.length; i++)
           data[i] = body.charCodeAt(i) & 0xFF;
         callback(data);
      });
  });
}

var allowLocalAccess = false;

io.sockets.on('connection', function (socket) {
  var pdfjs = require('../build/pdf.js').pdfjs;

  pdfjs.getPdf = function(args, callback) {
    var url = args.url || args;
    if (url.indexOf('://') >= 0) {
      downloadFile(url, callback);
      return;
    }

    if (!allowLocalAccess)
      throw 'Local access forbidden';

    url = __dirname + '/' + url;
    fs.readFile(url,
    function (err, data) {
      if (err)
        throw 'Unable to read ' + url;

      data = new Uint8Array(data);
      callback(data);
    });
  };

  pdfjs.rootScope.postMessage = function(data) {
    socket.emit('pdfjs.response', encode(data));
  };

  socket.on('pdfjs.request', function (data) {
    pdfjs.rootScope.onmessage(decode(data));
  });
});
