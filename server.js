require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

app.use(cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(
    express.json({
        verify: (req, res, buf) => {
            req.rawBody = buf;
        }
    })
);

/* ================================
   PAYMENT STORAGE
================================ */

const payments = new Map();

/* ================================
   COUNTRY PRICES
================================ */

const countryPrices = {
    China: 350,
    Canada: 450,
    Australia: 550,
    UK: 650,
    USA: 750,
    Others: 330
};

/* ================================
   PHONE NORMALIZATION
================================ */

function normalizePhone(phone) {
    if (!phone) {
        return null;
    }

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

/* ================================
   HOME
================================ */

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "ChatPesa backend is running"
    });
});

/* ================================
   COUNTRY PRICES
================================ */

app.get("/country-prices", (req, res) => {
    res.json({
        success: true,
        prices: countryPrices
    });
});

/* ================================
   STK PUSH
================================ */

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

        const normalizedPhone = normalizePhone(phone);

        if (!normalizedPhone) {
            return res.status(400).json({
                success: false,
                message: "Invalid Kenyan M-PESA phone number"
            });
        }

        let finalAmount;

        if (type === "registration") {
            finalAmount = 100;
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

        if (
            !Number.isFinite(Number(finalAmount)) ||
            Number(finalAmount) <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment amount"
            });
        }

        if (!process.env.PAYLOR_API_KEY) {

            console.error(
                "PAYLOR_API_KEY is missing"
            );

            return res.status(500).json({
                success: false,
                message: "Payment gateway is not configured"
            });
        }

        payments.set(reference, {
            reference: reference,
            phone: normalizedPhone,
            amount: finalAmount,
            type: type,
            country: country || null,
            status: "PENDING",
            createdAt: new Date().toISOString()
        });

        /* ================================
           PAYLOR API
        ================================= */

        const PAYLOR_URL =
            "https://api.paylorke.com/api/v1/merchants/payments/stk-push";

        const paylorRequest = {
            phone: normalizedPhone,
            amount: finalAmount,
            reference: reference,
            description:
                type === "registration"
                    ? "ChatPesa registration payment"
                    : "ChatPesa " +
                      (country || "country") +
                      " unlock payment",
            callbackUrl:
                "https://chatpesa-backend.onrender.com/paylor-callback"
        };

        /*
         * Paylor allows channelId to be omitted.
         * If you have a specific active channel ID/alias,
         * put it in Render Environment Variables as:
         *
         * PAYLOR_CHANNEL_ID=PAYL-XXXXXX
         */

        if (process.env.PAYLOR_CHANNEL_ID) {
            paylorRequest.channelId =
                process.env.PAYLOR_CHANNEL_ID;
        }

        console.log(
            "PAYLOR REQUEST:",
            paylorRequest
        );

        const response = await fetch(
            PAYLOR_URL,
            {
                method: "POST",

                headers: {
                    "Authorization":
                        "Bearer " +
                        process.env.PAYLOR_API_KEY,

                    "Content-Type":
                        "application/json",

                    "Idempotency-Key":
                        reference
                },

                body: JSON.stringify(
                    paylorRequest
                )
            }
        );

        const responseText =
            await response.text();

        console.log(
            "PAYLOR HTTP STATUS:",
            response.status
        );

        console.log(
            "PAYLOR RESPONSE:",
            responseText
        );

        let paylorResponse = {};

        try {
            paylorResponse =
                JSON.parse(responseText);
        } catch (error) {

            console.error(
                "PAYLOR JSON PARSE ERROR:",
                error.message
            );
        }

        if (!response.ok) {

            payments.set(reference, {
                ...payments.get(reference),

                status: "FAILED",

                gatewayStatus:
                    response.status,

                gatewayResponse:
                    paylorResponse
            });

            return res.status(502).json({
                success: false,

                message:
                    paylorResponse.message ||
                    paylorResponse.error ||
                    "Payment gateway rejected the request",

                gatewayStatus:
                    response.status,

                gatewayResponse:
                    paylorResponse
            });
        }

        payments.set(reference, {
            ...payments.get(reference),

            status:
                paylorResponse.status ||
                "PENDING",

            transactionId:
                paylorResponse.transactionId ||
                null,

            gatewayResponse:
                paylorResponse
        });

        /*
         * Paylor normally returns:
         *
         * {
         *   transactionId: "...",
         *   status: "SENT"
         * }
         */

        return res.json({
            success: true,

            reference:
                reference,

            transactionId:
                paylorResponse.transactionId ||
                null,

            status:
                paylorResponse.status ||
                "PENDING",

            message:
                "M-PESA payment request sent"
        });

    } catch (error) {

        console.error(
            "STK PUSH ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                "Unable to initiate payment"
        });
    }
});

