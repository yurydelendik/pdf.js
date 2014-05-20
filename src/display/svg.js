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


function addContextCurrentTransform(ctx) {
	if (!ctx.mozCurrentTransform) {
	  // Store the original context
	  ctx._scaleX = ctx._scaleX || 1.0;
	  ctx._scaleY = ctx._scaleY || 1.0;
	  ctx._originalSave = ctx.save;
	  ctx._originalRestore = ctx.restore;
	  ctx._originalRotate = ctx.rotate;
	  ctx._originalScale = ctx.scale;
	  ctx._originalTranslate = ctx.translate;
	  ctx._originalTransform = ctx.transform;
	  ctx._originalSetTransform = ctx.setTransform;

	  ctx._transformMatrix = [ctx._scaleX, 0, 0, ctx._scaleY, 0, 0];
	  ctx._transformStack = [];

	  Object.defineProperty(ctx, 'mozCurrentTransform', {
	    get: function getCurrentTransform() {
	      return this._transformMatrix;
	    }
	  });

	  Object.defineProperty(ctx, 'mozCurrentTransformInverse', {
	    get: function getCurrentTransformInverse() {
	      // Calculation done using WolframAlpha:
	      // http://www.wolframalpha.com/input/?
	      //   i=Inverse+{{a%2C+c%2C+e}%2C+{b%2C+d%2C+f}%2C+{0%2C+0%2C+1}}

	      var m = this._transformMatrix;
	      var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5];

	      var ad_bc = a * d - b * c;
	      var bc_ad = b * c - a * d;

	      return [
	        d / ad_bc,
	        b / bc_ad,
	        c / bc_ad,
	        a / ad_bc,
	        (d * e - c * f) / bc_ad,
	        (b * e - a * f) / ad_bc
	      ];
	    }
	  });

	  ctx.save = function ctxSave() {
	    var old = this._transformMatrix;
	    this._transformStack.push(old);
	    this._transformMatrix = old.slice(0, 6);

	    this._originalSave();
	  };

	  ctx.restore = function ctxRestore() {
	    var prev = this._transformStack.pop();
	    if (prev) {
	      this._transformMatrix = prev;
	      this._originalRestore();
	    }
	  };

	  ctx.translate = function ctxTranslate(x, y) {
	    var m = this._transformMatrix;
	    m[4] = m[0] * x + m[2] * y + m[4];
	    m[5] = m[1] * x + m[3] * y + m[5];

	    this._originalTranslate(x, y);
	  };

	  ctx.scale = function ctxScale(x, y) {
	    var m = this._transformMatrix;
	    m[0] = m[0] * x;
	    m[1] = m[1] * x;
	    m[2] = m[2] * y;
	    m[3] = m[3] * y;

	    this._originalScale(x, y);
	  };

	  ctx.transform = function ctxTransform(a, b, c, d, e, f) {
	    var m = this._transformMatrix;
	    this._transformMatrix = [
	      m[0] * a + m[2] * b,
	      m[1] * a + m[3] * b,
	      m[0] * c + m[2] * d,
	      m[1] * c + m[3] * d,
	      m[0] * e + m[2] * f + m[4],
	      m[1] * e + m[3] * f + m[5]
	    ];

	    ctx._originalTransform(a, b, c, d, e, f);
	  };

	  ctx.setTransform = function ctxSetTransform(a, b, c, d, e, f) {
	    this._transformMatrix = [a, b, c, d, e, f];

	    ctx._originalSetTransform(a, b, c, d, e, f);
	  };

	  ctx.rotate = function ctxRotate(angle) {
	    var cosValue = Math.cos(angle);
	    var sinValue = Math.sin(angle);

	    var m = this._transformMatrix;
	    this._transformMatrix = [
	      m[0] * cosValue + m[2] * sinValue,
	      m[1] * cosValue + m[3] * sinValue,
	      m[0] * (-sinValue) + m[2] * cosValue,
	      m[1] * (-sinValue) + m[3] * cosValue,
	      m[4],
	      m[5]
	    ];

	    this._originalRotate(angle);
	  };
	}
}


var SVGGraphics = (function SVGGraphicsClosure(ctx) {

	function SVGGraphics() {

	}

	SVGGraphics.prototype = {

		beginDrawing: function SVGGraphics_beginDrawing(viewport, transparency) {

		},

		executeOperatorList: function SVGGraphics_executeOperatorList(
														operatorList, executionStartIdx,
											 			continueCallback) {

			var argsArray = operatorList.argsArray;
			var fnArray = operatorList.fnArray;
			var i = executionStartIdx || 0;
			var argsArrayLen = argsArray.length;
			console.log(argsArray);
			console.log(fnArray);

			var opTree = [];

			for (var x in fnArray) {
				for (var key in OPS) {
					if (OPS[key] == fnArray[x]) {
						opTree.push({'fn': key, 'args' : argsArray[x]})
					}
				}
			}

			for (var x in opTree) {
				console.log(opTree[x])
			}

		},
	}

	for (var op in OPS) {
    SVGGraphics.prototype[OPS[op]] = SVGGraphics.prototype[op];
  }

	return SVGGraphics;
})();
