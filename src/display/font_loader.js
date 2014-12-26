/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/* Copyright 2012 Mozilla Foundation
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
/* globals PDFJS, shadow, isWorker, assert, warn, bytesToString, string32, 
           globalScope, FontFace, Promise */

'use strict';

PDFJS.disableFontFace = false;

//#if !(MOZCENTRAL)
var FontLoaderFactory = {
  get isSyncFontLoadingSupported() {
    var supported = false;
    if (!isWorker) {
      // User agent string sniffing is bad, but there is no reliable way to tell
      // if font is fully loaded and ready to be used with canvas.
      var userAgent = window.navigator.userAgent;
      var m = /Mozilla\/5.0.*?rv:(\d+).*? Gecko/.exec(userAgent);
      if (m && m[1] >= 14) {
        supported = true;
      } else if (userAgent === 'node') {
        supported = true;
      }
      // TODO other browsers
    }
    return shadow(this, 'isSyncFontLoadingSupported', supported);
  },

  get isFontLoadingAPISupported() {
    return !isWorker && !!document.fonts;
  },

  createFontLoader: function FontLoaderFactory_createFontLoader() {
    if (this.isSyncFontLoadingSupported) {
      return new StyleFontLoader();
    }
    if (this.isFontLoadingAPISupported) {
      return new FontFaceLoader();
    }
    return new GenericFontLoader();
  }
};
//#else
//var FontLoaderFactory = {
//  createFontLoader: function FontLoaderFactory_createFontLoader() {
//    return new StyleFontLoader();
//  }
//};
//#endif

function addFontToPDFBug(font, url) {
  if (PDFJS.pdfBug && 'FontInspector' in globalScope &&
    globalScope['FontInspector'].enabled) {
    globalScope['FontInspector'].fontAdded(font, url);
  }
}

var FontLoaderBase = (function FontLoaderBaseClosure() {
  function FontLoaderBase() {
    this._fonts = Object.create(null);
  }
  FontLoaderBase.prototype = {
    clear: function FontLoaderBase_clear() {
      Object.keys(this._fonts).forEach(function (fontName) {
        this.unload(this._fonts[fontName].font);
      }, this);
    },
    _unloadFromDOM: function FontLoaderBase_unloadFromDOM(fontName) {
      throw new Error('abstract method');
    },
    unload: function FontLoaderBase_unload(font) {
      var fontName = font.loadedName;
      if (!this._fonts[fontName]) {
        return;
      }
      this._unloadFromDOM(fontName);
      delete this._fonts[fontName];
    },
    _loadIntoDOM: function FontLoaderBase_loadIntoDOM(fontName, font) {
      throw new Error('abstract method');
    },
    load: function FontLoaderBase_load(font) {
      var fontName = font.loadedName;
      if (this._fonts[fontName]) {
        return this._fonts[fontName].promise;
      }
      var promise = this._loadIntoDOM(fontName, font);
      var fontState = {
        font: font,
        promise: promise,
        loadedName: fontName,
        loaded: false
      };
      this._fonts[fontName] = fontState;
      return promise.then(function () {
        fontState.loaded = true;
      });
    },
    getDOMFontName: function (fontName) {
      var fontState = this._fonts[fontName];
      return fontState ? fontState.loadedName : undefined;
    },
    isLoaded: function FontLoaderBase_isLoaded(fontName) {
      var fontState = this._fonts[fontName];
      return fontState ? fontState.loaded : false;
    }
  };
  return FontLoaderBase;
})();

