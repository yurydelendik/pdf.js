/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/* Copyright 2015 Mozilla Foundation
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

function convertToHex(data) {
  var buffer = [];
  for (var i = 0; i < data.length; i++) {
    var b = data[i].toString(16);
    if (b.length == 1) {
      buffer.push('0', b);
    } else {
      buffer.push(b);
    }
  }
  return buffer.join('');
}

var TextFilters = ['ASCIIHexDecode', 'AHx', 'ASCII85Decode', 'A85'];

function convertToJSON(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  if (isArray(obj)) {
    return obj.map(convertToJSON);
  }
  if (isDict(obj)) {
    var dict = {};
    for (var prop in obj.map) {
      dict[prop] = convertToJSON(obj.map[prop]);
    }
    return {dictionary: dict};
  }
  if (isName(obj)) {
    return {name: obj.name};
  }
  if (isStream(obj)) {
    var str = obj, next;
    while ((next = str.str) || (next = str.stream)) {
      if (!isStream(next)) {
        break;
      }
      str = next;
    }
    if (!str.bytes && !str.start) {
      throw new Error('Invalid stream');
    }
    var data = str.bytes.subarray(str.start, str.end);
    var filter = obj.dict.get('Filter');
    if (Array.isArray(filter)) {
      filter = filter[0];
    }
    var encoding, encodedData;
    if (filter && TextFilters.indexOf(filter.name) >= 0) {
      encoding = 'string';
      encodedData = bytesToString(data);
    } else {
      encoding = 'hex';
      encodedData = convertToHex(data);
    }
    return {stream: convertToJSON(obj.dict), encoding: encoding, data: encodedData};
  }
  if (isRef(obj)) {
    return {ref: 'obj' + obj.num};
  }
  throw new Error('Invalid object type');
}

function parsePDF(data, password) {
  var pdfManager = new LocalPdfManager(data, password);
  var pdfDocument = pdfManager.pdfDocument;
  pdfDocument.checkHeader();
  pdfDocument.parseStartXRef();
  pdfDocument.parse(false);
  var pdf = {
    version: pdfDocument.pdfFormatVersion
  };
  var xref = pdfDocument.xref;

  var entries = {};
  xref.entries.forEach(function (entry, index) {
    if (!entry || entry.free) {
      return undefined;
    }
    entries['obj' + index] = convertToJSON(
      xref.fetch(new Ref(index, entry.uncompressed ? entry.gen : 0)));
  });
  pdf.objects = entries;

  pdf.trailer = convertToJSON(xref.trailer);

  var encrypt = unref(pdf, getDictionaryKey(pdf.trailer, 'Encrypt'));
  if (encrypt && getDictionaryKey(encrypt, 'P') & 0x0071C) {
    throw new Error('Invalid encrypt dictionary flags');
  }
  // All objects decoded, there is no reason to keep it around.
  delete pdf.trailer.dictionary.Encrypt;

  return pdf;
}

function visitObject(obj, visitor) {
  switch (typeof obj) {
    case 'number':
      visitor.number(obj);
      break;
    case 'boolean':
      visitor.boolean(obj);
      return;
    case 'string':
      visitor.string(obj);
      return;
    case 'object':
      if (obj === null) {
        visitor.null();
        return;
      }
      if (Array.isArray(obj)) {
        visitor.array(obj);
        return;
      }
      if (obj.name) {
        var name = obj.name;
        visitor.name(name);
        return;
      }
      if (obj.ref) {
        var id = obj.ref;
        visitor.ref(id, obj);
        return;
      }
      if (obj.dictionary) {
        var dict = obj.dictionary;
        visitor.dictionary(dict);
        return;
      }
      if (obj.stream) {
        visitor.stream(obj.stream, obj.encoding, obj.data);
        return;
      }
      if (obj.content) {
        visitor.content(obj.content);
        return;
      }
      if (obj.cmd) {
        visitor.cmd(obj.cmd, obj.args, obj.data, obj.encoding);
        return;
      }
    /* fallthru */
    default:
      throw new Error('Unknown pdf object');
  }
}

