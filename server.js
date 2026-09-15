require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

app.use(cors());

/*
|--------------------------------------------------------------------------
| IMPORTANT
|--------------------------------------------------------------------------
| We keep the raw request body so Paylor webhook signatures can be checked.
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
| PAYMENT STORAGE
|--------------------------------------------------------------------------
*/

const payments = new Map();

/*
|--------------------------------------------------------------------------
| COUNTRY PRICES
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
| HOME / HEALTH CHECK
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
| COUNTRY PRICES
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

        console.log("CHATPESA DATA:", req.body);

        /*
        |--------------------------------------------------------------------------
        | VALIDATION
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
        | NORMALIZE PHONE
        |--------------------------------------------------------------------------
        */

        let normalizedPhone = String(phone).replace(/\D/g, "");

        if (normalizedPhone.startsWith("0")) {
            normalizedPhone = "254" + normalizedPhone.substring(1);
        }

        if (normalizedPhone.startsWith("+")) {
            normalizedPhone = normalizedPhone.substring(1);
        }

        if (
            !normalizedPhone.startsWith("254") ||
            normalizedPhone.length !== 12
        ) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid Kenyan M-PESA number"
            });
        }

        /*
        |--------------------------------------------------------------------------
        | DETERMINE FINAL AMOUNT
        |--------------------------------------------------------------------------
        */

        let finalAmount = Number(amount);

        /*
        |--------------------------------------------------------------------------
        | REGISTRATION PAYMENT
        |--------------------------------------------------------------------------
        | Registration is fixed at KSh 1.
        */

        if (type === "registration") {
            finalAmount = 1;
        }

        /*
        |--------------------------------------------------------------------------
        | COUNTRY UNLOCK PAYMENT
        |--------------------------------------------------------------------------
        */

        if (type === "country_unlock") {
            if (!country || !countryPrices[country]) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid country"
                });
            }

            finalAmount = countryPrices[country];
        }

        if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment amount"
            });
        }

        /*
        |--------------------------------------------------------------------------
        | PAYLOR API KEY
        |--------------------------------------------------------------------------
        */

        const apiKey = process.env.PAYLOR_API_KEY;

        if (!apiKey) {
            console.error("PAYLOR_API_KEY is missing");

            return res.status(500).json({
                success: false,
                message: "Payment gateway is not configured"
            });
        }

        /*
        |--------------------------------------------------------------------------
        | STORE PAYMENT AS PENDING
        |--------------------------------------------------------------------------
        */

        payments.set(reference, {
            reference,
            phone: normalizedPhone,
            amount: finalAmount,
            type: type || "unknown",
            country: country || null,
            status: "PENDING",
            createdAt: Date.now()
        });

        /*
        |--------------------------------------------------------------------------
        | PAYLOR REQUEST
        |--------------------------------------------------------------------------
        */

        const paylorData = {
            phone: normalizedPhone,
            amount: finalAmount,
            reference: reference,
            description:
                type === "registration"
                    ? "ChatPesa registration payment"
                    : `ChatPesa ${country || ""} country unlock payment`,
            callbackUrl:
                "https://chatpesa-backend.onrender.com/paylor-callback"
        };

        /*
        |--------------------------------------------------------------------------
        | OPTIONAL CHANNEL ID
        |--------------------------------------------------------------------------
        */

        if (process.env.PAYLOR_CHANNEL_ID) {
            paylorData.channelId = process.env.PAYLOR_CHANNEL_ID;
        }

        console.log("PAYLOR REQUEST:", paylorData);

        /*
        |--------------------------------------------------------------------------
        | SEND STK PUSH TO PAYLOR
        |--------------------------------------------------------------------------
        */

        const paylorResponse = await fetch(
            "https://paylor.webnixke.com/api/v1/merchants/payments/stk-push",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                    "Idempotency-Key": reference
                },

                body: JSON.stringify(paylorData)
            }
        );

        console.log("PAYLOR HTTP STATUS:", paylorResponse.status);

        const responseText = await paylorResponse.text();

        console.log("PAYLOR RESPONSE:", responseText);

        let paylorResult;

        try {
            paylorResult = JSON.parse(responseText);
        } catch (error) {
            paylorResult = {
                raw: responseText
            };
        }

        /*
        |--------------------------------------------------------------------------
        | PAYLOR REQUEST FAILED
        |--------------------------------------------------------------------------
        */

        if (!paylorResponse.ok) {
            payments.set(reference, {
                ...payments.get(reference),
                status: "FAILED",
                paylorResponse: paylorResult
            });

            return res.status(502).json({
                success: false,
                message: "Payment gateway rejected the request",
                response: paylorResult
            });
        }

        /*
        |--------------------------------------------------------------------------
        | SAVE PAYLOR TRANSACTION
        |--------------------------------------------------------------------------
        */

        payments.set(reference, {
            ...payments.get(reference),
            transactionId:
                paylorResult.transactionId ||
                paylorResult.transaction?.id ||
                null,
            status:
                paylorResult.status === "COMPLETED"
                    ? "SUCCESS"
                    : "PENDING",
            paylorResponse: paylorResult
        });

        /*
        |--------------------------------------------------------------------------
        | RESPONSE TO FRONTEND
        |--------------------------------------------------------------------------
        */

        return res.json({
            success: true,
            message: "STK Push sent successfully",
            reference: reference,
            status: "PENDING",
            transactionId:
                paylorResult.transactionId ||
                paylorResult.transaction?.id ||
                null
        });

    } catch (error) {
        console.error("STK PUSH ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to start payment",
            error: error.message
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
        | OPTIONAL WEBHOOK SIGNATURE VALIDATION
        |--------------------------------------------------------------------------
        */

        const webhookSecret = process.env.PAYLOR_WEBHOOK_SECRET;

        if (webhookSecret) {
            const signature = req.headers["x-webhook-signature"];

            if (!signature) {
                console.error("Missing Paylor webhook signature");

                return res.status(401).json({
                    success: false,
                    message: "Missing webhook signature"
                });
            }

            const rawBody = req.rawBody || Buffer.from("");

            const expectedSignature = crypto
                .createHmac("sha256", webhookSecret)
                .update(rawBody)
                .digest("hex");

            if (signature !== expectedSignature) {
                console.error("Invalid Paylor webhook signature");

                return res.status(401).json({
                    success: false,
                    message: "Invalid webhook signature"
                });
            }
        }

        const body = req.body || {};

        const transaction = body.transaction || {};

        const reference =
            transaction.reference ||
            transaction.internalReference ||
            body.reference;

        const status = String(
            transaction.status || body.status || ""
        ).toUpperCase();

        const event = String(body.event || "").toLowerCase();

        console.log("CALLBACK REFERENCE:", reference);
        console.log("CALLBACK STATUS:", status);
        console.log("CALLBACK EVENT:", event);

        if (!reference) {
            console.error("No payment reference in callback");

            return res.status(400).json({
                success: false,
                message: "Missing payment reference"
            });
        }

        /*
        |--------------------------------------------------------------------------
        | PAYMENT SUCCESS
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
                completedAt: Date.now()
            });

            console.log("CHATPESA: PAYMENT SUCCESS");
        }

        /*
        |--------------------------------------------------------------------------
        | PAYMENT FAILED
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
                failedAt: Date.now(),
                failureReason:
                    transaction.metadata?.callbackResultDesc ||
                    null
            });

            console.log("CHATPESA: PAYMENT FAILED");
        }

        return res.json({
            success: true
        });

    } catch (error) {
        console.error("CALLBACK ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Callback processing failed"
        });
    }
});

/*
|--------------------------------------------------------------------------
| PAYMENT STATUS
|--------------------------------------------------------------------------
*/

app.get("/payment-status/:reference", (req, res) => {
    const reference = req.params.reference;

    const payment = payments.get(reference);

    if (!payment) {
        return res.status(404).json({
            success: false,
            message: "Payment not found"
        });
    }

    return res.json({
        success: true,
        reference: reference,
        status: payment.status,
        amount: payment.amount,
        type: payment.type,
        country: payment.country,
        transactionId: payment.transactionId || null,
        mpesaReceipt: payment.mpesaReceipt || null
    });
});

/*
|--------------------------------------------------------------------------
| START SERVER
|--------------------------------------------------------------------------
*/

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
    console.log(`ChatPesa server running on port ${PORT}`);
});
