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

    console.log("=================================");
    console.log("CHATPESA STK PUSH REQUEST");
    console.log("=================================");

    try {

        console.log("Request body:", req.body);

        const {
            phone,
            amount,
            reference
        } = req.body;

        /* =====================================
           VALIDATE REQUEST
        ===================================== */

        if (!phone || !amount || !reference) {

            console.log(
                "Missing phone, amount or reference"
            );

            return res.status(400).json({
                success: false,
                error:
                    "phone, amount and reference are required"
            });
        }

        /* =====================================
           NORMALIZE PHONE
        ===================================== */

        let formattedPhone =
            String(phone)
                .trim()
                .replace(/\s+/g, "");

        if (formattedPhone.startsWith("07")) {

            formattedPhone =
                "254" +
                formattedPhone.substring(1);
        }

        if (formattedPhone.startsWith("+254")) {

            formattedPhone =
                formattedPhone.substring(1);
        }

        console.log(
            "Formatted phone:",
            formattedPhone
        );

        /* =====================================
           VALIDATE PHONE
        ===================================== */

        if (!/^2547\d{8}$/.test(formattedPhone)) {

            console.log(
                "Invalid Kenyan phone number"
            );

            return res.status(400).json({
                success: false,
                error:
                    "Invalid Kenyan phone number"
            });
        }

        /* =====================================
           VALIDATE AMOUNT
        ===================================== */

        const paymentAmount =
            Number(amount);

        if (
            !Number.isFinite(paymentAmount) ||
            paymentAmount <= 0
        ) {

            return res.status(400).json({
                success: false,
                error: "Invalid payment amount"
            });
        }

        /* =====================================
           PAYLOR CONFIGURATION
        ===================================== */

        const baseUrl =
            process.env.PAYLOR_BASE_URL;

        const apiKey =
            process.env.PAYLOR_API_KEY;

        const callbackUrl =
            process.env.PAYLOR_WEBHOOK_URL;

        console.log(
            "PAYLOR_BASE_URL configured:",
            !!baseUrl
        );

        console.log(
            "PAYLOR_API_KEY configured:",
            !!apiKey
        );

        console.log(
            "PAYLOR_WEBHOOK_URL configured:",
            !!callbackUrl
        );

        /* =====================================
           CHECK ENVIRONMENT VARIABLES
        ===================================== */

        if (!baseUrl) {

            return res.status(500).json({
                success: false,
                error:
                    "PAYLOR_BASE_URL is missing"
            });
        }

        if (!apiKey) {

            return res.status(500).json({
                success: false,
                error:
                    "PAYLOR_API_KEY is missing"
            });
        }

        /* =====================================
           PAYLOR URL
        ===================================== */

        const url =
            `${baseUrl.replace(/\/$/, "")}` +
            `/api/v1/merchants/payments/stk-push`;

        console.log(
            "Paylor URL:",
            url
        );

        console.log(
            "Payment amount:",
            paymentAmount
        );

        console.log(
            "Reference:",
            reference
        );

        /* =====================================
           PAYLOAD
        ===================================== */

        const payload = {
            phone: formattedPhone,
            amount: paymentAmount,
            reference: reference
        };

        if (callbackUrl) {

            payload.callbackUrl =
                callbackUrl;
        }

        console.log(
            "Payment payload:",
            payload
        );

        /* =====================================
           SEND STK REQUEST
        ===================================== */

        console.log(
            "Sending STK request to Paylor..."
        );

        const response =
            await fetch(url, {

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

        /* =====================================
           PAYLOR RESPONSE
        ===================================== */

        console.log(
            "Paylor HTTP status:",
            response.status
        );

        const responseText =
            await response.text();

        console.log(
            "Paylor FULL RESPONSE:",
            responseText
        );

        /* =====================================
           PARSE PAYLOR RESPONSE
        ===================================== */

        let paylorData;

        try {

            paylorData =
                JSON.parse(responseText);

        } catch (error) {

            paylorData = {
                rawResponse:
                    responseText
            };
        }

        /* =====================================
           SUCCESS
        ===================================== */

        if (response.ok) {

            console.log(
                "STK REQUEST ACCEPTED BY PAYLOR"
            );

            return res.status(200).json({

                success: true,

                reference:
                    reference,

                message:
                    "STK Push request accepted",

                paylorStatus:
                    response.status,

                paylorResponse:
                    paylorData
            });
        }

        /* =====================================
           PAYLOR ERROR
        ===================================== */

        console.log(
            "PAYLOR REJECTED THE REQUEST"
        );

        const errorMessage =
            paylorData.message ||
            paylorData.error ||
            paylorData.detail ||
            "Paylor rejected the payment request.";

        return res.status(502).json({

            success: false,

            reference:
                reference,

            error:
                errorMessage,

            paylorStatus:
                response.status,

            paylorResponse:
                paylorData
        });

    } catch (error) {

        console.error(
            "================================="
        );

        console.error(
            "CHATPESA STK PUSH ERROR"
        );

        console.error(
            "================================="
        );

        console.error(
            "Error:",
            error.message
        );

        console.error(
            "Full error:",
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

app.listen(
    PORT,
    "0.0.
