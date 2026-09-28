// Kopiert das Frontend (../frontend) nach www/ und aktiviert den lokalen Speicher.
const fs = require("fs");
const path = require("path");
const src = path.join(__dirname, "..", "frontend");
const dst = path.join(__dirname, "www");
fs.mkdirSync(dst, { recursive: true });
for (const f of ["app.js", "style.css"]) fs.copyFileSync(path.join(src, f), path.join(dst, f));
fs.copyFileSync(path.join(__dirname, "lokal.js"), path.join(dst, "lokal.js"));
let html = fs.readFileSync(path.join(src, "index.html"), "utf8");
html = html.replace('<script src="app.js"></script>',
  '<script>window.LOKAL_MODUS = true;</script>\n<script src="lokal.js"></script>\n<script src="app.js"></script>');
fs.writeFileSync(path.join(dst, "index.html"), html);
console.log("www/ aktualisiert");
