require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

app.use(cors());

/*
|--------------------------------------------------------------------------
| JSON parser
|--------------------------------------------------------------------------
| Keep the raw request body for Paylor webhook signature verification.
*/
app.use(
    express.json({
        verify: (req, res, buf) => {
            req.rawBody = buf;
        }
    })
);

/*
|--------------------------------------------------------------------------
| Payment storage
|--------------------------------------------------------------------------
*/
const payments = new Map();

/*
|--------------------------------------------------------------------------
| ChatPesa country prices
|--------------------------------------------------------------------------
*/
const countryPrices = {
    China: 1,
    Canada: 450,
    Australia: 550,
    UK: 650,
    USA: 750,
    Others: 330
};

/*
|--------------------------------------------------------------------------
| Normalize M-PESA phone number
|--------------------------------------------------------------------------
*/
function normalizePhone(phone) {
    if (!phone) return null;

    let value = String(phone).trim().replace(/\s+/g, "");

    if (value.startsWith("+254")) {
        value = value.substring(1);
    }

    if (value.startsWith("07") || value.startsWith("01")) {
        value = "254" + value.substring(1);
    }

    if (/^254[17]\d{8}$/.test(value)) {
        return value;
    }

    return null;
}

/*
|--------------------------------------------------------------------------
| Home / health check
|--------------------------------------------------------------------------
*/
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "ChatPesa backend is running"
    });
});

/*
|--------------------------------------------------------------------------
| Country prices
|--------------------------------------------------------------------------
*/
app.get("/country-prices", (req, res) => {
    res.json({
        success: true,
        prices: countryPrices
    });
});

