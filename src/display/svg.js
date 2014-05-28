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
/* globals ColorSpace, DeviceCmykCS, DeviceGrayCS, DeviceRgbCS, error, PDFJS,
           FONT_IDENTITY_MATRIX, Uint32ArrayView, IDENTITY_MATRIX, ImageData,
           ImageKind, isArray, isNum, TilingPattern, OPS, Promise, Util, warn,
           assert, info, shadow, TextRenderingMode, getShadingPatternFromIR,
           WebGLUtils */

'use strict';

function createScratchSVG(width, height) {
  var NS = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(NS, 'svg:svg');
  svg.setAttributeNS(null, "version", "1.1");
  svg.setAttributeNS(null, "width", width + 'px');
  svg.setAttributeNS(null, "height", height + 'px');
  return svg;
}

var SVGExtraState = (function SVGExtraStateClosure() {
  function SVGExtraState(old) {
    // Are soft masks and alpha values shapes or opacities?
    this.fontSize = 0;
    this.fontSizeScale = 1;
    this.textMatrix = IDENTITY_MATRIX;
    this.fontMatrix = FONT_IDENTITY_MATRIX;
    this.leading = 0;
    // Current point (in user coordinates)
    this.x = 0;
    this.y = 0;
    // Start of text line (in text coordinates)
    this.lineX = 0;
    this.lineY = 0;
    // Character and word spacing
    this.charSpacing = 0;
    this.wordSpacing = 1;
    this.textHScale = 1;
    this.textRenderingMode = TextRenderingMode.FILL;
    this.textRise = 0;
    // Default fore and background colors
    this.fillColor = '#000000';
    this.strokeColor = '#000000';

  }

  SVGExtraState.prototype = {
    clone: function CanvasExtraState_clone() {
      return Object.create(this);
    },
    setCurrentPoint: function CanvasExtraState_setCurrentPoint(x, y) {
      this.x = x;
      this.y = y;
    }
  };
  return SVGExtraState;
})();

function opListToTree(opList) {

  var opTree = [];
  var saveIdx = [];
  var restIdx = [];
  var tmp = [];
  var items = [];


  for (var x = 0; x < opList.length; x++) {
    if (opList[x].fn == 'save') {
      opTree.push({'fn': 'group', 'items': []});
      tmp.push(opTree);
      opTree = opTree[opTree.length - 1].items;
      continue;
    }

    if(opList[x].fn == 'restore') {
      opTree = tmp.pop();
    }
    else {
      opTree.push(opList[x]);
    }
  }
  return opTree;
}


