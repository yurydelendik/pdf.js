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
  var svg = document.createElement('svg');
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("xmlns", "http://wwww.w3.org/2000/svg")
  svg.setAttribute("version", "1.1");
  return svg;
}

function getContext() {
  var ctx = document.createElement("g");
  return ctx;
}

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

  function SVGGraphics() {

  }

  SVGGraphics.prototype = {

    beginDrawing: function SVGGraphics_beginDrawing(viewport, transparency) {

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
      
    },
  }

  return SVGGraphics;
})();
