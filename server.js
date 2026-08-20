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

// STK Push
app.post("/stk-push", async (req, res) => {
  try {
    const { phone, amount, reference } = req.body;

    if (!phone || !amount || !reference) {
      return res.status(400).json({
        error: "phone, amount and reference are required"
      });
    }

    const response = await fetch(
      `${process.env.PAYLOR_API_URL}/api/v1/merchants/payments/stk-push`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.PAYLOR_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          phone,
          amount,
          reference,
          callbackUrl: process.env.PAYLOR_WEBHOOK_URL
        })
      }
    );

    const data = await response.json();

    res.status(response.status).json(data);
  } catch (error) {
    console.error("STK Push error:", error);

    res.status(500).json({
      error: "Failed to connect to Paylor"
    });
  }
});

// Webhook
app.post("/webhook", (req, res) => {
  console.log("Paylor webhook received:", req.body);

  res.json({
    received: true
  });
});

app.listen(PORT, () => {
  console.log(`ChatPesa server running on port ${PORT}`);
});
