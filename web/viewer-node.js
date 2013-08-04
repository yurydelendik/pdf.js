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

var socket = io.connect('http://localhost:8090');
socket.on('pdfjs.response', function (data) {
  PDFJS.worker.onmessage({data: decode(data) });
});

PDFJS.worker = {
  postMessage: function(data) {
    socket.emit('pdfjs.request', {data: encode(data)});
  }
};

