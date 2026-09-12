const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=process.env.HOME+'/mnt/whatsapp-pro-automation/src/public';
const now=Date.now();
const contacts=[
 {jid:'201144772210@s.whatsapp.net',name:'منى عبد الرحمن',phone:'201144772210',status_tag:'interested',last_message:'تمام، ابعتلي تفاصيل الباقة',last_message_time:now-600000,unread_count:2,bot_paused:0,is_group:0},
 {jid:'201005551234@s.whatsapp.net',name:'طارق حسين',phone:'201005551234',status_tag:'ordered',last_message:'الأوردر وصل النهارده',last_message_time:now-3600000,unread_count:0,bot_paused:0,is_group:0},
 {jid:'201233334444@s.whatsapp.net',name:'نورا سامي',phone:'201233334444',status_tag:'new',last_message:'فيه ميعاد فاضي الخميس؟',last_message_time:now-9000000,unread_count:1,bot_paused:0,is_group:0},
 {jid:'120363111@g.us',name:'تجار الجملة',phone:'',status_tag:'new',last_message:'خالد: الأسعار اتحدثت',last_message_time:now-86400000,unread_count:0,is_group:1}
];
const orders=[{id:2841,customer_name:'منى عبد الرحمن',phone:'201144772210',contact_jid:contacts[0].jid,order_details:'باقة شهرية',address:'المعادي، القاهرة',total_price:'1450',status:'confirmed',google_sheet_synced:1,created_at:now-500000},
{id:2790,customer_name:'طارق حسين',phone:'201005551234',contact_jid:contacts[1].jid,order_details:'تجديد اشتراك',address:'طنطا',total_price:'1450',status:'pending',google_sheet_synced:0,created_at:now-86400000}];
const bookings=[{reference_code:'RF-8842',customer_name:'منى عبد الرحمن',customer_phone:'201144772210',customer_email:'m@x.com',start_time:now+172800000,status:'CONFIRMED',notes:'جلسة تعريفية',created_at:now-400000,cancel_token:'t1'}];
const messages=[{text:'عايزة أعرف سعر الباقة الشهرية؟',from_me:0,auto_replied:0,timestamp:now-900000},
{text:'الباقة الشهرية بـ 1,450 ج.م وشاملة الردود الذكية والحملات وحجز المواعيد.',from_me:1,auto_replied:1,timestamp:now-880000},
{text:'تمام، ابعتلي تفاصيل الباقة',from_me:0,auto_replied:0,timestamp:now-600000}];
const J=(r,o)=>{r.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});r.end(JSON.stringify(o));};
http.createServer((req,res)=>{
 const u=req.url.split('?')[0];
 if(u==='/socket.io/socket.io.js'){res.writeHead(200,{'Content-Type':'application/javascript'});return res.end('window.io=function(){return{on:function(){},emit:function(){}}};');}
 if(u==='/api/contacts')return J(res,{success:true,contacts});
 if(u==='/api/orders')return J(res,{success:true,orders});
 if(u==='/api/admin/bookings')return J(res,{success:true,bookings});
 if(u==='/api/analytics')return J(res,{success:true,analytics:{totalContacts:1284,totalMessages:18930,totalAutoReplied:6412,totalOrders:218,
   dailyVolume:[{day:'25/8',count:210},{day:'26/8',count:340},{day:'27/8',count:180},{day:'28/8',count:420},{day:'29/8',count:390},{day:'30/8',count:510},{day:'31/8',count:300},{day:'1/9',count:460},{day:'2/9',count:520},{day:'3/9',count:410},{day:'4/9',count:600},{day:'5/9',count:480}],
   tagsBreakdown:[{status_tag:'new',count:420},{status_tag:'interested',count:310},{status_tag:'ordered',count:218},{status_tag:'vip',count:64},{status_tag:'support',count:120}]}});
 if(u==='/api/rules')return J(res,{rules:[{id:1,keyword:'السعر',matchType:'contains',response:'الباقة الشهرية بـ 1,450 ج.م شاملة كل المزايا.'},{id:2,keyword:'مواعيد',matchType:'contains',response:'شغالين من ١٠ ص لـ ٦ م، من السبت للخميس.'}]});
 if(u==='/api/settings')return J(res,{success:true,settings:{googleSheetWebhookUrl:'https://script.google.com/macros/s/AKfy.../exec'}});
 if(u==='/api/campaigns')return J(res,{success:true,campaigns:[{id:1,title:'عرض نهاية الأسبوع',status:'completed',target_count:320,sent_count:311,failed_count:9,created_at:now-172800000,message_template:'أهلاً {name}'}]});
 if(u==='/api/groups')return J(res,{success:true,groups:[{jid:'120363111@g.us',name:'تجار الجملة',size:214},{jid:'120363222@g.us',name:'عملاء القاهرة',size:98}]});
 if(u==='/api/audience-presets')return J(res,{success:true,presets:[{id:1,name:'جروبات الجملة',group_jids:'["120363111@g.us"]'}]});
 if(u.indexOf('/messages')>-1)return J(res,{success:true,messages});
 if(u.indexOf('/details')>-1)return J(res,{success:true,contact:contacts[0],isGroup:false,orders:[orders[0]],bookings,sharedMedia:[],groupDetails:null});
 if(u.indexOf('/api/')===0)return J(res,{success:true});
 let f=path.join(ROOT,u==='/'?'index.html':u);
 fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('404');}
  const t={'.html':'text/html','.css':'text/css','.js':'application/javascript'}[path.extname(f)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':t+'; charset=utf-8'});res.end(d);});
}).listen(8899,()=>console.log('mock on 8899'));