function DefaultVisitor() {}
DefaultVisitor.prototype = {
  number: function (value) {},
  boolean: function (value) {},
  string: function (value) {},
  null: function () {},
  array: function (value) {
    value.forEach(function (item) {
      visitObject(item, this);
    }, this);
  },
  name: function (name) {},
  ref: function (id, obj) {},
  dictionary: function (dict) {
    for (var prop in dict) {
      visitObject(dict[prop], this);
    }
  },
  stream: function (dictObj, encoding, data) {
    visitObject(dictObj, this);
  },
  content: function (content) {
  },
  cmd: function (cmd, args, data, encoding) {
    if (args) {
      for (var i = 0; i < args.length; i++) {
        visitObject(args[i], this);
      }
    }
  }
};

function unref(pdf, obj) {
  if (typeof obj === 'object' && obj && obj.ref) {
    return pdf.objects[obj.ref];
  }
  return obj;
}

function getDictionaryKey(obj, name, name2) {
  if (!obj.dictionary) {
    throw new Error('object is not a dictionary');
  }
  if (name in obj.dictionary) {
    return obj.dictionary[name];
  }
  if (name2 && (name2 in obj.dictionary)) {
    return obj.dictionary[name2];
  }
  return undefined;
}

function indexRefs(pdf) {
  var visitor = new DefaultVisitor();
  visitor.ref = function (id, obj) {
    if (!refs[id]) {
      throw new Error('Non-existent reference');
    }
    refs[id].refs.push(obj);
  };

  var refs = {};
  for (var id in pdf.objects) {
    refs[id] = {object: pdf.objects[id], refs: []};
  }
  visitObject(pdf.trailer, visitor);
  for (var id in pdf.objects) {
    visitObject(pdf.objects[id], visitor);
  }
  return refs;
}

function indexPages(pdf) {
  var catalog = unref(pdf, getDictionaryKey(pdf.trailer, 'Root'));
  var pageTree = getDictionaryKey(catalog, 'Pages');
  var stack = [pageTree];
  var pagesRefs = [];
  while (stack.length > 0) {
    var ref = stack.pop();
    var item = unref(pdf, ref);
    if (item.dictionary.Type.name === 'Pages') {
      var kids = item.dictionary.Kids;
      for (var i = kids.length - 1; i >= 0; i--) {
        stack.push(kids[i]);
      }
    } else if (item.dictionary.Type.name === 'Page') {
      pagesRefs.push(ref.ref);
    }
  }
  return pagesRefs;
}

function normalizeIds(pdf) {
  function rename(oldRef, newRef) {
    if (oldRef === newRef) {
      return;
    }
    if (refIndex[newRef]) {
      throw new Error('Already exists');
    }
    var entry = refIndex[oldRef];
    delete refIndex[oldRef];
    delete pdf.objects[oldRef];
    pdf.objects[newRef] = entry.object;
    entry.refs.forEach(function (ref) {
      ref.ref = newRef;
    });
    refIndex[newRef] = entry;
  }

  var refIndex = indexRefs(pdf);
  var pages = indexPages(pdf);
  pages.forEach(function (pageRef, index) {
    var newRef = 'page' + (index + 1);
    rename(pageRef, newRef);
  });
  var catalog = getDictionaryKey(pdf.trailer, 'Root');
  if (catalog.ref) {
    rename(catalog.ref, 'catalog');
    catalog = unref(pdf, catalog);
  }

  var info = getDictionaryKey(pdf.trailer, 'Info');
  if (info.ref) {
    rename(info.ref, 'info');
  }

  var pages = getDictionaryKey(catalog, 'Pages');
  if (pages.ref) {
    rename(pages.ref, 'pages');
  }
}

function keepOnlyPages(pdf, pageNumbers) {
  var pages = indexPages(pdf);
  var newPages = pageNumbers.map(function (number) {
    return pages[number - 1];
  });
  var id = 'pages' + pageNumbers.join('-');
  var newPagesObject = {
    dictionary: {
      Type: 'Pages',
      Kids: newPages.map(function (ref) { return {ref: ref}; }),
      Count: newPages.length
    }
  };
  pdf.objects[id] = newPagesObject;
  newPages.forEach(function (ref) {
    var pageObject = pdf.objects[ref];
    pageObject.dictionary.Parent = {ref: id};
  });

  var catalog = unref(pdf, getDictionaryKey(pdf.trailer, 'Root'));
  catalog.dictionary.Pages = {ref: id};
}

