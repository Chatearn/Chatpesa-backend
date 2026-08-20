const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

// Home / health check
app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "ChatPesa API"
  });
});

// Paylor webhook
app.post("/webhook", (req, res) => {
  console.log("Webhook received:", req.body);

  res.json({
    received: true
  });
});

app.listen(PORT, () => {
  console.log(`ChatPesa server running on port ${PORT}`);
});
