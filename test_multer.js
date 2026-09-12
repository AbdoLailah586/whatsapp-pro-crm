const express = require('express');
const multer = require('multer');
const app = express();
app.use(express.json());
app.post('/', multer().single('image'), (req, res) => {
  console.log('BODY:', req.body);
  res.send('ok');
});
const request = require('http').request;
const server = app.listen(0, () => {
  const req = request({
    port: server.address().port,
    method: 'POST',
    path: '/',
    headers: {
      'Content-Type': 'application/json'
    }
  }, res => {
    server.close();
  });
  req.write(JSON.stringify({title: 'hello'}));
  req.end();
});