function removeGarbage(pdf) {
  var visitor = new DefaultVisitor();
  visitor.ref = function (id, obj) {
    if (refs[id]) {
      return;
    }
    refs[id] = true;
    queue.push(pdf.objects[id]);
  };

  var refs = {};
  var queue = [pdf.trailer];
  while (queue.length > 0) {
    var item = queue.shift();
    visitObject(item, visitor);
  }
  for (var id in pdf.objects) {
    if (refs[id]) {
      continue;
    }
    delete pdf.objects[id];
  }
}

var OP_MAP = {
  // Graphic state
  w: { id: 'setLineWidth', numArgs: 1, variableArgs: false },
  J: { id: 'setLineCap', numArgs: 1, variableArgs: false },
  j: { id: 'setLineJoin', numArgs: 1, variableArgs: false },
  M: { id: 'setMiterLimit', numArgs: 1, variableArgs: false },
  d: { id: 'setDash', numArgs: 2, variableArgs: false },
  ri: { id: 'setRenderingIntent', numArgs: 1, variableArgs: false },
  i: { id: 'setFlatness', numArgs: 1, variableArgs: false },
  gs: { id: 'setGState', numArgs: 1, variableArgs: false },
  q: { id: 'save', numArgs: 0, variableArgs: false, group: 1 },
  Q: { id: 'restore', numArgs: 0, variableArgs: false, group: -1 },
  cm: { id: 'transform', numArgs: 6, variableArgs: false },

  // Path
  m: { id: 'moveTo', numArgs: 2, variableArgs: false },
  l: { id: 'lineTo', numArgs: 2, variableArgs: false },
  c: { id: 'curveTo', numArgs: 6, variableArgs: false },
  v: { id: 'curveTo2', numArgs: 4, variableArgs: false },
  y: { id: 'curveTo3', numArgs: 4, variableArgs: false },
  h: { id: 'closePath', numArgs: 0, variableArgs: false },
  re: { id: 'rectangle', numArgs: 4, variableArgs: false },
  S: { id: 'stroke', numArgs: 0, variableArgs: false },
  s: { id: 'closeStroke', numArgs: 0, variableArgs: false },
  f: { id: 'fill', numArgs: 0, variableArgs: false },
  F: { id: 'fill', numArgs: 0, variableArgs: false },
  'f*': { id: 'eoFill', numArgs: 0, variableArgs: false },
  B: { id: 'fillStroke', numArgs: 0, variableArgs: false },
  'B*': { id: 'eoFillStroke', numArgs: 0, variableArgs: false },
  b: { id: 'closeFillStroke', numArgs: 0, variableArgs: false },
  'b*': { id: 'closeEOFillStroke', numArgs: 0, variableArgs: false },
  n: { id: 'endPath', numArgs: 0, variableArgs: false },

  // Clipping
  W: { id: 'clip', numArgs: 0, variableArgs: false },
  'W*': { id: 'eoClip', numArgs: 0, variableArgs: false },

  // Text
  BT: { id: 'beginText', numArgs: 0, variableArgs: false, group: 1 },
  ET: { id: 'endText', numArgs: 0, variableArgs: false, group: -1 },
  Tc: { id: 'setCharSpacing', numArgs: 1, variableArgs: false },
  Tw: { id: 'setWordSpacing', numArgs: 1, variableArgs: false },
  Tz: { id: 'setHScale', numArgs: 1, variableArgs: false },
  TL: { id: 'setLeading', numArgs: 1, variableArgs: false },
  Tf: { id: 'setFont', numArgs: 2, variableArgs: false },
  Tr: { id: 'setTextRenderingMode', numArgs: 1, variableArgs: false },
  Ts: { id: 'setTextRise', numArgs: 1, variableArgs: false },
  Td: { id: 'moveText', numArgs: 2, variableArgs: false },
  TD: { id: 'setLeadingMoveText', numArgs: 2, variableArgs: false },
  Tm: { id: 'setTextMatrix', numArgs: 6, variableArgs: false },
  'T*': { id: 'nextLine', numArgs: 0, variableArgs: false },
  Tj: { id: 'showText', numArgs: 1, variableArgs: false },
  TJ: { id: 'showSpacedText', numArgs: 1, variableArgs: false },
  '\'': { id: 'nextLineShowText', numArgs: 1, variableArgs: false },
  '"': { id: 'nextLineSetSpacingShowText', numArgs: 3,
    variableArgs: false },

  // Type3 fonts
  d0: { id: 'setCharWidth', numArgs: 2, variableArgs: false },
  d1: { id: 'setCharWidthAndBounds', numArgs: 6, variableArgs: false },

  // Color
  CS: { id: 'setStrokeColorSpace', numArgs: 1, variableArgs: false },
  cs: { id: 'setFillColorSpace', numArgs: 1, variableArgs: false },
  SC: { id: 'setStrokeColor', numArgs: 4, variableArgs: true },
  SCN: { id: 'setStrokeColorN', numArgs: 33, variableArgs: true },
  sc: { id: 'setFillColor', numArgs: 4, variableArgs: true },
  scn: { id: 'setFillColorN', numArgs: 33, variableArgs: true },
  G: { id: 'setStrokeGray', numArgs: 1, variableArgs: false },
  g: { id: 'setFillGray', numArgs: 1, variableArgs: false },
  RG: { id: 'setStrokeRGBColor', numArgs: 3, variableArgs: false },
  rg: { id: 'setFillRGBColor', numArgs: 3, variableArgs: false },
  K: { id: 'setStrokeCMYKColor', numArgs: 4, variableArgs: false },
  k: { id: 'setFillCMYKColor', numArgs: 4, variableArgs: false },

  // Shading
  sh: { id: 'shadingFill', numArgs: 1, variableArgs: false },

  // Images
  BI: { id: 'beginInlineImage', numArgs: 0, variableArgs: false, group: 1 },
  ID: { id: 'beginImageData', numArgs: 0, variableArgs: true },
  EI: { id: 'endInlineImage', numArgs: 1, variableArgs: false, group: -1 },

  // XObjects
  Do: { id: 'paintXObject', numArgs: 1, variableArgs: false },
  MP: { id: 'markPoint', numArgs: 1, variableArgs: false },
  DP: { id: 'markPointProps', numArgs: 2, variableArgs: false },
  BMC: { id: 'beginMarkedContent', numArgs: 1, variableArgs: false, group: 1 },
  BDC: { id: 'beginMarkedContentProps', numArgs: 2,
    variableArgs: false, group: 1 },
  EMC: { id: 'endMarkedContent', numArgs: 0, variableArgs: false, group: -1 },

  // Compatibility
  BX: { id: 'beginCompat', numArgs: 0, variableArgs: false, group: 1 },
  EX: { id: 'endCompat', numArgs: 0, variableArgs: false, group: -1 },

  // (reserved partial commands for the lexer)
  BM: null,
  BD: null,
  'true': null,
  fa: null,
  fal: null,
  fals: null,
  'false': null,
  nu: null,
  nul: null,
  'null': null
};

