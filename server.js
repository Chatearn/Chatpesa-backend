const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "ChatPesa API"
  });
});

app.listen(PORT, () => {
  console.log(`ChatPesa server running on port ${PORT}`);
});