/*
|--------------------------------------------------------------------------
| STK PUSH
|--------------------------------------------------------------------------
*/
app.post("/stk-push", async (req, res) => {
    try {
        const {
            phone,
            amount,
            reference,
            type,
            country
        } = req.body;

        console.log("CHATPESA DATA:", {
            phone,
            amount,
            reference,
            type,
            country
        });

        /*
        |--------------------------------------------------------------------------
        | Validate basic information
        |--------------------------------------------------------------------------
        */
        if (!phone) {
            return res.status(400).json({
                success: false,
                message: "Phone number is required"
            });
        }

        if (!reference) {
            return res.status(400).json({
                success: false,
                message: "Payment reference is required"
            });
        }

        if (!amount) {
            return res.status(400).json({
                success: false,
                message: "Payment amount is required"
            });
        }

        /*
        |--------------------------------------------------------------------------
        | Normalize phone
        |--------------------------------------------------------------------------
        */
        const normalizedPhone = normalizePhone(phone);

        if (!normalizedPhone) {
            return res.status(400).json({
                success: false,
                message: "Invalid Kenyan M-PESA phone number"
            });
        }

        /*
        |--------------------------------------------------------------------------
        | Determine final amount
        |--------------------------------------------------------------------------
        */
        let finalAmount;

        if (type === "registration") {
            finalAmount = 1;
        } else if (type === "country_unlock") {
            if (!country || !countryPrices[country]) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid country"
                });
            }

            finalAmount = countryPrices[country];
        } else {
            finalAmount = Number(amount);
        }

        /*
        |--------------------------------------------------------------------------
        | Validate amount
        |--------------------------------------------------------------------------
        */
        if (!Number.isFinite(Number(finalAmount)) || Number(finalAmount) <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment amount"
            });
        }

        /*
        |--------------------------------------------------------------------------
        | Paylor API key
        |--------------------------------------------------------------------------
        */
        if (!process.env.PAYLOR_API_KEY) {
            console.error("PAYLOR_API_KEY is missing");

            return res.status(500).json({
                success: false,
                message: "Payment gateway is not configured"
            });
        }

        /*
        |--------------------------------------------------------------------------
        | Save initial payment
        |--------------------------------------------------------------------------
        */
        payments.set(reference, {
            reference,
            phone: normalizedPhone,
            amount: finalAmount,
            type,
            country: country || null,
            status: "PENDING",
            createdAt: new Date().toISOString()
        });

        /*
        |--------------------------------------------------------------------------
        | CORRECT PAYLOR STK PUSH URL
        |--------------------------------------------------------------------------
        */
        const PAYLOR_URL =
            "https://api.paylorke.com/api/v1/merchants/payments/stk-push";

        /*
        |--------------------------------------------------------------------------
        | Paylor request body
        |--------------------------------------------------------------------------
        */
        const paylorRequest = {
            phone: normalizedPhone,
            amount: finalAmount,
            reference: reference,
            description:
                type === "registration"
                    ? "ChatPesa registration payment"
                    : `ChatPesa ${country || "country"} unlock payment`,
            callbackUrl:
                "https://chatpesa-backend.onrender.com/paylor-callback"
        };

        /*
        |--------------------------------------------------------------------------
        | Add channel ID if configured
        |--------------------------------------------------------------------------
        */
        if (process.env.PAYLOR_CHANNEL_ID) {
            paylorRequest.channelId = process.env.PAYLOR_CHANNEL_ID;
        }

        console.log("PAYLOR REQUEST:", paylorRequest);

        /*
        |--------------------------------------------------------------------------
        | Send STK Push to Paylor
        |--------------------------------------------------------------------------
        */
        const response = await fetch(PAYLOR_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.PAYLOR_API_KEY}`,
                "Content-Type": "application/json",
                "Idempotency-Key": reference
            },
            body: JSON.stringify(paylorRequest)
        });

        const responseText = await response.text();

        console.log("PAYLOR HTTP STATUS:", response.status);
        console.log("PAYLOR RESPONSE:", responseText);

        /*
        |--------------------------------------------------------------------------
        | Handle Paylor HTTP error
        |--------------------------------------------------------------------------
        */
        if (!response.ok) {
            payments.set(reference, {
                ...payments.get(reference),
                status: "FAILED",
                gatewayStatus: response.status,
                gatewayResponse: responseText
            });

            return res.status(502).json({
                success: false,
                message: "Payment gateway rejected the request",
                gatewayStatus: response.status
            });
        }

        /*
        |--------------------------------------------------------------------------
        | Parse Paylor response
        |--------------------------------------------------------------------------
        */
        let paylorResponse = {};

        try {
            paylorResponse = JSON.parse(responseText);
        } catch (error) {
            console.error("PAYLOR JSON PARSE ERROR:", error.message);
        }

        /*
        |--------------------------------------------------------------------------
        | Save Paylor transaction
        |--------------------------------------------------------------------------
        */
        payments.set(reference, {
            ...payments.get(reference),
            status: paylorResponse.status || "PENDING",
            transactionId: paylorResponse.transactionId || null,
            gatewayResponse: paylorResponse
        });

        /*
        |--------------------------------------------------------------------------
        | Return success to frontend
        |--------------------------------------------------------------------------
        */
        return res.json({
            success: true,
            reference,
            transactionId: paylorResponse.transactionId || null,
            status: paylorResponse.status || "PENDING",
            message: "M-PESA payment request sent"
        });

    } catch (error) {
        console.error("STK PUSH ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to initiate payment"
        });
    }
});

/*
|--------------------------------------------------------------------------
| PAYLOR CALLBACK / WEBHOOK
|--------------------------------------------------------------------------
*/
app.post("/paylor-callback", (req, res) => {
    try {
        console.log("PAYLOR CALLBACK BODY:", req.body);

        /*
        |--------------------------------------------------------------------------
        | Optional webhook signature verification
        |--------------------------------------------------------------------------
        */
        if (process.env.PAYLOR_WEBHOOK_SECRET) {
            const signature = req.headers["x-webhook-signature"];

            if (!signature) {
                console.error("Missing Paylor webhook signature");

                return res.status(401).json({
                    success: false,
                    message: "Missing webhook signature"
                });
            }

            const expectedSignature = crypto
                .createHmac(
                    "sha256",
                    process.env.PAYLOR_WEBHOOK_SECRET
                )
                .update(req.rawBody || Buffer.from(""))
                .digest("hex");

            if (signature !== expectedSignature) {
                console.error("Invalid Paylor webhook signature");

                return res.status(401).json({
                    success: false,
                    message: "Invalid webhook signature"
                });
            }
        }

        /*
        |--------------------------------------------------------------------------
        | Extract callback information
        |--------------------------------------------------------------------------
        */
        const event = req.body?.event;
        const transaction = req.body?.transaction || {};

        const reference =
            transaction.reference ||
            transaction.internalReference;

        const status = String(
            transaction.status || ""
        ).toUpperCase();

        console.log("CALLBACK REFERENCE:", reference);
        console.log("CALLBACK STATUS:", status || event);

        if (!reference) {
            return res.status(400).json({
                success: false,
                message: "Payment reference missing"
            });
        }

        /*
        |--------------------------------------------------------------------------
        | Payment successful
        |--------------------------------------------------------------------------
        */
        if (
            event === "payment.success" ||
            status === "COMPLETED" ||
            status === "SUCCESS"
        ) {
            const existingPayment = payments.get(reference) || {};

            payments.set(reference, {
                ...existingPayment,
                reference,
                status: "SUCCESS",
                transactionId:
                    transaction.id ||
                    existingPayment.transactionId ||
                    null,
                mpesaReceipt:
                    transaction.mpesaReceipt ||
                    transaction.providerRef ||
                    null,
                callback: req.body,
                completedAt: new Date().toISOString()
            });

            console.log("CHATPESA: PAYMENT SUCCESS");

            return res.json({
                success: true
            });
        }

        /*
        |--------------------------------------------------------------------------
        | Payment failed
        |--------------------------------------------------------------------------
        */
        if (
            event === "payment.failed" ||
            status === "FAILED" ||
            status === "CANCELLED"
        ) {
            const existingPayment = payments.get(reference) || {};

            payments.set(reference, {
                ...existingPayment,
                reference,
                status: "FAILED",
                callback: req.body,
                failedAt: new Date().toISOString()
            });

            console.log("CHATPESA: PAYMENT FAILED");

            return res.json({
                success: true
            });
        }

        /*
        |--------------------------------------------------------------------------
        | Other callback status
        |--------------------------------------------------------------------------
        */
        const existingPayment = payments.get(reference) || {};

        payments.set(reference, {
            ...existingPayment,
            reference,
            status: status || "PENDING",
            callback: req.body
        });

       