function reviveContents(pdf) {
  function parseContent(data) {
    function readArray() {
      var result = [];
      while ((cmd = readItem()) !== EOF) {
        if (isCmd(cmd)) {
          if (cmd.cmd === ']') {
            break;
          }
          throw new Error('end of array is expected');
        }
        result.push(cmd);
      }
      return result;
    }

    function readDictionary() {
      var dict = {}, isKey = true, key = null;
      while ((cmd = readItem()) !== EOF) {
        if (isCmd(cmd)) {
          if (cmd.cmd === '>>') {
            break;
          }
          throw new Error('end of dictionary is expected');
        }
        if (!isKey) {
          dict[key] = cmd;
          isKey = true;
        } else {
          isKey = false;
          key = cmd.name;
        }
      }
      return {dictionary: dict};
    }

    function readItem() {
      var cmd = lexer.getObj();
      if (isCmd(cmd)) {
        switch (cmd.cmd) {
          case '<<':
            cmd = readDictionary();
            break;
          case '[':
            cmd = readArray();
            break;
        }
      } else if (isName(cmd)) {
        cmd = {name: cmd.name};
      }
      return cmd;
    }

    function readImageData(params) {
      // Extract the name of the first (i.e. the current) image filter.
      var i = 0, filterName;
      while (i < params.length) {
        if (params[i].name === 'Filter' || params[i].name === 'F') {
          var filter = params[i + 1];
          if (Array.isArray(filter)) {
            filterName = filter[0].name;
          } else {
            filterName = filter.name;
          }
          break;
        }
        i += 2;
      }

      // faking parser presence to use findXXXXStreamEnd
      var parser = Object.create(Parser.prototype);
      // Parse image stream.
      var startPos = stream.pos, length;
      if (filterName === 'DCTDecode' || filterName === 'DCT') {
        length = parser.findDCTDecodeInlineStreamEnd(stream);
      } else if (filterName === 'ASCII85Decide' || filterName === 'A85') {
        length = parser.findASCII85DecodeInlineStreamEnd(stream);
      } else if (filterName === 'ASCIIHexDecode' || filterName === 'AHx') {
        length = parser.findASCIIHexDecodeInlineStreamEnd(stream);
      } else {
        length = parser.findDefaultInlineStreamEnd(stream);
      }
      stream.pos = startPos;
      var whitespace = stream.peekByte();
      if (whitespace === 0 || whitespace === 9 || whitespace === 10 ||
          whitespace === 12 || whitespace === 13 || whitespace == 32) {
        stream.getByte();
        length--;
      }
      var data = stream.getBytes(length);

      var ei = lexer.getObj();
      if (!isCmd(ei, 'EI')) {
        throw new Error('EI is expected');
      }
      var encodedData, encoding;
      if (TextFilters.indexOf(filterName) >= 0) {
        encodedData = bytesToString(data);
        encoding = 'string';
      } else {
        encodedData = convertToHex(data);
        encoding = 'hex';
      }
      return {
        data: encodedData,
        encoding: encoding,
        cmd: 'EI'
      }
    }

    var stream = new StringStream(data);
    var lexer = new Lexer(stream, OP_MAP);
    var stack = [];
    var result = [];
    var args = [], cmd;
    while ((cmd = readItem()) !== EOF) {
      if (isCmd(cmd)) {
        if (cmd.cmd === 'BI') {
          args.forEach(result.push, result);
          args.length = 0;
        }

        var op = OP_MAP[cmd.cmd];
        var argsToConsume = !op || op.variableArgs ? args.length :
          op.numArgs;
        var cmdObj = {};
        if (op && op.id) {
          cmdObj.description = op.id;
        }
        if (argsToConsume > 0) {
          cmdObj.args = args.splice(args.length - argsToConsume, argsToConsume);
        }
        cmdObj.cmd = cmd.cmd;
        var groupDelta = op && op.group || 0;
        if (groupDelta > 0) {
          stack.push(result);
          result = [];
        }

        result.push(cmdObj);

        // Special case of BI/ID/EI
        if (cmd.cmd === 'ID') {
          result.push(readImageData(cmdObj.args));
          groupDelta = -1; // for EI
        }

        if (groupDelta < 0 && stack.length > 0) {
          var groupResult = result;
          result = stack.pop();
          result.push(groupResult);
        }
      } else {
        args.push(cmd);
      }
    }
    args.forEach(result.push, result);
    while (stack.length > 0) {
      var groupResult = result;
      result = stack.pop();
      result.push(groupResult);
    }
    return result;
  }

  function readStream(id) {
    var streamObj = unref(pdf, id);
    var data = streamObj.encoding === 'hex' ? convertFromHex(streamObj.data) :
                                              streamObj.data;
    var filters = unref(pdf, getDictionaryKey(streamObj.stream, 'Filter', 'F'));
    if (filters && !Array.isArray(filters)) {
      filters = [filters];
    }
    if (typeof data === 'string') {
      if (!filters) {
        return data;
      }
      data = stringToBytes(data);
    }

    var contentStream = new Stream(data, 0, data.length);
    var maybeLength = data.length;
    var params = unref(pdf, getDictionaryKey(streamObj.stream, 'DecodeParms', 'DP'));
    var wrappedParams = {
      has: function (name) { return name in params.dictionary; },
      get: function (name) { return params.dictionary[name]; }
    };
    filters.forEach(function (filter) {
      switch (filter.name) {
        case 'FlateDecode':
        case 'Fl':
          contentStream = new FlateStream(contentStream, maybeLength);
          if (params) {
            contentStream = new PredictorStream(contentStream, maybeLength, wrappedParams);
          }
          break;
        case 'LZWDecode':
        case 'LZW':
          var earlyChange = 1;
          if (params) {
            if (wrappedParams.has('EarlyChange')) {
              earlyChange = wrappedParams.get('EarlyChange');
            }
            contentStream = new PredictorStream(
              new LZWStream(contentStream, maybeLength, earlyChange),
              maybeLength, wrappedParams);
          }
          contentStream = new LZWStream(contentStream, maybeLength, earlyChange);
          break;
        case 'ASCII85Decode':
        case 'A85':
          contentStream = new Ascii85Stream(contentStream, maybeLength);
          break;
        case 'ASCIIHexDecode':
        case 'AHx':
          contentStream = new AsciiHexStream(contentStream, maybeLength);
          break;
        case 'RunLengthDecode':
        case 'RL':
          contentStream = new RunLengthStream(contentStream, maybeLength);
          break;
        default:
          throw new Error('unsupported encoding for content');
      }
    });
    data = contentStream.getBytes();
    return bytesToString(data);
  }

  function unpack(content, id) {
    content = unref(pdf, content);
    var result;
    if (Array.isArray(content)) {
      result = content.map(readStream).join('');
    } else {
      result = readStream(content);
    }
    result = parseContent(result);
    var contentObject = {
      content: result
    };
    pdf.objects[id] = contentObject;
  }

  var visitor = new DefaultVisitor();
  visitor.dictionary = function (dict) {
    if (dict.Type && dict.Type.name === 'Page') {
      var contentObjectId = 'content-of-' + dict.Contents.ref;
      unpack(dict.Contents, contentObjectId);
      dict.Contents = {ref: contentObjectId};
      return;
    }
    DefaultVisitor.prototype.dictionary.call(this, dict);
  };
  for (var i in pdf.objects) {
    visitObject(pdf.objects[i], visitor);
  }
}

