/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

//
// See README for overview
//

'use strict';

//
// Fetch the PDF document from the URL using promises
//
PDFJS.getDocument('tracemonkey.pdf').then(function(pdf) {
  // Using promise to fetch the page
  pdf.getPage(1).then(function(page) {
    var scale = 2.0;
    var viewport = page.getViewport(scale);


    /*var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg:svg");
    svg.setAttribute("id", "hello-svg");
    svg.setAttribute("version", "1.1");
    //svg.setAttribute("baseProfile", "full");
    svg.setAttribute("height", viewport.height);
    svg.setAttribute("width", viewport.width);*/
    //svg.setAttribute("xmlns", "http://wwww.w3.org/2000/svg");
    //svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

    //document.body.appendChild(svg);

    //
    // Render PDF page into canvas context
    //
    var renderContext = {
      viewport: viewport
    };
    //page.render(renderContext);
    page.renderSVG(renderContext);
  });
});

