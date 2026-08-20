const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;

/* =========================================
   CORS
========================================= */

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
        "Access-Control-Allow-Methods",
        "GET,POST,OPTIONS"
    );
    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

/* =========================================
   JSON
========================================= */

app.use(express.json());

/* =========================================
   HEALTH CHECK
========================================= */

app.get("/", (req, res) => {
    res.status(200).json({
        status: "online",
        service: "ChatPesa API"
    });
});

/* =========================================
   STK PUSH
========================================= */

app.post("/stk-push", async (req, res) => {

    try {

        console.log("========== STK PUSH START ==========");
        console.log("Request received:", req.body);

        const {
            phone,
            amount,
            reference
        } = req.body;

        /* =====================================
           VALIDATE REQUEST
        ===================================== */

        if (!phone || !amount || !reference) {

            return res.status(400).json({
                success: false,
                error: "phone, amount and reference are required"
            });

        }

        /* =====================================
           VALIDATE PHONE
        ===================================== */

        if (!/^2547\d{8}$/.test(phone)) {

            return res.status(400).json({
                success: false,
                error: "Invalid Kenyan phone number"
            });

        }

        /* =====================================
           CHECK PAYLOR CONFIGURATION
        ===================================== */

        const baseUrl =
            process.env.PAYLOR_BASE_URL;

        const apiKey =
            process.env.PAYLOR_API_KEY;

        const callbackUrl =
            process.env.PAYLOR_WEBHOOK_URL;

        if (!baseUrl) {

            console.error(
                "PAYLOR_BASE_URL is missing"
            );

            return res.status(500).json({
                success: false,
                error: "PAYLOR_BASE_URL is missing"
            });

        }

        if (!apiKey) {

            console.error(
                "PAYLOR_API_KEY is missing"
            );

            return res.status(500).json({
                success: false,
                error: "PAYLOR_API_KEY is missing"
            });

        }

        /* =====================================
           PAYLOR ENDPOINT
        ===================================== */

        const url =
            `${baseUrl.replace(/\/$/, "")}` +
            `/api/v1/merchants/payments/stk-push`;

        console.log("Paylor URL:", url);
        console.log("Phone:", phone);
        console.log("Amount:", amount);
        console.log("Reference:", reference);

        /* =====================================
           PAYLOAD
        ===================================== */

        const payload = {
            phone: phone,
            amount: Number(amount),
            reference: reference
        };

        if (callbackUrl) {
            payload.callbackUrl = callbackUrl;
        }

        console.log(
            "Sending request to Paylor..."
        );

        /* =====================================
           SEND REQUEST
        ===================================== */

        const response = await fetch(url, {
            method: "POST",

            headers: {
                "Authorization":
                    `Bearer ${apiKey}`,

                "Content-Type":
                    "application/json",

                "Accept":
                    "application/json"
            },

            body:
                JSON.stringify(payload)
        });

        console.log(
            "Paylor HTTP status:",
            response.status
        );

        const responseText =
            await response.text();

        console.log(
            "Paylor response:",
            responseText
        );

        /* =====================================
           PARSE RESPONSE
        ===================================== */

        let paylorData;

        try {

            paylorData =
                JSON.parse(responseText);

        } catch {

            paylorData = {
                rawResponse: responseText
            };

        }

        console.log(
            "========== STK PUSH END =========="
        );

        /* =====================================
           RETURN TO FRONTEND
        ===================================== */

        if (response.ok) {

            return res.status(200).json({

                success: true,

                reference: reference,

                paylorStatus:
                    response.status,

                paylorResponse:
                    paylorData

            });

        }

        return res.status(response.status).json({

            success: false,

            reference: reference,

            paylorStatus:
                response.status,

            error:
                paylorData.message ||
                paylorData.error ||
                "Paylor rejected the payment request.",

            paylorResponse:
                paylorData

        });

    } catch (error) {

        console.error(
            "========== STK PUSH ERROR =========="
        );

        console.error(
            error
        );

        return res.status(500).json({

            success: false,

            error:
                error.message ||
                "Internal server error"

        });

    }

});

/* =========================================
   START SERVER
========================================= */

app.listen(PORT, "0.0.0.0", () => {

    console.log(
        `ChatPesa server running on port ${PORT}`
    );

});