function BinaryStream() {
  this.position = 0;
  this.chunks = [];
}
BinaryStream.prototype.write = function (s) {
  if (typeof s === 'string' || Array.isArray(s) || s instanceof Uint8Array) {
    this.chunks.push(s);
    this.position += s.length;
  } else {
    throw new Error('Invalid output type');
  }
};
BinaryStream.prototype.toArrayBuffer = function () {
  var buffer = new Uint8Array(this.position);
  var position = 0;
  this.chunks.forEach(function (chunk) {
    var i;
    if (chunk instanceof Uint8Array) {
      buffer.set(chunk, position);
      position += chunk.length;
    } else if (typeof chunk === 'string') {
      for (i = 0; i < chunk.length; i++) {
        buffer[position++] = chunk.charCodeAt(i);
      }
    } else {
      for (i = 0; i < chunk.length; i++) {
        buffer[position++] = chunk[i];
      }
    }
  });
  return buffer.buffer;
};
BinaryStream.prototype.appendTo = function (stream) {
  this.chunks.forEach(stream.write, stream);
};

function formatName(name) {
  return '/' + name.replace(/[^\x21-\x22\x24-\x7e]/g, function (all) {
    return '#' + (256 + all.charCodeAt(0)).toString(16).substring(1);
  });
}