var StyleFontLoader = (function StyleFontLoaderClosure() {
  var STYLE_ELEMENT_ID = 'PDFJS_FONT_STYLE_TAG';

  // Keeping fontName-to-cssRule map for removeRule
  var cssRulesMap = Object.create(null);

  function StyleFontLoader() {
    FontLoaderBase.call(this);
  }

  StyleFontLoader.insertRule = function StyleFontLoader_insertRule(fontName,
                                                                   url) {
    var styleElement = document.getElementById(STYLE_ELEMENT_ID);
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = STYLE_ELEMENT_ID;
      document.documentElement.getElementsByTagName('head')[0].appendChild(
        styleElement);
    }

    // Add the font-face rule to the document
    var styleSheet = styleElement.sheet;
    var rule = '@font-face {font-family:"' + fontName + '";' +
               'src:url(' + url + ');}';
    var index = styleSheet.cssRules.length;
    styleSheet.insertRule(rule, index);
    cssRulesMap[fontName] = styleSheet.cssRules[index];
  };
  StyleFontLoader.removeRule = function StyleFontLoader_removeRule(fontName) {
    var styleElement = document.getElementById(STYLE_ELEMENT_ID);
    if (styleElement) {
      var cssRule = cssRulesMap[fontName];
      delete cssRulesMap[fontName];

      var styleSheet = styleElement.sheet;
      for (var i = 0, ii = styleSheet.cssRules.length; i < ii; i++) {
        if (styleSheet.cssRules[i] === cssRule) {
          styleSheet.deleteRule(i);
          break;
        }
      }
    }
  };

  StyleFontLoader.prototype = Object.create(FontLoaderBase.prototype);
  StyleFontLoader.prototype._unloadFromDOM =
      function StyleFontLoader_unloadFromDOM(fontName) {
    StyleFontLoader.removeRule(fontName);
  };
  StyleFontLoader.prototype._loadIntoDOM =
      function StyleFontLoader_loadIntoDOM(fontName, font) {
    var data = bytesToString(new Uint8Array(font.data));

    // Synchronous font loading works only for data: uri
    var url = 'data:' + font.mimetype + ';base64,' + window.btoa(data);
    StyleFontLoader.insertRule(fontName, url);

    addFontToPDFBug(font, url);

    return Promise.resolve(undefined);
  };
  return StyleFontLoader;
})();

//#if !(MOZCENTRAL)
var FontFaceLoader = (function FontFaceLoaderClosure() {
  function FontFaceLoader() {
    FontLoaderBase.call(this);
    this.nativeFontFaces = Object.create(null);
  }
  FontFaceLoader.prototype = Object.create(FontLoaderBase.prototype);
  FontFaceLoader.prototype._unloadFromDOM =
      function FontFaceLoader_unloadFromDOM(fontName) {
    var nativeFontFace = this.nativeFontFaces[fontName];
    delete this.nativeFontFaces[fontName];
    document.fonts.delete(nativeFontFace);
  };
  FontFaceLoader.prototype._loadIntoDOM =
      function FontFaceLoader_loadIntoDOM(fontName, font) {
    var nativeFontFace = new FontFace(fontName, font.data, {});
    this.nativeFontFaces[fontName] = nativeFontFace;
    document.fonts.add(nativeFontFace);

    addFontToPDFBug(font, undefined);

    return nativeFontFace.loaded;
  };
  return FontFaceLoader;
})();

