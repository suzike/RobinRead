'use strict';
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {app}=require('electron');
const PROD=['RobinRead','NanJuPaper','PaperRss'].map(n=>'C:/Users/Lenovo/AppData/Roaming/'+n).find(p=>fs.existsSync(p));
const TEMP=path.join(os.tmpdir(),'robinread-ae-'+Date.now());
fs.mkdirSync(TEMP,{recursive:true});
fs.mkdirSync(path.join(TEMP,'credentials'),{recursive:true});
for(const f of ['library.db','library.db-shm','library.db-wal','preferences.json','Local State']){const s=path.join(PROD,f);if(fs.existsSync(s))fs.copyFileSync(s,path.join(TEMP,f));}
fs.copyFileSync(path.join(PROD,'credentials','ai-api-key.bin'),path.join(TEMP,'credentials','ai-api-key.bin'));
app.setPath('userData',TEMP);
app.whenReady().then(()=>{
  const {AppStore}=require('../src/main/AppStore');
  const store=new AppStore(TEMP);
  const feeds=store.database.prepare("SELECT id,title,feed_url FROM feeds WHERE feed_url LIKE '%aihot%'").all();
  for(const f of feeds){
    const n=store.database.prepare("SELECT COUNT(*) AS n FROM items WHERE feed_id=?").get(f.id).n;
    console.log(`[${f.title}] 文章数=${n}`);
  }
  // 检查修复标记状态
  console.log('aihotReset 标记:', store.preferences.get('RobinRead.repair.aihotReset', false));
  app.exit(0);
});