function convertFromHex(hex) {
  var buffer = new Uint8Array(hex.length >> 1);
  for (var i = 0, j = 0; i < hex.length; i += 2, j++) {
    buffer[j] = parseInt(hex.substr(i, 2), 16);
  }
  return buffer;
}

function serializeContent(stream, content) {
  if (typeof content === 'string' || stream instanceof Uint8Array) {
    stream.write(content);
    return;
  }
  if (Array.isArray(content)) {
    content.forEach(function (item, index) {
      if (index > 0) {
        stream.write('\n');
      }
      serializeContent(stream, item);
    });
    return;
  }

  serializeObject(stream, content, '', null);
}

function serializeObject(stream, obj, indent, refs) {
  var visitor = {
    number: function (value) {
      stream.write('' + value);
    },
    boolean: function (value) {
      stream.write('' + value);
    },
    string: function (value) {
      var s = value.replace(/[^\x20-\x27\x2a-\x5b\x5d-\x7e]/g, function (all) {
        return '\\' + (512 + all.charCodeAt(0)).toString(8).substring(1);
      });
      stream.write('(' + s + ')');
    },
    null: function () {
      stream.write('null');
    },
    array: function (value) {
      stream.write('[');
      value.forEach(function (item, index) {
        if (index > 0) {
          stream.write(' ');
        }
        visitObject(item, visitor);
      });
      stream.write(']');
    },
    name: function (name) {
      stream.write(formatName(name));
    },
    ref: function (id, obj) {
      var ref = refs[id];
      stream.write(ref + ' 0 R');
    },
    dictionary: function (dict) {
      var hasContent = false, separator = '\n' + indent + '   ';
      stream.write('<< ');
      var oldIndent = currentIndent;
      for (var prop in dict) {
        if (hasContent) {
          stream.write(separator);
        } else {
          hasContent = true;
        }
        var name = formatName(prop);
        stream.write(name + ' ');
        currentIndent = indent + (new Array(name.length + 3).join(' '));
        visitObject(dict[prop], visitor);
      }
      currentIndent = oldIndent;
      stream.write('\n' + indent + '>>');
    },
    stream: function (dictObj, encoding, data) {
      visitObject(dictObj, visitor);
      stream.write('\nstream\n');
      if (!encoding || encoding === 'string') {
        if(!(Array.isArray(data) || data instanceof Uint8Array ||
             typeof data === 'string')) {
          throw new Error('array or string is expected in the data field');
        }
        stream.write(data);
      } else if (encoding === 'hex') {
        stream.write(convertFromHex(data));
      } else {
        throw new Error('invalid encoding');
      }
      stream.write('\nendstream');
    },
    content: function (content) {
      var contentStream = new BinaryStream();
      serializeContent(contentStream, content);

      visitObject({
        dictionary: {
          Length: contentStream.position
        }
      }, visitor);
      stream.write('\nstream\n');
      contentStream.appendTo(stream);
      stream.write('\nendstream');
    },
    cmd: function (cmd, args, data, encoding) {
      if (args) {
        for (var i = 0; i < args.length; i++) {
          visitObject(args[i], visitor);
          stream.write(' ');
        }
      }
      if (data) {
        if (encoding === 'hex') {
          stream.write(convertFromHex(data));
        } else {
          stream.write(data);
        }
      }
      stream.write(cmd);
    }
  };
  var currentIndent = indent;
  visitObject(obj, visitor);
}

