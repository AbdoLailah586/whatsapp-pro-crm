const FormData = require('form-data');
const http = require('http');

const form = new FormData();
form.append('title', 'اختبار النظام');
form.append('template', 'رسالة اختبار من النظام لتأكيد التحديث');
form.append('delaySeconds', '1');
form.append('contacts', JSON.stringify(['201558909252']));

const request = http.request({
  method: 'POST',
  host: 'localhost',
  port: 5000,
  path: '/api/campaigns',
  headers: form.getHeaders()
});

request.on('response', (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    console.log('Response:', body);
  });
});

request.on('error', (error) => {
  console.error('Error:', error.message);
});

form.pipe(request);
