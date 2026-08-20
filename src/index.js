const { server } = require("./server");
const whatsapp = require("./whatsapp");
const autoReplyEngine = require("./autoReply");

const PORT = process.env.PORT || autoReplyEngine.config.port || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`====================================================`);
  console.log(`🚀 WhatsApp Pro Dashboard is running at:`);
  console.log(`👉 Port: ${PORT}`);
  console.log(`====================================================`);

  // Start WhatsApp Client
  whatsapp.start();
});