function savePDF(pdf) {
  var stream = new BinaryStream();
  stream.write('%PDF-' + pdf.version + '\n%\xD0\xC4\xC6\xAE\xEA\xF3\n');
  var objectsToWrite = Object.keys(pdf.objects);
  var refs = Object.create(null);
  var offsets = [null];
  var i;
  for (i = 0; i < objectsToWrite.length; i++) {
    refs[objectsToWrite[i]] = i + 1;
  }
  for (i = 0; i < objectsToWrite.length; i++) {
    var id = objectsToWrite[i];
    stream.write('%object:' + id + '\n');
    offsets.push(stream.position);
    stream.write((i + 1) + ' 0 obj\n');
    serializeObject(stream, pdf.objects[id], '', refs);
    stream.write('\nendobj\n');
  }
  var xrefOffset = stream.position;
  stream.write('xref\n0 ' + offsets.length + '\n');
  for (i = 0; i < offsets.length; i++) {
    var offset = offsets[i];
    if (offset === null) {
      stream.write('0000000000 65535 f\n');
      continue;
    }
    var line = (1e11 + offset).toString().substr(1) + ' 0 n\n';
    stream.write(line);
  }
  stream.write('trailer\n');
  serializeObject(stream, pdf.trailer, '', refs);
  stream.write('\nstartxref\n' + xrefOffset + '\n%%EOF');
  return stream.toArrayBuffer();
}