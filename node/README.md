# Running PDF.js with node

Install socket.io:

```
$ npm install socket.io
```

Build pdf.js file:

```
$ node make generic
```

In parallel, execute web and pdfjs/socket.io server from the ./node folder:

```
$ node make server & node node/pdf-server.js
```

In the web browser, open http://localhost:8888/web/viewer-node.html

