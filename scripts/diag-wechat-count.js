'use strict';
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {app}=require('electron');
const PROD=['RobinRead','NanJuPaper','PaperRss'].map(n=>'C:/Users/Lenovo/AppData/Roaming/'+n).find(p=>fs.existsSync(p));
const TEMP=path.join(os.tmpdir(),'robinread-wc-'+Date.now());
fs.mkdirSync(TEMP,{recursive:true});
fs.mkdirSync(path.join(TEMP,'credentials'),{recursive:true});
for(const f of ['library.db','library.db-shm','library.db-wal','preferences.json','Local State']){const s=path.join(PROD,f);if(fs.existsSync(s))fs.copyFileSync(s,path.join(TEMP,f));}
fs.copyFileSync(path.join(PROD,'credentials','ai-api-key.bin'),path.join(TEMP,'credentials','ai-api-key.bin'));
app.setPath('userData',TEMP);
app.whenReady().then(()=>{
  const {AppStore}=require('../src/main/AppStore');
  const store=new AppStore(TEMP);
  const feeds=store.database.prepare("SELECT id,title FROM feeds WHERE title IN ('腾讯技术工程','虎嗅APP','字节跳动技术团队','机器之心','阿里技术')").all();
  for(const f of feeds){
    const r=store.database.prepare("SELECT COUNT(*) AS n, MIN(published_at) AS oldest, MAX(published_at) AS newest FROM articles a INNER JOIN items i ON i.id=a.item_id WHERE i.feed_id=?").get(f.id);
    const oldest=r.oldest?new Date(r.oldest*1000).toLocaleDateString('zh-CN'):'无';
    const newest=r.newest?new Date(r.newest*1000).toLocaleDateString('zh-CN'):'无';
    console.log(`[${f.title}] 本地 ${r.n} 篇 | 最旧 ${oldest} | 最新 ${newest}`);
  }
  app.exit(0);
});
