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

function getContext() {
  var ctx = document.createElemenNS("svg:g");
  return ctx;
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
    this.wordSpacing = 0;
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

function applyTextTransform(textMatrix, x, y) {
  textMatrix[4] = x;
  textMatrix[5] = y;
  return textMatrix;

}


var SVGGraphics = (function SVGGraphicsClosure(ctx) {

  function SVGGraphics() {

    this.current = new SVGExtraState();

  }

  SVGGraphics.prototype = {

    beginDrawing: function SVGGraphics_beginDrawing(viewport) {
      console.log("begind drawing svg")
      this.svg = createScratchSVG(viewport.width, viewport.height);
      this.NS = "http://www.w3.org/2000/svg";
      this.container = document.getElementById('pageContainer');
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

      console.log(JSON.stringify(opTree));

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
        if(fn == 'endText') {
          this.endText(argsArray[x]);
        }
      }
    },

    beginText: function SVGGraphics_beginText(args) {
      this.current.textMatrix = IDENTITY_MATRIX;
      this.text = document.createElementNS(this.NS, 'svg:text');
      this.text.setAttributeNS(null, "fill", "black")
    },

    setLeading: function SVGGraphics_setLeading(leading) {
      this.current.leading = -leading;
    },

    moveText: function SVGGraphics_moveText(x, y) {
      this.current.x = this.current.lineX += x;
      this.current.y = this.current.lineY += y;
      this.text.setAttributeNS(null, "x", this.current.x);
      this.text.setAttributeNS(null, "y", this.current.y)
      this.current.textMatrix = applyTextTransform(this.current.textMatrix, x, y);
    },

    showText: function SVGGraphics_showText(text) {
      /*var current = this.current;
      var i;
      for (i =0; i < text.length; i++) {
        if (text[i] == null) {
          x += current.fontDirection * wordSpacing;
          continue;
        }

        width = vmetric ? -vmetric[0] : glyph.width;
        var charWidth = width * fontSize * current.fontMatrix[0] +
                        charSpacing * current.fontDirection;
        var character = text.fontChar;

        this.paintChar(character);

        x += charWidth;*/

        var current = this.current;

        var str = '';
        var text = text[0];
        //console.log(text[0]);
        for (var i = 0; i < text.length; i++) {
          if (text[i] == null) {
            //x += current.fontDirection * wordSpacing;
            continue;
          }
          console.log(text[i].fontChar)
          str += text[i].fontChar;
        }
        this.text.textContent = str;
    },

    /*paintChar: function SVGGraphics_paintChar(character) {

    }*/

    setLeadingMoveText: function SVGGraphics_setLeadingMoveText(coords) {
      this.setLeading(-coords[1]);
      this.moveText(coords[0], coords[1]);
    },

    setFont: function SVGGraphics_setFont(details) {
      this.text.setAttributeNS(null, "font-family", "verdana");
      this.text.setAttributeNS(null, "font-size", details[1]);
    },

    endText: function SVGGraphics_endText(args) {
      this.text.setAttributeNS(null, "transform", "matrix(" + this.current.textMatrix.join(' ') + ")");
      this.svg.appendChild(this.text);
      this.container.appendChild(this.svg)
    }

  }

  return SVGGraphics;
})();
