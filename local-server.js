const http = require("http");
const fs = require("fs");
const path = require("path");
const root = process.cwd();
const mime = {".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".svg":"image/svg+xml", ".webmanifest":"application/manifest+json"};
http.createServer((req,res)=>{
  const reqPath = decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.join(root, reqPath === "/" ? "index.html" : reqPath.replace(/^\//,""));
  fs.readFile(filePath, (err,data)=>{
    if(err){res.statusCode=404;res.end("Not Found");return;}
    res.setHeader("Content-Type", mime[path.extname(filePath)] || "application/octet-stream");
    res.end(data);
  });
}).listen(4173, ()=>console.log("server ready 4173"));
