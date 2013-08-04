/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/* Copyright 2013 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
  var request = http.request(requestUrl, function (response) {
    response.setEncoding('binary')
    var body = '';
    response.addListener('data', function (chunk) {
        body += chunk;
    });
    response.addListener('end', function() {
       var data = new Uint8Array(body.length);
       for (var i = 0; i < body.length; i++)
         data[i] = body.charCodeAt(i) & 0xFF;
       callback(null, data);
    });
  });
  request.on('error', function (e) { callback(e); });
  request.end();
}

var allowLocalAccess = false;

io.sockets.on('connection', function (socket) {
  var pdfjs = require('../build/pdf.js').PDFJS;

  pdfjs.requestData = function(url, callback) {
    if (url.indexOf('://') >= 0) {
      console.log('Requesting URL: ' + url);
      downloadFile(url, callback);
      return;
    }

    if (!allowLocalAccess)
      callback('Local access forbidden');

    url = __dirname + '/' + url;
    console.log('Reading local file: ' + url);
    fs.readFile(url,
    function (err, data) {
      if (err)
        throw 'Unable to read ' + url;

      data = new Uint8Array(data);
      callback(null, data);
    });
  };

  pdfjs.globalScope.postMessage = function(data) {
    socket.emit('pdfjs.response', encode(data));
  };

  socket.on('pdfjs.request', function (data) {
    pdfjs.globalScope.onmessage(decode(data));
  });
});
