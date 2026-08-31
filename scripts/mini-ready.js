const { app } = require("electron");
const fs = require("fs");
app.setPath("userData", fs.mkdtempSync(require("path").join(require("os").tmpdir(), "mini-")));
app.whenReady().then(() => { fs.appendFileSync(__dirname + "/mini-ready.log", "ready
"); app.exit(0); });