var SVGGraphics = (function SVGGraphicsClosure(ctx) {

  function SVGGraphics(commonObjs) {

    this.current = new SVGExtraState();
    this.transformMatrix = []; // Graphics state matrix
    this.transformStack = [];
    this.extraStack = [];
    this.commonObjs = commonObjs;

  }

  SVGGraphics.prototype = {

    save: function SVGGraphics_save() {
      this.transformStack.push(this.transformMatrix);
      this.extraStack.push(this.current);
    },

    restore: function SVGGraphics_restore() {
      this.transformMatrix = this.transformStack.pop();
      this.current = this.extraStack.pop();
    },

    transform: function SVGGraphics_transform(transformMatrix) {
      PDFJS.Util.transform(this.transformMatrix, transforMatrix);
    },

    beginDrawing: function SVGGraphics_beginDrawing(viewport) {
      console.log("begin drawing svg")
      this.svg = createScratchSVG(viewport.width, viewport.height);
      this.NS = "http://www.w3.org/2000/svg";
      this.container = document.getElementById('pageContainer');
      this.viewport = viewport;
      this.transformMatrix = [];
      this.container.appendChild(this.svg);
    },
    
    executeOperatorList: function SVGGraphics_executeOperatorList(operatorList) {

      var argsArray = operatorList.argsArray;
      var fnArray = operatorList.fnArray;
      var fnArrayLen  = fnArray.length;
      var argsArrayLen = argsArray.length;
      var opTree = [];

      var REVOPS = OPS;

      for (var op in REVOPS) {
        REVOPS[REVOPS[op]] = op;
      }

      var opList = [];

      for (var x = 0; x < fnArrayLen; x++) {
        var fnId = fnArray[x];
        opList.push({'fn': REVOPS[fnId], 'args': argsArray[x]});
      }

      opTree = opListToTree(opList);

      console.log(opTree)

      window.prompt('', JSON.stringify(opTree));

      for(var x =0; x < opTree.length; x++) {
        var fn = opTree[x].fn;

        if (fn == 'beginText') {
          this.beginText(argsArray[x]);
        }
        if (fn == 'setLeadingMoveText') {
          this.setLeadingMoveText(argsArray[x]);
        }
        if (fn == 'setFont') {
          this.setFont(argsArray[x]);
        }
        if (fn == 'showText') {
          this.showText(argsArray[x]);
        }
        if (fn == 'showSpacedText') {
          this.showSpacedText(argsArray[x]);
        }
        if(fn == 'endText') {
          this.endText(argsArray[x]);
        }
        if(fn == 'moveText') {
          this.moveText(argsArray[x]);
        }
      }
    },

    beginText: function SVGGraphics_beginText(args) {
      this.current.x = this.current.lineX = 0;
      this.current.y = this.current.lineY = 0;
      this.current.textMatrix = IDENTITY_MATRIX;
      this.current.lineMatrix = IDENTITY_MATRIX;
      console.log(this.current.textMatrix)
      //this.text = document.createElementNS(this.NS, 'svg:text');
    },

    setLeading: function SVGGraphics_setLeading(leading) {
      this.current.leading = -leading;
    },

    moveText: function SVGGraphics_moveText(args) {
      var current = this.current;
      this.current.x = this.current.lineX += args[0];
      this.current.y = this.current.lineY += args[1];
      this.current.textMatrix[4] = current.x;
      this.current.textMatrix[5] = current.y;
      //current.textMatrix = PDFJS.Util.transform([1, 0, 0, 1, args[0], args[1]], current.textMatrix)
    },

    showText: function SVGGraphics_showText(text) {
      var str = '';
      var current = this.current;
      var fontDirection = current.fontDirection;
      var fontSize = current.fontSize;
      var wordSpacing = current.wordSpacing;
      var textHScale = current.textHScale * fontDirection;
      var charSpacing = current.charSpacing;
      var vertical = false;
      var font = current.font;
      var style = current.font.style;



      var tx = PDFJS.Util.transform(this.viewport.transform, current.textMatrix); // Apply viewport transform
      tx = PDFJS.Util.transform(tx, [1, 0, 0, -1, 0, 0]); // Flip text

      var t = 0;

      for (var x = 0; x < text.length; x++) {
        if (text[x] == null) {
          t += current.fontDirection * wordSpacing;
          continue;
        } else {
          str += text[x].fontChar;
          var charWidth = text[x].width * fontSize * current.fontMatrix[0] + charSpacing * current.fontDirection;
          t += charWidth;
        }
      }

      current.x += t * textHScale;
      current.textMatrix[4] = current.x;

      var txtElement = document.createElementNS(this.NS, 'svg:text');
      txtElement.textContent = str;
      txtElement.setAttributeNS(null, 'font-family', 'verdana');
      txtElement.setAttributeNS(null, 'font-size', current.fontSize);
      txtElement.setAttributeNS(null, 'style', current.font.style);
      txtElement.setAttributeNS(null, 'transform', 'matrix(' + tx + ')');
      this.svg.appendChild(txtElement);
    },

    showSpacedText: function SVGGraphics_showSpacedText(arr) {
      var current = this.current;
      var font = current.font;
      var fontSize = current.fontSize;
      var charSpacing = current.charSpacing;
      // TJ array's number is independent from fontMatrix
      var textHScale = current.textHScale * 0.001 * current.fontDirection;
      var arrLength = arr[0].length;
      var vertical = false;

      var x = 0;
      var arr = arr[0];

      for (var i = 0; i < arrLength; ++i) {
        var e = arr[i];
        if (isNum(e)) {
          var spacingLength = -e * fontSize * textHScale;
          if (vertical) {
            current.y += spacingLength;
            current.textMatrix[5] = current.y;
          } else {
            current.x += spacingLength;
            current.textMatrix[4] = current.x;
          }
        } else {
          this.showText(e);
        }
        
      }

    },

    setLeadingMoveText: function SVGGraphics_setLeadingMoveText(coords) {
      this.setLeading(-coords[1]);
      this.moveText(coords);
    },

    setFont: function SVGGraphics_setFont(details) {
      var current = this.current;
      var fontObj = this.commonObjs.get(details[0]);
      var size = details[1];
      this.current.font = fontObj;

      current.fontMatrix = (fontObj.fontMatrix ?
                           fontObj.fontMatrix : FONT_IDENTITY_MATRIX);

      var bold = fontObj.black ? (fontObj.bold ? 'bolder' : 'bold') :
                                 (fontObj.bold ? 'bold' : 'normal');

      var italic = fontObj.italic ? 'italic' : 'normal';

      current.font.style = (bold == 'normal' ? (italic == 'normal' ? '' : 'font-weight:' + italic) :
                                                   'font-weight:' + bold);

      if (size < 0) {
        size = -size;
        current.fontDirection = -1;
      } else {
        current.fontDirection = 1;
      }
      current.fontSize = size;
      current.fontFamily = fontObj.loadedName;
    },

    endText: function SVGGraphics_endText(args) {

    }

  }

  return SVGGraphics;
})();
