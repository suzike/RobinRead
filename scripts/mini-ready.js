'use strict';
const fs = require('fs');
const path = require('path');
const L = (m) => fs.appendFileSync(path.join(__dirname, 'mini-ready.log'), m + '\n');
L('module load');
const { app } = require('electron');
L('electron required');
app.whenReady().then(() => { L('READY'); app.exit(0); });
setTimeout(() => { L('30s 仍挂起，主动退出'); app.exit(124); }, 30000);
