# Running PDF.js with node

Install socket.io:

```
$ npm install socket.io
```

Execute server from the ./node folder:

```
$ sudo node pdfjs-server.js
```

In parallel, create ./build/pdf.js (from the PDF.js folder):

```
$ node make web
```

And use web server to serve the PDF.js files:

```
$  node make server
```

In the web browser, open http://localhost:8888/web/viewer-node.html