/* ================================
   PAYLOR CALLBACK
================================ */

app.post(
    "/paylor-callback",
    (req, res) => {

        try {

            console.log(
                "PAYLOR CALLBACK BODY:",
                req.body
            );

            if (
                process.env.PAYLOR_WEBHOOK_SECRET
            ) {

                const signature =
                    req.headers[
                        "x-webhook-signature"
                    ];

                if (!signature) {

                    console.error(
                        "Missing Paylor webhook signature"
                    );

                    return res.status(401).json({
                        success: false,
                        message:
                            "Missing webhook signature"
                    });
                }

                const expectedSignature =
                    crypto
                        .createHmac(
                            "sha256",
                            process.env
                                .PAYLOR_WEBHOOK_SECRET
                        )
                        .update(
                            req.rawBody ||
                            Buffer.from("")
                        )
                        .digest("hex");

                if (
                    signature !==
                    expectedSignature
                ) {

                    console.error(
                        "Invalid Paylor webhook signature"
                    );

                    return res.status(401).json({
                        success: false,
                        message:
                            "Invalid webhook signature"
                    });
                }
            }

            const event =
                req.body?.event;

            const transaction =
                req.body?.transaction ||
                {};

            const reference =
                transaction.reference ||
                transaction.internalReference;

            const status =
                String(
                    transaction.status ||
                    ""
                ).toUpperCase();

            console.log(
                "CALLBACK REFERENCE:",
                reference
            );

            console.log(
                "CALLBACK STATUS:",
                status || event
            );

            if (!reference) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Payment reference missing"
                });
            }

            if (
                event ===
                    "payment.success" ||
                status === "COMPLETED" ||
                status === "SUCCESS"
            ) {

                const existing =
                    payments.get(
                        reference
                    ) || {};

                payments.set(
                    reference,
                    {
                        ...existing,

                        reference:
                            reference,

                        status:
                            "SUCCESS",

                        transactionId:
                            transaction.id ||
                            existing.transactionId ||
                            null,

                        mpesaReceipt:
                            transaction.mpesaReceipt ||
                            transaction.providerRef ||
                            null,

                        callback:
                            req.body,

                        completedAt:
                            new Date()
                                .toISOString()
                    }
                );

                console.log(
                    "CHATPESA: PAYMENT SUCCESS"
                );

                return res.json({
                    success: true
                });
            }

            if (
                event ===
                    "payment.failed" ||
                status === "FAILED" ||
                status === "CANCELLED"
            ) {

                const existing =
                    payments.get(
                        reference
                    ) || {};

                payments.set(
                    reference,
                    {
                        ...existing,

                        reference:
                            reference,

                        status:
                            "FAILED",

                        callback:
                            req.body,

                        failedAt:
                            new Date()
                                .toISOString()
                    }
                );

                console.log(
                    "CHATPESA: PAYMENT FAILED"
                );

                return res.json({
                    success: true
                });
            }

            const existing =
                payments.get(
                    reference
                ) || {};

            payments.set(
                reference,
                {
                    ...existing,

                    reference:
                        reference,

                    status:
                        status ||
                        "PENDING",

                    callback:
                        req.body
                }
            );

            return res.json({
                success: true
            });

        } catch (error) {

            console.error(
                "PAYLOR CALLBACK ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Callback processing failed"
            });
        }
    }
);

/* ================================
   PAYMENT STATUS
================================ */

app.get(
    "/payment-status/:reference",
    (req, res) => {

        const reference =
            req.params.reference;

        const payment =
            payments.get(
                reference
            );

        if (!payment) {

            return res.json({
                success: false,
                status: "NOT_FOUND"
            });
        }

        return res.json({
            success: true,

            reference:
                reference,

            status:
                payment.status,

            transactionId:
                payment.transactionId ||
                null,

            mpesaReceipt:
                payment.mpesaReceipt ||
                null
        });
    }
);

/* ================================
   START SERVER
================================ */

const PORT =
    process.env.PORT || 10000;

app.listen(
    PORT,
    () => {

        console.log(
            "ChatPesa server running on port " +
            PORT
        );
    }
);
