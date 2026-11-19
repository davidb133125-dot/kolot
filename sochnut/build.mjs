// בונה את האתר לפרסום (למשל ב-Vercel): עוטף את index.html במסמך HTML מלא ומעתיק את הקבצים לתיקייה dist.
import fs from "node:fs";
fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist");
const body = fs.readFileSync("index.html", "utf8");
const page = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${body}
</body>
</html>
`;
fs.writeFileSync("dist/index.html", page);
for (const f of ["bank.js", "online.js", "config.js"]) if (fs.existsSync(f)) fs.copyFileSync(f, "dist/" + f);
console.log("built dist/");
