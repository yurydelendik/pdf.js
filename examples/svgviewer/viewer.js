'use strict';

var DEFAULT_SCALE = 1.5;
var DEFAULT_URL = '../../web/compressed.tracemonkey-pldi-09.pdf';

function renderDocument(pdf, svgLib) {
  var promise = Promise.resolve();
  for (var i = 1; i <= pdf.numPages; i++) {
    // Using promise to fetch and render the next page
    promise = promise.then(function (pageNum) {
      return pdf.getPage(pageNum).then(function (page) {
        var viewport = page.getViewport(DEFAULT_SCALE);

        var container = document.createElement('div');
        container.id = 'pageContainer' + pageNum;
        container.className = 'pageContainer';
        container.style.width = viewport.width + 'px';
        container.style.height = viewport.height + 'px';
        document.body.appendChild(container);

        return page.getOperatorList().then(function (opList) {
          var svgGfx = new svgLib.SVGGraphics(page.commonObjs, page.objs);
          return svgGfx.getSVG(opList, viewport).then(function (svg) {
            container.appendChild(svg);
          });
        });
      });
    }.bind(null, i));
  }
}

// In production, the bundled pdf.js shall be used instead of RequireJS.
require.config({paths: {'pdfjs': '../../src'}});
require(['pdfjs/display/api', 'pdfjs/display/svg', 'pdfjs/display/global'],
    function (api, svg, global) {
  // In production, change this to point to the built `pdf.worker.js` file.
  global.PDFJS.workerSrc = '../../src/worker_loader.js';

  // In production, change this to point to where the cMaps are placed.
  global.PDFJS.cMapUrl = '../../external/bcmaps/';
  global.PDFJS.cMapPacked = true;

  // Fetch the PDF document from the URL using promises.
  api.getDocument(DEFAULT_URL).then(function (doc) {
    renderDocument(doc, svg);
  });
});