var GenericFontLoader = (function GenericFontLoaderClosure() {
  var loadTestFont;
  function getLoadTestFont() {
    if (loadTestFont) {
      return loadTestFont;
    }
    // This is a CFF font with 1 glyph for '.' that fills its entire width and
    // height.
    return loadTestFont = atob(
      'T1RUTwALAIAAAwAwQ0ZGIDHtZg4AAAOYAAAAgUZGVE1lkzZwAAAEHAAAABxHREVGABQAFQ' +
      'AABDgAAAAeT1MvMlYNYwkAAAEgAAAAYGNtYXABDQLUAAACNAAAAUJoZWFk/xVFDQAAALwA' +
      'AAA2aGhlYQdkA+oAAAD0AAAAJGhtdHgD6AAAAAAEWAAAAAZtYXhwAAJQAAAAARgAAAAGbm' +
      'FtZVjmdH4AAAGAAAAAsXBvc3T/hgAzAAADeAAAACAAAQAAAAEAALZRFsRfDzz1AAsD6AAA' +
      'AADOBOTLAAAAAM4KHDwAAAAAA+gDIQAAAAgAAgAAAAAAAAABAAADIQAAAFoD6AAAAAAD6A' +
      'ABAAAAAAAAAAAAAAAAAAAAAQAAUAAAAgAAAAQD6AH0AAUAAAKKArwAAACMAooCvAAAAeAA' +
      'MQECAAACAAYJAAAAAAAAAAAAAQAAAAAAAAAAAAAAAFBmRWQAwAAuAC4DIP84AFoDIQAAAA' +
      'AAAQAAAAAAAAAAACAAIAABAAAADgCuAAEAAAAAAAAAAQAAAAEAAAAAAAEAAQAAAAEAAAAA' +
      'AAIAAQAAAAEAAAAAAAMAAQAAAAEAAAAAAAQAAQAAAAEAAAAAAAUAAQAAAAEAAAAAAAYAAQ' +
      'AAAAMAAQQJAAAAAgABAAMAAQQJAAEAAgABAAMAAQQJAAIAAgABAAMAAQQJAAMAAgABAAMA' +
      'AQQJAAQAAgABAAMAAQQJAAUAAgABAAMAAQQJAAYAAgABWABYAAAAAAAAAwAAAAMAAAAcAA' +
      'EAAAAAADwAAwABAAAAHAAEACAAAAAEAAQAAQAAAC7//wAAAC7////TAAEAAAAAAAABBgAA' +
      'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAA' +
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAA' +
      'AAAAD/gwAyAAAAAQAAAAAAAAAAAAAAAAAAAAABAAQEAAEBAQJYAAEBASH4DwD4GwHEAvgc' +
      'A/gXBIwMAYuL+nz5tQXkD5j3CBLnEQACAQEBIVhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWF' +
      'hYWFhYWFhYAAABAQAADwACAQEEE/t3Dov6fAH6fAT+fPp8+nwHDosMCvm1Cvm1DAz6fBQA' +
      'AAAAAAABAAAAAMmJbzEAAAAAzgTjFQAAAADOBOQpAAEAAAAAAAAADAAUAAQAAAABAAAAAg' +
      'ABAAAAAAAAAAAD6AAAAAAAAA=='
    );
  }

  var testCanvas, testCanvasContext;
  function getTestCanvasContext() {
    if (testCanvas) {
      testCanvasContext.clearRect(0, 0, 1, 1);
      return testCanvasContext;
    }
    testCanvas = document.createElement('canvas');
    testCanvas.width = 1;
    testCanvas.height = 1;
    testCanvasContext = testCanvas.getContext('2d');
    return testCanvasContext;
  }

  function prepareFontLoadEvent(request) {
    /** Hack begin */
    // There's currently no event when a font has finished downloading so the
    // following code is a dirty hack to 'guess' when a font is
    // ready. It's assumed fonts are loaded in order, so add a known test
    // font after the desired fonts and then test for the loading of that
    // test font.

    function int32(data, offset) {
      return (data.charCodeAt(offset) << 24) |
        (data.charCodeAt(offset + 1) << 16) |
        (data.charCodeAt(offset + 2) << 8) |
        (data.charCodeAt(offset + 3) & 0xff);
    }

    function spliceString(s, offset, remove, insert) {
      var chunk1 = s.substr(0, offset);
      var chunk2 = s.substr(offset + remove);
      return chunk1 + insert + chunk2;
    }

    var i, ii;
    var called = 0;

    function isFontReady(name, callback) {
      called++;
      // With setTimeout clamping this gives the font ~100ms to load.
      if (called > 30) {
        warn('Load test font never loaded.');
        callback();
        return;
      }
      var ctx = getTestCanvasContext();
      ctx.font = '30px ' + name;
      ctx.fillText('.', 0, 20);
      var imageData = ctx.getImageData(0, 0, 1, 1);
      if (imageData.data[3] > 0) {
        callback();
        return;
      }
      setTimeout(isFontReady.bind(null, name, callback));
    }

    var loadTestFontId = 'lt' + Date.now() + request.id;
    // Chromium seems to cache fonts based on a hash of the actual font data,
    // so the font must be modified for each load test else it will appear to
    // be loaded already.
    // TODO: This could maybe be made faster by avoiding the btoa of the full
    // font by splitting it in chunks before hand and padding the font id.
    var data = getLoadTestFont();
    var COMMENT_OFFSET = 976; // has to be on 4 byte boundary (for checksum)
    data = spliceString(data, COMMENT_OFFSET, loadTestFontId.length,
      loadTestFontId);
    // CFF checksum is important for IE, adjusting it
    var CFF_CHECKSUM_OFFSET = 16;
    var XXXX_VALUE = 0x58585858; // the "comment" filled with 'X'
    var checksum = int32(data, CFF_CHECKSUM_OFFSET);
    for (i = 0, ii = loadTestFontId.length - 3; i < ii; i += 4) {
      checksum = (checksum - XXXX_VALUE + int32(loadTestFontId, i)) | 0;
    }
    if (i < loadTestFontId.length) { // align to 4 bytes boundary
      checksum = (checksum - XXXX_VALUE +
        int32(loadTestFontId + 'XXX', i)) | 0;
    }
    data = spliceString(data, CFF_CHECKSUM_OFFSET, 4, string32(checksum));

    var url = 'data:font/opentype;base64,' + btoa(data);
    StyleFontLoader.insertRule(loadTestFontId, url); // adding helper font

    var div = document.createElement('div'), span;
    div.setAttribute('style',
                     'visibility: hidden;' +
                     'width: 10px; height: 10px;' +
                     'position: absolute; top: 0px; left: 0px;');
    span = document.createElement('span');
    span.textContent = 'Hi';
    span.style.fontFamily = request.fontName;
    div.appendChild(span);
    span = document.createElement('span');
    span.textContent = '.';
    span.style.fontFamily = loadTestFontId;
    div.appendChild(span);
    document.body.appendChild(div);

    isFontReady(loadTestFontId, function () {
      StyleFontLoader.removeRule(loadTestFontId);
      document.body.removeChild(div);
      request.complete();
    });
    /** Hack end */
  }

  var requests = [], nextRequestId = 0;
  function onFontLoaded(fontName) {
    function completeRequest() {
      assert(!request.end, 'completeRequest() cannot be called twice');
      request.end = Date.now();

      // sending all completed requests in order how they were queued
      while (requests.length > 0 && requests[0].end) {
        var otherRequest = requests.shift();
        otherRequest.resolve();
      }
    }

    var request = {
      id: nextRequestId++,
      fontName: fontName,
      complete: completeRequest,
      resolve: null, // assigned below
      started: Date.now(),
      end: 0
    };
    var promise = new Promise(function (resolve) {
      request.resolve = resolve;
    });
    requests.push(request);

    prepareFontLoadEvent(request);

    return promise;
  }

  function GenericFontLoader() {
    StyleFontLoader.call(this);
  }
  GenericFontLoader.prototype = Object.create(StyleFontLoader.prototype);
  GenericFontLoader.prototype._loadIntoDOM =
      function GenericFontLoader_loadIntoDOM(fontName, font) {
    return StyleFontLoader.prototype._loadIntoDOM.call(this, fontName, font)
        .then(function () {
      return onFontLoaded(fontName);
    });
  };

  return GenericFontLoader;
})();
//#endif

var FontFaceObject = (function FontFaceObjectClosure() {
  function FontFaceObject(data) {
    this.compiledGlyphs = Object.create(null);
    this.disableFontFace = PDFJS.disableFontFace;

    // importing translated data
    for (var i in data) {
      this[i] = data[i];
    }
  }
  FontFaceObject.prototype = {
    getPathGenerator:
        function FontFaceObject_getPathGenerator(objs, character) {
      if (!(character in this.compiledGlyphs)) {
        var js = objs.get(this.loadedName + '_path_' + character);
        /*jshint -W054 */
        this.compiledGlyphs[character] = new Function('c', 'size', js);
      }
      return this.compiledGlyphs[character];
    },

    get needsFontFaceRegistration() {
      return this.data && !this.disableFontFace && this.isFontFace;
    }
  };
  return FontFaceObject;
})();
