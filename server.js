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

// STK PUSH
app.post("/stk-push", async (req, res) => {
  try {
    console.log("========== STK PUSH START ==========");
    console.log("Request received:", req.body);

    const { phone, amount, reference } = req.body;

    if (!phone || !amount || !reference) {
      return res.status(400).json({
        success: false,
        error: "phone, amount and reference are required"
      });
    }

    if (!process.env.PAYLOR_BASE_URL) {
      return res.status(500).json({
        success: false,
        error: "PAYLOR_BASE_URL is missing"
      });
    }

    if (!process.env.PAYLOR_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "PAYLOR_API_KEY is missing"
      });
    }

    if (!process.env.PAYLOR_CHANNEL_ID) {
      return res.status(500).json({
        success: false,
        error: "PAYLOR_CHANNEL_ID is missing"
      });
    }

    const url =
      `${process.env.PAYLOR_BASE_URL}/api/v1/merchants/payments/stk-push`;

    console.log("Paylor URL:", url);
    console.log("Phone:", phone);
    console.log("Amount:", amount);
    console.log("Reference:", reference);
    console.log("Channel ID:", process.env.PAYLOR_CHANNEL_ID);

    const payload = {
      phone: phone,
      amount: amount,
      reference: reference,
      channelId: process.env.PAYLOR_CHANNEL_ID,
      description: "ChatPesa payment",
      callbackUrl: process.env.PAYLOR_WEBHOOK_URL
    };

    console.log("Sending request to Paylor...");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.PAYLOR_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    console.log("Paylor HTTP status:", response.status);

    const responseText = await response.text();

    console.log("Paylor response:", responseText);
    console.log("========== STK PUSH END ==========");

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      data = {
        rawResponse: responseText
      };
    }

    return res.status(response.status).json({
      success: response.ok,
      paylorStatus: response.status,
      paylorResponse: data
    });

  } catch (error) {
    console.error("========== STK PUSH ERROR ==========");
    console.error(error);
    console.error("====================================");

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// WEBHOOK
app.post("/webhook", (req, res) => {
  console.log("Paylor webhook received:", req.body);

  res.json({
    received: true
  });
});

app.listen(PORT, () => {
  console.log(`ChatPesa server running on port ${PORT}`);
});
